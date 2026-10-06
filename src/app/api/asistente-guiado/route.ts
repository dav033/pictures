import { ejecutarConversacionStream } from "@sempertex/agente-core";
import type { Herramienta, Mensaje } from "@sempertex/agente-core";
import { NextResponse } from "next/server";
import { z } from "zod";
import { bibliotecaVisible, buscarDecoracionesSempertex, normalizarBusqueda, proveedoresVisibles } from "@/lib/biblioteca-sempertex/biblioteca";
import { AsistenteGuiadoRequestSchema, CotizacionGuiadaSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { chatOmoikaneDe, resolverProveedor } from "@/lib/ia/nucleo/registro";
import { PROMPT_GUIADO } from "@/lib/ia/guiado/prompt-guiado";
import { ChatSseEventV1Schema, CHAT_SSE_CONTRACT_VERSION } from "@/lib/ia/contracts/chat-v1";
import { ListaMaterialesRequestSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { llamarPythonListaMateriales } from "@/lib/ia/nucleo/python-adapter";
import { ErrorIA } from "@/lib/ia/nucleo/tipos";
import type { ErrorCodeV1 } from "@/lib/ia/contracts/chat-v1";
import { decoracionCotizableCoincide, normalizarCiudad, protegerHerramientas } from "@/lib/ia/guiado/utilidades";
import { presentacionMaterialGuiado } from "@/lib/ia/guiado/presentacion-material-guiado";
import { ESTRUCTURAS_OFICIALES_IDS } from "@/lib/plan/estructuras-oficiales";
import { PALETA_COLORES_V2 } from "@/lib/rag/taxonomy/v2";
import { normalizarPropuestaComposicion } from "@/lib/ia/guiado/propuesta-composicion";

export const maxDuration = 75;

const herramientas: Herramienta[] = [
  { nombre: "guardar_brief_guiado", descripcion: "Guarda evento, edad y temática que el cliente ya indicó.", esquema: { type: "object", properties: { evento: { type: "string" }, edad: { type: "integer" }, tematica: { type: "string" } }, required: ["evento", "edad", "tematica"], additionalProperties: false } },
  { nombre: "buscar_decoraciones_sempertex", descripcion: "Busca ideas de decoración según evento, edad y temática.", esquema: { type: "object", properties: { evento: { type: "string" }, edad: { type: "integer" }, tematica: { type: "string" } }, required: ["evento", "edad", "tematica"], additionalProperties: false } },
  { nombre: "proponer_composicion", descripcion: "Propone entre una y tres estructuras oficiales para esta celebración. Usa exclusivamente ids oficiales y colores de la paleta Sempertex permitida. Llama cuando el cliente diga propónme algo, arma tú algo o pida cambiar su propuesta.", esquema: { type: "object", properties: { frase: { type: "string" }, colores: { type: "array", items: { type: "string", enum: [...PALETA_COLORES_V2] }, minItems: 1, maxItems: 5 }, piezas: { type: "array", items: { type: "object", properties: { estructura: { type: "string", enum: [...ESTRUCTURAS_OFICIALES_IDS] }, cantidad: { type: "integer", minimum: 1, maximum: 12 } }, required: ["estructura", "cantidad"], additionalProperties: false }, minItems: 1, maxItems: 3 } }, required: ["frase", "colores", "piezas"], additionalProperties: false } },
  { nombre: "ofrecer_opciones", descripcion: "Ofrece las cuatro opciones para continuar con una decoración elegida.", esquema: { type: "object", properties: {}, additionalProperties: false } },
  { nombre: "preguntar_uso", descripcion: "Solicita elegir entre negocio y uso personal antes de consultar precios.", esquema: { type: "object", properties: {}, additionalProperties: false } },
  { nombre: "pasos_decoracion", descripcion: "Muestra los pasos de montaje de la decoración que el cliente eligió en la interfaz. No necesita argumentos.", esquema: { type: "object", properties: {}, additionalProperties: false } },
  { nombre: "buscar_proveedores", descripcion: "Busca proveedores de ejemplo visibles en una zona indicada.", esquema: { type: "object", properties: { tipo: { type: "string", enum: ["decorador_happia", "mbp", "distribuidor", "ecommerce"] }, ciudad: { type: "string" } }, required: ["tipo", "ciudad"], additionalProperties: false } },
  { nombre: "costear_decoracion", descripcion: "Cotiza los materiales de la decoración que el cliente eligió en la interfaz, con el uso que eligió (negocio o personal). No necesita argumentos: el servidor usa lo que el cliente confirmó.", esquema: { type: "object", properties: {}, additionalProperties: false } },
];

const ArgsSchema = z.object({ evento: z.string().optional(), edad: z.number().int().optional(), tematica: z.string().optional(), decoracionId: z.string().optional(), tipo: z.enum(["decorador_happia", "mbp", "distribuidor", "ecommerce"]).optional(), ciudad: z.string().optional(), uso: z.enum(["negocio", "personal"]).optional() }).strict();

function envelopeHttp(requestId: string, code: ErrorCodeV1, message: string, retryable: boolean) {
  return { schema_version: "error.v1", code, message, retryable, request_id: requestId, error: message };
}

function falloProveedor(error: unknown): { code: ErrorCodeV1; message: string; status: number; retryable: boolean } {
  if (!(error instanceof ErrorIA)) return { code: "INTERNAL_ERROR", message: "No se pudo iniciar el asistente guiado.", status: 503, retryable: true };
  if (error.causa === "sin_llave") return { code: "AI_KEY_MISSING", message: "El proveedor de IA no está configurado.", status: 503, retryable: false };
  if (error.causa === "cuota") return { code: "AI_QUOTA", message: "El proveedor de IA no tiene cuota disponible ahora.", status: 429, retryable: true };
  if (error.causa === "timeout") return { code: "AI_TIMEOUT", message: "El asistente tardó demasiado. Intenta de nuevo.", status: 504, retryable: true };
  if (error.causa === "filtrado") return { code: "AI_FILTERED", message: "El proveedor no pudo procesar esta solicitud.", status: 422, retryable: false };
  if (error.causa === "red") return { code: "AI_NETWORK", message: "No se pudo contactar al proveedor de IA.", status: 502, retryable: true };
  return { code: "AI_PROVIDER", message: "No se pudo iniciar el asistente guiado.", status: 502, retryable: true };
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const headers = { "X-Request-ID": requestId };
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > 25_000_000) {
    const message = "La solicitud supera el tamaño máximo permitido.";
    return Response.json(envelopeHttp(requestId, "PAYLOAD_TOO_LARGE", message, false), { status: 413, headers });
  }
  let body: unknown;
  try { body = await request.json(); } catch {
    const message = "El mensaje no tiene un formato válido.";
    return NextResponse.json(envelopeHttp(requestId, "INVALID_JSON", message, false), { status: 400, headers });
  }
  const parsed = AsistenteGuiadoRequestSchema.safeParse(body);
  if (!parsed.success) {
    const message = "La solicitud del asistente guiado no es válida.";
    return NextResponse.json(envelopeHttp(requestId, "INVALID_INPUT", message, false), { status: 400, headers });
  }
  const { messages } = parsed.data;
  const usoConfirmado = parsed.data.estadoGuiado?.uso;
  const decoracionConfirmada = parsed.data.estadoGuiado?.decoracionId;
  const proveedores = bibliotecaVisible();
  const directorio = proveedoresVisibles();
  const datos: Record<string, unknown> = { ...(Object.keys(parsed.data.brief).length ? { brief: parsed.data.brief } : {}) };
  try {
    const id = resolverProveedor({ cookie: request.headers.get("cookie")?.match(/ia_proveedor=(gemini)/)?.[1] });
    const chat = await chatOmoikaneDe(id, { requestId, correlationId: requestId });
    const historial: Mensaje[] = messages.map((mensaje, indice) => mensaje.role === "assistant"
      ? { rol: "asistente", texto: mensaje.content }
      : { rol: "usuario", texto: mensaje.content, ...(indice === messages.length - 1 && parsed.data.fotoInspiracion ? { imagenes: [{ ...parsed.data.fotoInspiracion, id: "INSPIRACION", descripcion: "Foto de inspiración adjuntada por el cliente." }] } : {}) });
    const registro = {
      guardar_brief_guiado: async (args: Record<string, unknown>) => {
        const entrada = z.object({ evento: z.string().trim().min(1).max(120), edad: z.number().int().min(0).max(120), tematica: z.string().trim().min(1).max(160) }).strict().parse(args);
        datos.brief = entrada;
        return { brief: entrada };
      },
      buscar_decoraciones_sempertex: async (args: Record<string, unknown>) => {
        z.object({ evento: z.string().trim().min(1), edad: z.number().int().min(0).max(120), tematica: z.string().trim().min(1) }).strict().parse(args);
        const brief = z.object({ evento: z.string().min(1), edad: z.number().int(), tematica: z.string().min(1) }).strict().safeParse(datos.brief);
        if (!brief.success) return { ok: false, motivo: "brief_incompleto" };
        const ultimoMensajeUsuario = [...messages].reverse().find((mensaje) => mensaje.role === "user")?.content ?? "";
        const tematicaBusqueda = `${brief.data.tematica} ${ultimoMensajeUsuario}`;
        const coincidencias = buscarDecoracionesSempertex({ ...brief.data, tematica: tematicaBusqueda });
        const eventoNormalizado = normalizarBusqueda(brief.data.evento);
        const consultaNormalizada = normalizarBusqueda(tematicaBusqueda);
        const generoBaby = eventoNormalizado.includes("baby shower")
          ? consultaNormalizada.split(" ").includes("nina") ? "nina"
            : consultaNormalizada.split(" ").includes("nino") ? "nino"
              : consultaNormalizada.split(" ").some((palabra) => ["neutro", "neutra", "unisex"].includes(palabra)) ? "neutro" : null
          : null;
        const encontradas = generoBaby
          ? coincidencias.filter((decoracion) => normalizarBusqueda(`${decoracion.titulo} ${decoracion.tematica}`).split(" ").includes(generoBaby))
          : coincidencias;
        datos.decoraciones = encontradas;
        if (!encontradas.length) return { brief: brief.data, decoraciones: [], aviso: "No hay ideas que mostrar: NO hables de «esta propuesta» ni de opciones; pregunta otro estilo o colores, o pide una foto de inspiración." };
        return { brief: brief.data, decoraciones: encontradas, aviso: "Todos los registros visibles llevan marca de ejemplo." };
      },
      proponer_composicion: async (args: Record<string, unknown>) => {
        const validada = normalizarPropuestaComposicion(args);
        datos.propuesta = validada;
        return { propuesta: validada, aviso: "Las piezas y colores vienen del catálogo oficial. No agregues estructuras ni colores fuera de esta lista." };
      },
      ofrecer_opciones: async () => { datos.opciones = ["contratar", "costear", "comprar", "aprender"]; return { opciones: datos.opciones }; },
      preguntar_uso: async () => { datos.preguntaUso = true; return { pregunta: "¿Es para tu negocio o para uso personal?" }; },
      pasos_decoracion: async (args: Record<string, unknown>) => {
        const entrada = ArgsSchema.parse(args);
        const deco = proveedores.find((item) => item.id === (entrada.decoracionId ?? decoracionConfirmada));
        if (!deco) return { ok: false, motivo: decoracionConfirmada ? "decoracion_no_disponible" : "falta_que_el_cliente_elija_una_decoracion" };
        datos.pasos = deco.pasos;
        return { pasos: deco.pasos, aviso: deco.origen === "ejemplo" ? deco.aviso : "" };
      },
      buscar_proveedores: async (args: Record<string, unknown>) => {
        const entrada = ArgsSchema.parse(args);
        // «Decorador» es uno solo para el cliente: certificados HAPPIA y Master Balloon Pro salen juntos.
        const tipos: ReadonlyArray<string | undefined> = entrada.tipo === "decorador_happia" || entrada.tipo === "mbp" ? ["decorador_happia", "mbp"] : [entrada.tipo];
        const ciudad = normalizarCiudad(entrada.ciudad ?? "");
        const encontrados = directorio.filter((item) => tipos.includes(item.tipo) && (normalizarCiudad(item.zona.ciudad) === ciudad || item.zona.cobertura.some((zona) => normalizarCiudad(zona) === ciudad)));
        datos.proveedores = encontrados;
        const ciudadesDisponibles = [...new Set(directorio.filter((item) => tipos.includes(item.tipo)).map((item) => item.zona.ciudad))];
        return { proveedores: encontrados, ...(encontrados.length ? {} : { ciudadesDisponibles }), aviso: "Los registros actuales son ejemplos, no contactos reales." };
      },
      costear_decoracion: async (args: Record<string, unknown>) => {
        // La decoración y el uso son los que el cliente eligió con los botones (estadoGuiado): el modelo no ve los
        // ids internos y adivinarlos hacía fallar el costeo varias veces seguidas. Si aun así manda uno, debe coincidir.
        const pedida = ArgsSchema.parse(args);
        const entrada = { decoracionId: pedida.decoracionId ?? decoracionConfirmada, uso: pedida.uso ?? usoConfirmado };
        if (!usoConfirmado || entrada.uso !== usoConfirmado || !decoracionCotizableCoincide(decoracionConfirmada, entrada.decoracionId) || !proveedores.some((item) => item.id === entrada.decoracionId)) return { ok: false, motivo: !usoConfirmado ? "falta_que_el_cliente_elija_negocio_o_personal" : "uso_o_decoracion_no_validado_por_el_cliente" };
        datos.uso = usoConfirmado;
        const decoracion = proveedores.find((item) => item.id === entrada.decoracionId);
        if (!decoracion || decoracion.materiales.length === 0) {
          datos.cotizacion = null;
          return { ok: false, motivo: "costeo_pendiente_datos_de_catalogo", aviso: "Esta decoración todavía no tiene productos asociados en el catálogo; no inventes un precio." };
        }
        const entradaCotizacion = ListaMaterialesRequestSchema.parse({ schema_version: "lista-materiales.v1", materiales: decoracion.materiales.map((material) => ({ variant_id: material.variantId, cantidad: material.cantidad })) });
        const cotizada = await llamarPythonListaMateriales({ entrada: entradaCotizacion, requestId: crypto.randomUUID(), correlationId: requestId, parentSignal: request.signal });
        const cotizacion = CotizacionGuiadaSchema.parse({
          lineas: cotizada.lineas.map((linea) => {
            const presentacion = presentacionMaterialGuiado(decoracion.materiales.find((material) => material.variantId === linea.variant_id)?.nota);
            return { id: linea.variant_id, tamano: "sin tamaño aplicable", ...presentacion, cantidadNecesaria: linea.cantidad_necesaria, disponible: true, varianteId: linea.variant_id, precioPaquete: linea.precio_paquete, unidadesPaquete: linea.unidades_paquete, paquetes: linea.paquetes, subtotal: linea.subtotal, sobrante: linea.sobrante };
          }),
          total: cotizada.total, mermaPorcentaje: 0, incluyeIva: true, complementosSoportados: false,
        });
        datos.cotizacion = cotizacion;
        return { cotizacion, incluyeIva: true, uso: usoConfirmado, aviso: decoracion.origen === "ejemplo" ? "Productos y precios consultados del catálogo actual. Temática, cantidades y pasos son de ejemplo; no incluye montaje." : "Precio de tienda en línea. No incluye montaje." };
      },
    };
    const registroProtegido = protegerHerramientas(registro);
    const elegida = decoracionConfirmada ? proveedores.find((item) => item.id === decoracionConfirmada) : undefined;
    const estadoConfirmado = [
      elegida ? `Decoración elegida por el cliente en la interfaz: «${elegida.titulo}».` : "El cliente todavía no eligió una decoración.",
      usoConfirmado ? `Uso elegido: ${usoConfirmado === "negocio" ? "para su negocio" : "uso personal"}.` : "El cliente todavía no eligió si es para negocio o uso personal.",
    ].join(" ");
    const generador = ejecutarConversacionStream({ chat, sistema: `${PROMPT_GUIADO}

Estado confirmado (no lo leas en voz alta): ${estadoConfirmado}`, historial, herramientas, registro: registroProtegido, vueltasMax: 8, herramientasSoloLectura: new Set(["buscar_decoraciones_sempertex", "pasos_decoracion", "buscar_proveedores"]), signal: request.signal, telemetria: { flujo: "armador_decoracion", requestId, correlationId: requestId, superficie: "/api/asistente-guiado", promptVersion: "asistente-guiado.v1" } });
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder();
        const mandar = (tipo: "texto" | "herramienta" | "fin" | "error", campos: Record<string, unknown>) => {
          const evento = { schema_version: CHAT_SSE_CONTRACT_VERSION, type: tipo, request_id: requestId, correlation_id: requestId, ...campos };
          const validado = ChatSseEventV1Schema.safeParse(evento);
          if (!validado.success) throw new Error("EVENTO_GUIADO_INVALIDO");
          controller.enqueue(encoder.encode(`event: ${tipo}\ndata: ${JSON.stringify(evento)}\n\n`));
        };
        try {
          for await (const evento of generador) {
            if (request.signal.aborted) break;
            if (evento.tipo === "texto") mandar("texto", { delta: evento.delta });
            else if (evento.tipo === "herramienta") mandar("herramienta", { nombre: evento.nombre, estado: evento.estado, ok: evento.ok });
            else mandar("fin", { reply: evento.resultado.texto, brief: {}, proveedor: evento.resultado.proveedor, modelo: evento.resultado.modelo, result: datos });
          }
          controller.close();
        } catch (error) {
          console.error("[asistente-guiado] fallo durante el turno", { requestId, error: error instanceof Error ? error.message : String(error) });
          if (!request.signal.aborted) mandar("error", { error: "No se pudo completar la respuesta. Puedes volver a intentarlo.", code: "INTERNAL_ERROR", retryable: true });
          controller.close();
        }
      },
    });
    return new Response(stream, { headers: { ...headers, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
  } catch (error) {
    console.error("[asistente-guiado] fallo al preparar turno", { requestId, error: error instanceof Error ? error.message : String(error) });
    const fallo = falloProveedor(error);
    return NextResponse.json(envelopeHttp(requestId, fallo.code, fallo.message, fallo.retryable), { status: fallo.status, headers });
  }
}
