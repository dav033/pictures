import { ejecutarConversacionStream } from "@sempertex/agente-core";
import type { Herramienta, Mensaje } from "@sempertex/agente-core";
import { NextResponse } from "next/server";
import { z } from "zod";
import { bibliotecaVisible, normalizarBusqueda, proveedoresVisibles, tematicasDisponibles } from "@/lib/biblioteca-sempertex/biblioteca";
import { diferenciaOpciones, sanearOpcionesCatalogo } from "@/lib/ia/guiado/opciones-catalogo";
import { eventoDeMensajes, generosBabyShower, ideasGuiadas, ideasRealesDeOpcion, NOMBRE_GENERO } from "@/lib/ia/guiado/ideas-guiadas";
import { CHIP_FOTO_GUIADA, FiltroFlujoGuiado, FRASE_IDEAS_GUIADAS, sanearRespuestaGuiada, type ContextoRespuesta } from "@/lib/ia/guiado/respuesta-guiada";
import { AsistenteGuiadoRequestSchema, CotizacionGuiadaSchema, PropuestaComposicionSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { chatOmoikaneDe, resolverProveedor } from "@/lib/ia/nucleo/registro";
import { PROMPT_GUIADO } from "@/lib/ia/guiado/prompt-guiado";
import { ChatSseEventV1Schema, CHAT_SSE_CONTRACT_VERSION } from "@/lib/ia/contracts/chat-v1";
import { ListaMaterialesRequestSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { crearDeadlineSignal } from "@/lib/ia/contracts/operational-v1";
import { llamarPythonListaMateriales } from "@/lib/ia/nucleo/python-adapter";
import { ErrorIA } from "@/lib/ia/nucleo/tipos";
import type { ErrorCodeV1 } from "@/lib/ia/contracts/chat-v1";
import { decoracionCotizableCoincide, normalizarCiudad, protegerHerramientas } from "@/lib/ia/guiado/utilidades";
import { presentacionMaterialGuiado } from "@/lib/ia/guiado/presentacion-material-guiado";
import { pasosParaCliente } from "@/lib/ia/guiado/pasos-cliente";
import { ESTRUCTURAS_OFICIALES, ESTRUCTURAS_OFICIALES_IDS, type EstructuraOficialId } from "@/lib/plan/estructuras-oficiales";
import { PALETA_COLORES_V2 } from "@/lib/rag/taxonomy/v2";
import { normalizarPropuestaComposicion } from "@/lib/ia/guiado/propuesta-composicion";
import { recortarCantidades } from "@/lib/plan/piezas-individuales";
import { esquemaHerramientaPropuesta, type AlcancePropuesta } from "@/lib/ia/guiado/esquema-herramienta-propuesta";
import { textoPlanActual } from "@/lib/ia/guiado/instruccion-plan";
import { conRegistro, contextoActual, decidir, envolverRegistroHerramientas } from "@/lib/registro";

export const maxDuration = 75;

/** Tiempo máximo de un turno guiado: pasado esto el cliente recibe un error reintentable en vez de quedarse esperando. */
const DEADLINE_TURNO_MS = 60_000;
const ACCIONES_PLAN = ["ver", "costear", "comprar", "aprender", "contratar"] as const;

const herramientas: Herramienta[] = [
  { nombre: "guardar_brief_guiado", descripcion: "Guarda el evento y la temática que el cliente ya indicó; la edad solo si es un cumpleaños.", esquema: { type: "object", properties: { evento: { type: "string" }, edad: { type: "integer" }, tematica: { type: "string" } }, required: ["evento", "tematica"], additionalProperties: false } },
  { nombre: "buscar_decoraciones_sempertex", descripcion: "Busca ideas de decoración según evento y temática (y la edad solo en un cumpleaños).", esquema: { type: "object", properties: { evento: { type: "string" }, edad: { type: "integer" }, tematica: { type: "string" } }, required: ["evento", "tematica"], additionalProperties: false } },
  { nombre: "proponer_composicion", descripcion: "Propone entre una y tres estructuras oficiales para esta celebración. Usa exclusivamente ids oficiales y colores de la paleta Sempertex permitida. Llama cuando el cliente pida que le propongas algo o cuando pida cambiar su plan o su propuesta.", esquema: { type: "object", properties: { frase: { type: "string" }, colores: { type: "array", items: { type: "string", enum: [...PALETA_COLORES_V2] }, minItems: 1, maxItems: 5 }, piezas: { type: "array", items: { type: "object", properties: { estructura: { type: "string", enum: [...ESTRUCTURAS_OFICIALES_IDS] }, cantidad: { type: "integer", minimum: 1, maximum: 12 } }, required: ["estructura", "cantidad"], additionalProperties: false }, minItems: 1, maxItems: 3 } }, required: ["frase", "colores", "piezas"], additionalProperties: false } },
  { nombre: "ofrecer_opciones", descripcion: "Ofrece las cuatro opciones para continuar con una decoración elegida.", esquema: { type: "object", properties: {}, additionalProperties: false } },
  { nombre: "preguntar_uso", descripcion: "Solicita elegir entre negocio y uso personal antes de consultar precios.", esquema: { type: "object", properties: {}, additionalProperties: false } },
  { nombre: "pasos_decoracion", descripcion: "Muestra los pasos de montaje de la decoración que el cliente eligió en la interfaz. No necesita argumentos.", esquema: { type: "object", properties: {}, additionalProperties: false } },
  { nombre: "buscar_proveedores", descripcion: "Busca decoradores, distribuidores o tiendas en la ciudad que el cliente escribió. Si el cliente todavía no dijo su ciudad, pregúntala antes de llamar.", esquema: { type: "object", properties: { tipo: { type: "string", enum: ["decorador_happia", "mbp", "distribuidor", "ecommerce"] }, ciudad: { type: "string" } }, required: ["tipo", "ciudad"], additionalProperties: false } },
  { nombre: "costear_decoracion", descripcion: "Cotiza los materiales de la decoración que el cliente eligió en la interfaz, con el uso que eligió (negocio o personal). No necesita argumentos: el servidor usa lo que el cliente confirmó.", esquema: { type: "object", properties: {}, additionalProperties: false } },
];

/** Solo existe cuando el cliente tiene un plan a medida a la vista. */
const herramientaAccionPlan: Herramienta = {
  nombre: "abrir_accion_plan",
  descripcion: "Abre una acción sobre el plan vigente del cliente cuando la pide con palabras: ver (cómo quedaría, imagen), costear (precio de los materiales), comprar, aprender (cómo armarlo) o contratar (un decorador).",
  esquema: { type: "object", properties: { accion: { type: "string", enum: [...ACCIONES_PLAN] } }, required: ["accion"], additionalProperties: false },
};

/** Herramientas que solo tienen sentido con una idea del catálogo elegida en la interfaz. */
const HERRAMIENTAS_DE_DECORACION: ReadonlySet<string> = new Set(["costear_decoracion", "preguntar_uso", "pasos_decoracion", "ofrecer_opciones"]);

/** «Elegante negro y dorado (Cumpleaños, Graduación)» por cada temática con al menos una decoración visible. */
function textoTematicasCatalogo(): string {
  const eventosPorTematica = new Map<string, Set<string>>();
  for (const decoracion of bibliotecaVisible()) {
    const eventos = eventosPorTematica.get(decoracion.tematica) ?? new Set<string>();
    decoracion.eventos.forEach((evento) => eventos.add(evento));
    eventosPorTematica.set(decoracion.tematica, eventos);
  }
  return [...eventosPorTematica].map(([tematica, eventos]) => `${tematica} (${[...eventos].join(", ")})`).join(" | ");
}

const ArgsSchema = z.object({ evento: z.string().optional(), edad: z.number().int().optional(), tematica: z.string().optional(), decoracionId: z.string().optional(), tipo: z.enum(["decorador_happia", "mbp", "distribuidor", "ecommerce"]).optional(), ciudad: z.string().optional(), uso: z.enum(["negocio", "personal"]).optional() }).strict();
const BriefCompletoSchema = z.object({ evento: z.string().min(1).max(120), edad: z.number().int().min(0).max(120), tematica: z.string().min(1).max(160) }).strict();
type BriefCompleto = z.infer<typeof BriefCompletoSchema>;

/** Botones de pieza individual del cliente anterior → id oficial (compatibilidad mientras no mande `piezaPedida`). */
const PIEZA_POR_BOTON: Readonly<Record<string, EstructuraOficialId>> = { "arco orgánico": "arco_asimetrico", columna: "columna", guirnalda: "guirnalda", semiarco: "semiarco", bouquet: "bouquet" };

function piezaDeTextoBoton(texto: string): EstructuraOficialId | undefined {
  const coincidencia = /^Propónme una pieza individual:\s*(.+?)\.?$/.exec(texto.trim());
  const nombre = coincidencia?.[1]?.trim().toLocaleLowerCase("es");
  if (!nombre) return undefined;
  return PIEZA_POR_BOTON[nombre] ?? ESTRUCTURAS_OFICIALES_IDS.find((id) => ESTRUCTURAS_OFICIALES[id].nombre.toLocaleLowerCase("es") === nombre);
}

/** Alcance de la propuesta: el que manda el cliente, o (compatibilidad) solo los textos EXACTOS de sus botones. */
function alcanceDelTurno(declarado: AlcancePropuesta | undefined, ultimoUsuario: string, piezaPedida: EstructuraOficialId | undefined): AlcancePropuesta | null {
  if (declarado) return declarado;
  if (/^Propónme algo para una decoración completa/.test(ultimoUsuario)) return "completa";
  if (/^Propónme una pieza individual:/.test(ultimoUsuario) || piezaPedida) return "individual";
  return null;
}

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

/** El request_id del turno es el de la petición registrada (x-request-id), si es un UUID: así el SSE, la telemetría, el Python y la auditoría hablan del mismo id. */
function requestIdDelTurno(): string {
  const solicitud = contextoActual()?.solicitud;
  return solicitud && z.string().uuid().safeParse(solicitud).success ? solicitud : crypto.randomUUID();
}

// Auditado (src/lib/registro): entrada, cada llamada al modelo, cada herramienta, las decisiones de abajo y el SSE de salida.
export const POST = conRegistro("/api/asistente-guiado", turnoGuiado, { vista: "guiada" });

async function turnoGuiado(request: Request) {
  const requestId = requestIdDelTurno();
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
  const estado = parsed.data.estadoGuiado;
  const ultimoUsuario = [...messages].reverse().find((mensaje) => mensaje.role === "user")?.content.trim() ?? "";
  const piezaBoton = estado?.piezaPedida ?? piezaDeTextoBoton(ultimoUsuario);
  const alcancePropuesta = alcanceDelTurno(estado?.alcancePropuesta, ultimoUsuario, piezaBoton);
  // Una pieza pedida solo restringe la pieza individual: en la decoración completa se ignora.
  const piezaPedida = alcancePropuesta === "individual" ? piezaBoton : undefined;
  decidir("regla:alcance_turno_guiado", "alcance de la propuesta y pieza pedida", { alcancePropuesta, piezaPedida: piezaPedida ?? null }, {
    entrada: { alcanceDeclarado: estado?.alcancePropuesta ?? null, piezaDeclarada: estado?.piezaPedida ?? null, piezaBoton: piezaBoton ?? null, ultimoUsuario },
    motivo: estado?.alcancePropuesta ? "lo declaró la interfaz" : alcancePropuesta ? "texto exacto de un botón" : "turno libre (sin alcance)",
  });
  const planActual = estado?.planActual;
  const usoConfirmado = estado?.uso;
  const decoracionConfirmada = estado?.decoracionId;
  const proveedores = bibliotecaVisible();
  const directorio = proveedoresVisibles();
  // Lo que escribió el cliente, normalizado: la ciudad de buscar_proveedores tiene que salir de aquí, no del modelo.
  const textoCliente = ` ${normalizarBusqueda(messages.filter((mensaje) => mensaje.role === "user").map((mensaje) => mensaje.content).join(" "))} `;
  // El brief del cliente solo se usa para completar; el resultado devuelve brief únicamente cuando una herramienta lo fija.
  const briefPrevio = parsed.data.brief;
  const datos: Record<string, unknown> = {};
  const deadline = crearDeadlineSignal(request.signal, DEADLINE_TURNO_MS);
  try {
    const id = resolverProveedor({ cookie: request.headers.get("cookie")?.match(/ia_proveedor=(gemini)/)?.[1] });
    const chat = await chatOmoikaneDe(id, { requestId, correlationId: requestId }, "chat_guiado");
    const historial: Mensaje[] = messages.map((mensaje, indice) => mensaje.role === "assistant"
      ? { rol: "asistente", texto: mensaje.content }
      : { rol: "usuario", texto: mensaje.content, ...(indice === messages.length - 1 && parsed.data.fotoInspiracion ? { imagenes: [{ ...parsed.data.fotoInspiracion, id: "INSPIRACION", descripcion: "Foto de inspiración adjuntada por el cliente." }] } : {}) });
    const briefVigente = (): Partial<BriefCompleto> => {
      const guardado = BriefCompletoSchema.safeParse(datos.brief);
      return guardado.success ? guardado.data : briefPrevio;
    };
    const registro = {
      guardar_brief_guiado: async (args: Record<string, unknown>) => {
        const entrada = z.object({ evento: z.string().trim().min(1).max(120), edad: z.number().int().min(0).max(120).nullish(), tematica: z.string().trim().min(1).max(160) }).strict().parse(args);
        // 0 = «sin edad» (boda, baby shower…): el contrato de salida no cambia.
        const brief: BriefCompleto = { evento: entrada.evento, edad: entrada.edad ?? 0, tematica: entrada.tematica };
        datos.brief = brief;
        return { brief };
      },
      buscar_decoraciones_sempertex: async (args: Record<string, unknown>) => {
        const pedida = z.object({ evento: z.string().trim().max(120).nullish(), edad: z.number().int().min(0).max(120).nullish(), tematica: z.string().trim().max(160).nullish() }).strict().parse(args);
        const previo = briefVigente();
        const evento = pedida.evento || previo.evento;
        const tematica = pedida.tematica || previo.tematica;
        if (!evento || !tematica) return { ok: false, motivo: "brief_incompleto", accion_requerida: "Pregunta lo que falta (qué celebra o qué temática o colores quiere) antes de buscar." };
        const brief: BriefCompleto = { evento, edad: pedida.edad ?? previo.edad ?? 0, tematica };
        datos.brief = brief;
        // Misma búsqueda con la que se validan las «Opciones:» (ideas-guiadas): el género del baby shower sale de la
        // temática o de los colores de cada idea, y si no hay de lo pedido van las reales más cercanas del mismo evento.
        const resultado = ideasGuiadas({ evento: brief.evento, edad: brief.edad, tematica: brief.tematica, ultimoUsuario });
        const encontradas = resultado.ideas;
        datos.decoraciones = encontradas;
        const exactas = encontradas.filter((decoracion) => decoracion.coincidencia === "exacta").length;
        decidir("regla:busqueda_biblioteca", "ideas reales del catálogo que ve el cliente", { total: encontradas.length, exactas, via: resultado.via, ideas: encontradas.map((decoracion) => ({ id: decoracion.id, titulo: decoracion.titulo, tematica: decoracion.tematica, coincidencia: decoracion.coincidencia })) }, {
          entrada: { brief, consulta: resultado.consulta, generoBaby: resultado.genero },
          ...(resultado.via === "evento" ? { motivo: "sin ideas de lo pedido: se muestran las reales más cercanas del mismo evento, sin anunciarlo como fracaso" } : resultado.via === "vacio" ? { motivo: "sin ideas para el evento: se ofrecen temáticas con decoraciones" } : {}),
        });
        if (!encontradas.length) {
          const conIdeas = tematicasDisponibles(brief.evento).filter((tematica) => ideasRealesDeOpcion(tematica, { evento: brief.evento, edad: brief.edad }) > 0).slice(0, 4);
          return { brief, ideas: [], aviso: `NO digas que no hay ni que no encontraste. Pregunta en una frase qué estilo le gusta y cierra con «Opciones: ${[...conIdeas, CHIP_FOTO_GUIADA].join(" | ")}».` };
        }
        const aviso = exactas === 0
          ? "Son ideas reales del catálogo, las más cercanas a lo que pidió: preséntalas con naturalidad («Te dejo unas ideas que pueden encantarte, ¿alguna te gusta?»). NO digas que no encontraste, que no hay ni que no son exactas."
          : exactas < encontradas.length ? `Las primeras ${exactas} son de lo que pidió y las demás, parecidas: preséntalas todas con naturalidad, sin decir que algo no existe.` : "Todas son de lo que pidió.";
        // Al modelo solo le hacen falta los títulos: el cliente ya ve las fotos y el detalle.
        return { brief, ideas: encontradas.map((decoracion) => ({ titulo: decoracion.titulo, coincidencia: decoracion.coincidencia })), aviso };
      },
      proponer_composicion: async (args: Record<string, unknown>) => {
        const base = PropuestaComposicionSchema.parse(args);
        // El alcance que eligió el cliente manda aunque el modelo se salga del esquema del turno.
        const piezas = alcancePropuesta === "individual"
          ? [{ estructura: piezaPedida ?? base.piezas[0]!.estructura, cantidad: 1 }]
          : alcancePropuesta === "completa" ? base.piezas.map((pieza) => ({ ...pieza, cantidad: Math.min(pieza.cantidad, 4) })) : base.piezas;
        // Cada pieza del plan es individual y un plan lleva como mucho 8 (MAX_PIEZAS_PLAN): la suma se acota aquí, a la vista.
        const acotadas = recortarCantidades(piezas);
        const validada = normalizarPropuestaComposicion({ ...base, piezas: acotadas.piezas });
        decidir("regla:propuesta_normalizada", "propuesta del modelo ajustada al alcance y al catálogo oficial", validada, { entrada: { propuestaModelo: base, alcancePropuesta, piezaPedida: piezaPedida ?? null, piezasTrasAlcance: piezas, piezasRecortadas: acotadas.recortadas } });
        datos.propuesta = validada;
        return { propuesta: validada, aviso: "Las piezas y colores vienen del catálogo oficial. Responde con una sola frase («Te preparo el plan con las cantidades exactas.»): la interfaz arma el plan en seguida." };
      },
      ofrecer_opciones: async () => { datos.opciones = ["contratar", "costear", "comprar", "aprender"]; return { opciones: datos.opciones }; },
      preguntar_uso: async () => { datos.preguntaUso = true; return { pregunta: "¿Es para tu negocio o para uso personal?" }; },
      pasos_decoracion: async (args: Record<string, unknown>) => {
        const entrada = ArgsSchema.parse(args);
        const deco = proveedores.find((item) => item.id === (entrada.decoracionId ?? decoracionConfirmada));
        if (!deco) return { ok: false, motivo: decoracionConfirmada ? "decoracion_no_disponible" : "falta_que_el_cliente_elija_una_decoracion" };
        // El modelo lee los pasos tal como los verá el cliente: sin «R-12» que repetir en su respuesta.
        const pasos = pasosParaCliente(deco.pasos);
        datos.pasos = pasos;
        return { pasos };
      },
      buscar_proveedores: async (args: Record<string, unknown>) => {
        const entrada = ArgsSchema.parse(args);
        const ciudadPedida = (entrada.ciudad ?? "").trim();
        const ciudadBusqueda = normalizarBusqueda(ciudadPedida);
        // Sin ciudad escrita por el cliente no se busca: antes el modelo inventaba una y el cliente veía un directorio vacío.
        if (!ciudadBusqueda || !textoCliente.includes(` ${ciudadBusqueda} `)) {
          decidir("regla:proveedores_ciudad", "buscar proveedores", { busca: false }, { entrada: { ciudadModelo: ciudadPedida, tipo: entrada.tipo ?? null }, motivo: "el cliente no escribió esa ciudad" });
          return { ok: false, motivo: "falta_ciudad", accion_requerida: "Pregunta en qué ciudad está el cliente, en una frase, cerrando con «Opciones: Bogotá | Medellín | Cali | Barranquilla | Otra ciudad»." };
        }
        // «Decorador» es uno solo para el cliente: certificados HAPPIA y Master Balloon Pro salen juntos.
        const tipos: ReadonlyArray<string | undefined> = entrada.tipo === "decorador_happia" || entrada.tipo === "mbp" ? ["decorador_happia", "mbp"] : [entrada.tipo];
        const ciudad = normalizarCiudad(ciudadPedida);
        const encontrados = directorio.filter((item) => tipos.includes(item.tipo) && (normalizarCiudad(item.zona.ciudad) === ciudad || item.zona.cobertura.some((zona) => normalizarCiudad(zona) === ciudad)));
        datos.proveedores = encontrados;
        datos.ciudadProveedores = ciudadPedida;
        decidir("regla:proveedores_ciudad", "proveedores que ve el cliente", { busca: true, total: encontrados.length, proveedores: encontrados.map((item) => ({ nombre: item.nombre, tipo: item.tipo, ciudad: item.zona.ciudad })) }, { entrada: { ciudad: ciudadPedida, ciudadNormalizada: ciudad, tipos } });
        if (encontrados.length) return { proveedores: encontrados.map((item) => ({ nombre: item.nombre, ...(item.especialidad ? { especialidad: item.especialidad } : {}), ciudad: item.zona.ciudad })) };
        const ciudadesDisponibles = [...new Set(directorio.filter((item) => tipos.includes(item.tipo)).map((item) => item.zona.ciudad))];
        datos.ciudadesDisponibles = ciudadesDisponibles;
        return { proveedores: [], ciudadesDisponibles, aviso: "No hay registros en esa ciudad: dilo con honestidad en una frase y ofrece las ciudades donde sí hay." };
      },
      costear_decoracion: async (args: Record<string, unknown>) => {
        // La decoración y el uso son los que el cliente eligió con los botones (estadoGuiado): el modelo no ve los
        // ids internos y adivinarlos hacía fallar el costeo varias veces seguidas. Si aun así manda uno, debe coincidir.
        const pedida = ArgsSchema.parse(args);
        const entrada = { decoracionId: pedida.decoracionId ?? decoracionConfirmada, uso: pedida.uso ?? usoConfirmado };
        if (!usoConfirmado || entrada.uso !== usoConfirmado || !decoracionCotizableCoincide(decoracionConfirmada, entrada.decoracionId) || !proveedores.some((item) => item.id === entrada.decoracionId)) {
          const motivo = !usoConfirmado ? "falta_que_el_cliente_elija_negocio_o_personal" : "uso_o_decoracion_no_validado_por_el_cliente";
          decidir("regla:cotizacion_guiada", "costear la idea elegida", { cotiza: false, motivo }, { entrada: { pedida, decoracionConfirmada: decoracionConfirmada ?? null, usoConfirmado: usoConfirmado ?? null } });
          return { ok: false, motivo };
        }
        datos.uso = usoConfirmado;
        const decoracion = proveedores.find((item) => item.id === entrada.decoracionId);
        if (!decoracion || decoracion.materiales.length === 0) {
          datos.cotizacion = null;
          return { ok: false, motivo: "costeo_pendiente_datos_de_catalogo", aviso: "Esta decoración todavía no tiene productos asociados en el catálogo; no inventes un precio." };
        }
        const entradaCotizacion = ListaMaterialesRequestSchema.parse({ schema_version: "lista-materiales.v1", materiales: decoracion.materiales.map((material) => ({ variant_id: material.variantId, cantidad: material.cantidad })) });
        const cotizada = await llamarPythonListaMateriales({ entrada: entradaCotizacion, requestId: crypto.randomUUID(), correlationId: requestId, parentSignal: deadline.signal });
        const cotizacion = CotizacionGuiadaSchema.parse({
          lineas: cotizada.lineas.map((linea) => {
            const presentacion = presentacionMaterialGuiado(decoracion.materiales.find((material) => material.variantId === linea.variant_id)?.nota);
            return { id: linea.variant_id, tamano: "sin tamaño aplicable", ...presentacion, cantidadNecesaria: linea.cantidad_necesaria, disponible: true, varianteId: linea.variant_id, precioPaquete: linea.precio_paquete, unidadesPaquete: linea.unidades_paquete, paquetes: linea.paquetes, subtotal: linea.subtotal, sobrante: linea.sobrante };
          }),
          total: cotizada.total, mermaPorcentaje: 0, incluyeIva: true, complementosSoportados: false,
        });
        datos.cotizacion = cotizacion;
        decidir("regla:cotizacion_guiada", "precio de los materiales de la idea elegida (Python)", { cotiza: true, total: cotizacion.total, lineas: cotizacion.lineas.length }, { entrada: { decoracionId: decoracion.id, uso: usoConfirmado, materiales: entradaCotizacion.materiales } });
        return { cotizacion, incluyeIva: true, uso: usoConfirmado, aviso: "Precio de los materiales en la tienda en línea, con IVA. No incluye montaje." };
      },
      abrir_accion_plan: async (args: Record<string, unknown>) => {
        const { accion } = z.object({ accion: z.enum(ACCIONES_PLAN) }).strict().parse(args);
        if (!planActual) return { ok: false, motivo: "sin_plan_vigente" };
        datos.accionPlan = accion;
        return { ok: true, accion, aviso: "La interfaz abre esa acción sobre el plan: acompáñala con una frase corta y no describas lo que va a ver." };
      },
    };
    // Auditada por dentro: cada herramienta deja argumentos, resultado y el error real con su pila (protegerHerramientas lo convierte en ok:false para el modelo).
    const registroProtegido = protegerHerramientas(envolverRegistroHerramientas(registro));
    const elegida = decoracionConfirmada ? proveedores.find((item) => item.id === decoracionConfirmada) : undefined;
    const tematicasCatalogo = textoTematicasCatalogo();
    decidir("regla:tematicas_catalogo", "temáticas que el modelo puede ofrecer (solo con decoraciones reales)", tematicasCatalogo, { entrada: { decoracionElegida: elegida ? { id: elegida.id, titulo: elegida.titulo } : null, uso: usoConfirmado ?? null, planVigente: Boolean(planActual) } });
    // Dueño (2026-10-07): nada que desemboque en «no encontré». El modelo recibe los géneros y estilos que llevan a
    // decoraciones reales (corriendo la búsqueda de cada uno) y el saneo final lo garantiza.
    const mensajesCliente = messages.filter((mensaje) => mensaje.role === "user").map((mensaje) => mensaje.content);
    const eventoTurno = (): string | undefined => briefVigente().evento ?? eventoDeMensajes(mensajesCliente);
    const generos = generosBabyShower();
    const generosValidos = generos.filter((item) => item.ideas > 0).map((item) => item.genero);
    const generosSin = generos.filter((item) => item.ideas === 0).map((item) => NOMBRE_GENERO[item.genero]);
    const eventoInicial = eventoTurno();
    const edadInicial = briefVigente().edad || undefined;
    const estilosEvento = eventoInicial
      ? tematicasDisponibles(eventoInicial).map((tematica) => ({ tematica, ideas: ideasRealesDeOpcion(tematica, { evento: eventoInicial, edad: edadInicial }) })).filter((item) => item.ideas > 0)
      : [];
    decidir("regla:opciones_validas_turno", "géneros y estilos que llevan a decoraciones reales (los únicos que se ofrecen)", { generos, evento: eventoInicial ?? null, estilos: estilosEvento }, {
      entrada: { briefEvento: briefVigente().evento ?? null, eventoDeMensajes: eventoDeMensajes(mensajesCliente) ?? null, edad: edadInicial ?? null },
    });
    const estadoConfirmado = [
      elegida ? `Decoración elegida por el cliente en la interfaz: «${elegida.titulo}».` : "El cliente todavía no eligió una idea del catálogo.",
      usoConfirmado ? `Uso elegido: ${usoConfirmado === "negocio" ? "para su negocio" : "uso personal"}.` : "El cliente todavía no eligió si es para negocio o uso personal.",
      planActual ? `Plan vigente del cliente: ${textoPlanActual(planActual)} Si pide un cambio, llama proponer_composicion conservando todo lo que no pidió cambiar.` : "El cliente todavía no tiene un plan a medida.",
      `Temáticas del catálogo (las ÚNICAS que puedes ofrecer en «Opciones:» al preguntar temática, estilo o colores; elige 3-6 que encajen con el evento): ${tematicasCatalogo}.`,
      `Géneros de baby shower con decoraciones (los ÚNICOS que puedes ofrecer al preguntar el género): ${generosValidos.map((genero) => NOMBRE_GENERO[genero]).join(", ") || "ninguno (no preguntes el género: pregunta el estilo)"}${generosSin.length ? `; NO ofrezcas ${generosSin.join(" ni ")}: no hay decoraciones` : ""}.`,
      ...(eventoInicial && estilosEvento.length ? [`Estilos con decoraciones para ${eventoInicial} (ofrece solo estos al preguntar estilo o colores): ${estilosEvento.map((item) => item.tematica).join(" | ")}.`] : []),
    ].join(" ");
    let herramientasTurno: Herramienta[] = herramientas.filter((herramienta) => decoracionConfirmada || !HERRAMIENTAS_DE_DECORACION.has(herramienta.nombre));
    if (planActual) herramientasTurno = [...herramientasTurno, herramientaAccionPlan];
    // En el turno en que el cliente elige «completa» o «individual» solo existe la herramienta de propuesta (y la del brief):
    // con todas disponibles el modelo a veces buscaba en la biblioteca y mostraba una idea del carrusel (2026-10-06).
    if (alcancePropuesta) {
      herramientasTurno = herramientas.filter((herramienta) => herramienta.nombre === "proponer_composicion" || herramienta.nombre === "guardar_brief_guiado").map((herramienta): Herramienta => {
        if (herramienta.nombre !== "proponer_composicion") return herramienta;
        const esquema = esquemaHerramientaPropuesta(herramienta.esquema, alcancePropuesta, piezaPedida);
        const { description, ...campos } = esquema;
        return { ...herramienta, descripcion: `${String(description)} Usa ids oficiales y colores permitidos.`, esquema: campos };
      });
    }
    decidir("regla:herramientas_turno", "herramientas que el modelo tiene en este turno", herramientasTurno.map((herramienta) => herramienta.nombre), {
      motivo: alcancePropuesta ? `alcance «${alcancePropuesta}»: solo propuesta y brief` : decoracionConfirmada ? "hay una idea elegida" : "sin idea elegida: sin herramientas de decoración",
    });
    const instruccionTurno = alcancePropuesta
      ? `\n\nEN ESTE TURNO el cliente eligió ${alcancePropuesta === "completa" ? "una decoración completa (2-3 piezas)" : `una pieza individual${piezaPedida ? `: ${ESTRUCTURAS_OFICIALES[piezaPedida].nombre.toLocaleLowerCase("es")}` : ""}`}: llama proponer_composicion ahora y no busques ideas en la biblioteca.`
      : "";
    // Fuera de plan, propuesta y proveedores, cada frase y cada opción que ve el cliente lleva a decoraciones reales.
    const contextoRespuesta = (): ContextoRespuesta => ({
      evento: eventoTurno(), edad: briefVigente().edad || undefined, generosValidos,
      aplicar: !(planActual || alcancePropuesta || datos.propuesta || datos.proveedores !== undefined || datos.ciudadesDisponibles !== undefined),
      ideasEnTurno: Array.isArray(datos.decoraciones) ? datos.decoraciones.length : 0,
    });
    // El texto que se transmite también va saneado (oración a oración): el cliente no ve «No encontré…» ni un instante.
    const filtroFlujo = planActual || alcancePropuesta ? null : new FiltroFlujoGuiado(contextoRespuesta);
    const generador = ejecutarConversacionStream({ chat, sistema: `${PROMPT_GUIADO}\n\nEstado confirmado (no lo leas en voz alta): ${estadoConfirmado}${instruccionTurno}`, historial, herramientas: herramientasTurno, registro: registroProtegido, vueltasMax: 8, herramientasSoloLectura: new Set(["buscar_decoraciones_sempertex", "pasos_decoracion", "buscar_proveedores"]), signal: deadline.signal, telemetria: { flujo: "armador_decoracion", requestId, correlationId: requestId, superficie: "/api/asistente-guiado", promptVersion: "asistente-guiado.v2" } });
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
            if (deadline.signal.aborted) break;
            if (evento.tipo === "texto") {
              const delta = filtroFlujo ? filtroFlujo.empujar(evento.delta) : evento.delta;
              if (delta) mandar("texto", { delta });
            } else if (evento.tipo === "herramienta") mandar("herramienta", { nombre: evento.nombre, estado: evento.estado, ok: evento.ok });
            else {
              const crudo = evento.resultado.texto;
              const contexto = contextoRespuesta();
              // 1) Palabras de estilo que no están en ninguna temática del evento; 2) cada opción, pregunta y frase contra la
              // búsqueda real (sanearRespuestaGuiada): sin «no encontré» y sin alternativas que no llevan a decoraciones.
              const disponibles = contexto.aplicar ? tematicasDisponibles(contexto.evento) : [];
              const porTematica = contexto.aplicar ? sanearOpcionesCatalogo(crudo, disponibles) : crudo;
              const saneo = sanearRespuestaGuiada(porTematica, contexto);
              let reply = saneo.texto;
              let ideasForzadas = 0;
              if (saneo.huboFracaso && !contexto.ideasEnTurno && contexto.evento) {
                // El modelo anunció un fracaso sin mostrar ideas: se muestran las reales más cercanas del evento.
                const brief = briefVigente();
                const respaldo = ideasGuiadas({ evento: contexto.evento, edad: contexto.edad, tematica: brief.tematica, ultimoUsuario });
                if (respaldo.ideas.length) {
                  datos.decoraciones = respaldo.ideas;
                  datos.brief ??= { evento: contexto.evento, edad: contexto.edad ?? 0, tematica: (brief.tematica || ultimoUsuario || contexto.evento).slice(0, 160) };
                  ideasForzadas = respaldo.ideas.length;
                  reply = FRASE_IDEAS_GUIADAS;
                  decidir("regla:ideas_sin_fracaso", "el modelo dijo «no encontré» sin mostrar ideas: se muestran las reales más cercanas", { total: respaldo.ideas.length, via: respaldo.via, ideas: respaldo.ideas.map((idea) => ({ id: idea.id, titulo: idea.titulo, coincidencia: idea.coincidencia })) }, {
                    entrada: { evento: contexto.evento, tematica: brief.tematica ?? null, ultimoUsuario, textoModelo: crudo },
                  });
                }
              }
              decidir("regla:sanear_opciones_catalogo", "opciones, preguntas y frases que ve el cliente (solo lo que lleva a decoraciones reales)", {
                aplicado: contexto.aplicar, cambio: reply !== crudo, ...diferenciaOpciones(crudo, reply),
                opcionesEvaluadas: saneo.opciones?.evaluadas ?? [], quitadasSinIdeas: saneo.opciones?.quitadas ?? [], anadidasConIdeas: saneo.opciones?.anadidas ?? [],
                frases: saneo.frases, respaldo: saneo.respaldo, ideasForzadas,
              }, {
                entrada: { tematicasDisponibles: disponibles, evento: contexto.evento ?? null, generosValidos, textoModelo: crudo },
                motivo: contexto.aplicar ? "solo se ofrece lo que lleva a decoraciones reales y nunca se anuncia «no encontré»" : "hay plan, propuesta o proveedores: no se tocan",
              });
              mandar("fin", { reply, brief: {}, proveedor: evento.resultado.proveedor, modelo: evento.resultado.modelo, result: datos });
            }
          }
          if (deadline.wasDeadlineExceeded() && !request.signal.aborted) mandar("error", { error: "Tardé más de la cuenta en responder. Inténtalo de nuevo.", code: "AI_TIMEOUT", retryable: true });
          controller.close();
        } catch (error) {
          const vencido = deadline.wasDeadlineExceeded();
          console.error("[asistente-guiado] fallo durante el turno", { requestId, vencido, error: error instanceof Error ? error.message : String(error) });
          if (!request.signal.aborted) {
            if (vencido) mandar("error", { error: "Tardé más de la cuenta en responder. Inténtalo de nuevo.", code: "AI_TIMEOUT", retryable: true });
            else mandar("error", { error: "No se pudo completar la respuesta. Puedes volver a intentarlo.", code: "INTERNAL_ERROR", retryable: true });
          }
          controller.close();
        } finally {
          deadline.dispose();
        }
      },
      cancel() { deadline.cancel(); deadline.dispose(); },
    });
    return new Response(stream, { headers: { ...headers, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
  } catch (error) {
    deadline.dispose();
    console.error("[asistente-guiado] fallo al preparar turno", { requestId, error: error instanceof Error ? error.message : String(error) });
    const fallo = falloProveedor(error);
    return NextResponse.json(envelopeHttp(requestId, fallo.code, fallo.message, fallo.retryable), { status: fallo.status, headers });
  }
}
