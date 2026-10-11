import { ejecutarConversacionStream } from "@sempertex/agente-core";
import type { Herramienta, Mensaje } from "@sempertex/agente-core";
import { NextResponse } from "next/server";
import { z } from "zod";
import { bibliotecaVisible, coloresTipicosDe, esPersonaje, normalizarBusqueda, paletasSugeridasDe, proveedoresVisibles, tematicasDisponibles } from "@/lib/biblioteca-sempertex/biblioteca";
import { detectarCambioTematica } from "@/lib/ia/guiado/cambio-tematica";
import { diferenciaOpciones, sanearOpcionesCatalogo } from "@/lib/ia/guiado/opciones-catalogo";
import { eventoDeMensajes, generosBabyShower, ideasGuiadas, ideasRealesDeOpcion, ideasYaVistas, NOMBRE_GENERO, tematicaFielAlCliente } from "@/lib/ia/guiado/ideas-guiadas";
import { esPedidoParecidasAFoto, ideasParecidasAFoto, ordenarIdeasPorPieza, pedidoDeIdeas } from "@/lib/ia/guiado/pedido-ideas";
import { CHIP_FOTO_GUIADA, FiltroFlujoGuiado, FRASE_IDEAS_GUIADAS, fraseCercanasYaDicha, sanearRespuestaGuiada, type CercanasPorColor, type ContextoRespuesta } from "@/lib/ia/guiado/respuesta-guiada";
import { AsistenteGuiadoRequestSchema, PropuestaComposicionSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { chatOmoikaneDe, resolverProveedor } from "@/lib/ia/nucleo/registro";
import { PROMPT_GUIADO } from "@/lib/ia/guiado/prompt-guiado";
import { ChatSseEventV1Schema, CHAT_SSE_CONTRACT_VERSION } from "@/lib/ia/contracts/chat-v1";
import { llamarPythonListaMateriales } from "@/lib/ia/nucleo/python-adapter";
import { leerMotorGuiada } from "@/lib/guiada-motor/bandera";
import { avisoEdicionDelPlanAbierto } from "@/lib/ia/guiado/aviso-edicion-plan";
import { filaDeCotizacionDeIdea, registrarAuditoriaPlan3d } from "@/lib/guiada-motor/auditoria-plan";
import { costearDecoracion } from "@/lib/guiada-motor/costear-idea";
import { ErrorIA } from "@/lib/ia/nucleo/tipos";
import type { ErrorCodeV1 } from "@/lib/ia/contracts/chat-v1";
import { decoracionCotizableCoincide, normalizarCiudad, protegerHerramientas } from "@/lib/ia/guiado/utilidades";
import { pasosParaCliente } from "@/lib/ia/guiado/pasos-cliente";
import { ESTRUCTURAS_OFICIALES, ESTRUCTURAS_OFICIALES_IDS, type EstructuraOficialId } from "@/lib/plan/estructuras-oficiales";
import { COLORES_PROPUESTA_V2 } from "@/lib/rag/taxonomy/v2";
import { coloresConTonosDelCliente } from "@/lib/plan/tonos-color";
import { normalizarPropuestaComposicion } from "@/lib/ia/guiado/propuesta-composicion";
import { recortarCantidades } from "@/lib/plan/piezas-individuales";
import { esquemaHerramientaPropuesta, type AlcancePropuesta } from "@/lib/ia/guiado/esquema-herramienta-propuesta";
import { textoPlanActual } from "@/lib/ia/guiado/instruccion-plan";
import { briefConHechos, etiquetaEdadCliente, hechosDelCliente, pedidoCompletoDePieza, piezaOrganicaDelBoton, propuestaConLoPedido, textoHechosCliente, usoDeTexto } from "@/lib/ia/guiado/hechos-cliente";
import type { BriefGuiado } from "@/lib/ia/contracts/asistente-guiado-v1";
import { conRegistro, contextoActual, decidir, envolverRegistroHerramientas } from "@/lib/registro";
import { crearDeadlineIA } from "@/lib/ia/plazo-servidor";
import { detectarEleccionIdea, detectarPedidoEdicion, fraseDelPedido, HERRAMIENTA_ELEGIR_IDEA, HERRAMIENTAS_EDICION, herramientasConEdicion, ideaDesdeHerramienta, pedidoDesdeHerramienta, textoIdeasParaModelo, textoPiezasParaModelo, type DeteccionEdicion, type HerramientaEdicion } from "@/lib/ia/guiado/edicion-plan-chat";

export const maxDuration = 75;

/** Tiempo máximo de un turno guiado: pasado esto el cliente recibe un error reintentable en vez de quedarse esperando. */
const DEADLINE_TURNO_MS = 60_000;
const ACCIONES_PLAN = ["ver", "costear", "comprar", "aprender", "contratar"] as const;

const herramientas: Herramienta[] = [
  { nombre: "guardar_brief_guiado", descripcion: "Guarda el evento y la temática que el cliente ya indicó; la edad solo si es un cumpleaños.", esquema: { type: "object", properties: { evento: { type: "string" }, edad: { type: "integer" }, tematica: { type: "string" } }, required: ["evento", "tematica"], additionalProperties: false } },
  { nombre: "buscar_decoraciones_sempertex", descripcion: "Busca ideas de decoración según evento y temática (y la edad solo en un cumpleaños).", esquema: { type: "object", properties: { evento: { type: "string" }, edad: { type: "integer" }, tematica: { type: "string" } }, required: ["evento", "tematica"], additionalProperties: false } },
  { nombre: "proponer_composicion", descripcion: "Propone entre una y tres estructuras oficiales para esta celebración. Usa exclusivamente ids oficiales y colores de la paleta Sempertex permitida. Llama cuando el cliente pida que le propongas algo, o un cambio de su plan que no cabe en las herramientas de edición (otra temática, varias piezas distintas a la vez, más sencillo). Sumar UNA pieza al plan no es esto: es agregar_pieza_plan.", esquema: { type: "object", properties: { frase: { type: "string" }, colores: { type: "array", description: "Usa el tono que dijo el cliente si es uno de los claros (celeste, rosa pastel, durazno), no su familia.", items: { type: "string", enum: [...COLORES_PROPUESTA_V2] }, minItems: 1, maxItems: 5 }, piezas: { type: "array", items: { type: "object", properties: { estructura: { type: "string", enum: [...ESTRUCTURAS_OFICIALES_IDS] }, cantidad: { type: "integer", minimum: 1, maximum: 12 } }, required: ["estructura", "cantidad"], additionalProperties: false }, minItems: 1, maxItems: 3 } }, required: ["frase", "colores", "piezas"], additionalProperties: false } },
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
const PIEZA_POR_BOTON: Readonly<Record<string, EstructuraOficialId>> = { "arco orgánico": "arco", columna: "columna", guirnalda: "guirnalda", semiarco: "semiarco", bouquet: "bouquet" };

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
  const planActual = estado?.planActual;
  const alcanceDeBoton = alcanceDelTurno(estado?.alcancePropuesta, ultimoUsuario, estado?.piezaPedida ?? piezaDeTextoBoton(ultimoUsuario));
  // Un pedido completo de UNA pieza («un arco orgánico de unos 3 metros en blanco y dorado para una boda») va directo a
  // su propuesta, como si hubiera tocado «Propónme algo» con esa pieza (probador 141, I-6: antes recibía 4 ideas de la
  // biblioteca que no eran arcos orgánicos). Solo sin plan, sin idea elegida, sin foto y sin otro alcance ya decidido.
  const pedidoDirecto = !alcanceDeBoton && !planActual && !estado?.decoracionId && !parsed.data.fotoInspiracion ? pedidoCompletoDePieza(ultimoUsuario) : null;
  const piezaBoton = estado?.piezaPedida ?? piezaDeTextoBoton(ultimoUsuario) ?? pedidoDirecto?.estructura.id;
  const alcancePropuesta = alcanceDeBoton ?? (pedidoDirecto ? "individual" : null);
  // Una pieza pedida solo restringe la pieza individual: en la decoración completa se ignora.
  const piezaPedida = alcancePropuesta === "individual" ? piezaBoton : undefined;
  decidir("regla:alcance_turno_guiado", "alcance de la propuesta y pieza pedida", { alcancePropuesta, piezaPedida: piezaPedida ?? null, pedidoDirecto: pedidoDirecto ? { pieza: pedidoDirecto.estructura.texto, medida: pedidoDirecto.medida.texto } : null }, {
    entrada: { alcanceDeclarado: estado?.alcancePropuesta ?? null, piezaDeclarada: estado?.piezaPedida ?? null, piezaBoton: piezaBoton ?? null, ultimoUsuario },
    motivo: estado?.alcancePropuesta ? "lo declaró la interfaz" : alcanceDeBoton ? "texto exacto de un botón" : pedidoDirecto ? "el cliente pidió una pieza con su medida: va directo a su propuesta (sin ideas de la biblioteca)" : "turno libre (sin alcance)",
  });
  // Lo que el cliente ya dijo, leído sin modelo (hechos-cliente.ts): evento, uso, medida, pieza, lugar, momento y
  // presupuesto. Usabilidad 97: «Soy decorador… arco orgánico de unos 3 metros… para una boda… cotizarle» perdía todo
  // menos los colores, y el uso se preguntaba otra vez aunque ya lo hubiera dicho o elegido.
  const mensajesDelCliente = messages.filter((mensaje) => mensaje.role === "user").map((mensaje) => mensaje.content);
  // El botón «Arco orgánico» (pieza individual) es el arco completo con mezcla de tamaños, como el texto «arco orgánico»:
  // su etiqueta se lee igual (`piezaOrganicaDelBoton`) y va al brief, de donde la vista saca las piezas orgánicas del plan.
  const organicaDelBoton = piezaOrganicaDelBoton(ultimoUsuario, piezaPedida);
  const hechosLeidos = hechosDelCliente(mensajesDelCliente);
  const hechos = organicaDelBoton ? { ...hechosLeidos, estructura: organicaDelBoton } : hechosLeidos;
  if (organicaDelBoton) decidir("regla:pieza_organica_boton", "el botón «Arco orgánico» es el arco completo con mezcla de tamaños (como el texto «arco orgánico»)", organicaDelBoton, { entrada: { piezaPedida: piezaPedida ?? null, ultimoUsuario } });
  // El uso: lo que dice el último mensaje («es para mi negocio»), lo que ya eligió (botones) o lo que dijo antes.
  const usoDelTurno = usoDeTexto(ultimoUsuario);
  const usoConfirmado = usoDelTurno ?? estado?.uso ?? hechos.uso;
  if (usoConfirmado && usoConfirmado !== estado?.uso) {
    decidir("regla:uso_del_cliente", "uso (negocio o personal) que el cliente ya dijo con sus palabras: no se vuelve a preguntar", usoConfirmado, {
      entrada: { usoInterfaz: estado?.uso ?? null, usoUltimoMensaje: usoDelTurno, usoConversacion: hechos.uso ?? null, ultimoUsuario },
      motivo: usoDelTurno ? "lo dice el último mensaje" : "lo dijo antes en la conversación",
    });
  }
  if (Object.keys(hechos).length) decidir("regla:hechos_cliente", "lo que el cliente ya dijo, leído sin modelo (evento, uso, medida, pieza, lugar, momento, presupuesto)", hechos, { entrada: { mensajesCliente: mensajesDelCliente.length, ultimoUsuario } });
  const decoracionConfirmada = estado?.decoracionId;
  const proveedores = bibliotecaVisible();
  const directorio = proveedoresVisibles();
  // Editar el plan vigente y elegir una idea POR CHAT, sin rehacer nada (edicion-plan-chat.ts; probador 104: «el azul
  // cámbialo por celeste… el resto igual» rehacía el plan entero). Las reglas leen el pedido antes que el modelo y
  // deciden sus herramientas: con un cambio puntual solo tiene las de edición, que aplica la vista con el editor.
  const idsVisibles = new Set(proveedores.map((item) => item.id));
  const ideasVisibles = (estado?.ideasMostradas ?? []).filter((idea) => idsVisibles.has(idea.id));
  // CRUD por chat (dueño, 2026-10-07): también sumar, mover y renombrar una pieza, y preguntar por el plan. «Hazla de 4
  // m» habla de la pieza que nombró el último mensaje del asistente («Listo: añadí una guirnalda…»).
  const ultimoAsistente = [...messages].reverse().find((mensaje) => mensaje.role === "assistant")?.content ?? null;
  const deteccionEdicion: DeteccionEdicion = planActual && !alcancePropuesta ? detectarPedidoEdicion(ultimoUsuario, planActual, { ultimoAsistente }) : { estado: "ninguna" };
  const edicionPuntual = deteccionEdicion.estado === "edicion" || deteccionEdicion.estado === "incompleta";
  // Una pregunta sobre el plan tampoco es elegir una idea, cambiar de temática ni pedir ideas.
  const turnoDelPlan = edicionPuntual || deteccionEdicion.estado === "consulta";
  const eleccionIdea = !alcancePropuesta && !turnoDelPlan ? detectarEleccionIdea(ultimoUsuario, ideasVisibles) : null;
  if (planActual) decidir("regla:edicion_plan_chat", "qué pide el cliente sobre su plan vigente (reglas, antes del modelo)", deteccionEdicion, { entrada: { ultimoUsuario, ultimoAsistente: ultimoAsistente?.slice(0, 300) ?? null, piezas: textoPiezasParaModelo(planActual), colores: planActual.colores, alcancePropuesta } });
  if (ideasVisibles.length) decidir("regla:elegir_idea_chat", "si el cliente elige con palabras una de las ideas que tiene a la vista", eleccionIdea ?? { elige: false }, { entrada: { ultimoUsuario, ideas: ideasVisibles.map((idea) => idea.titulo) } });
  // Lo que escribió el cliente, normalizado: la ciudad de buscar_proveedores tiene que salir de aquí, no del modelo.
  const textoCliente = ` ${normalizarBusqueda(mensajesDelCliente.join(" "))} `;
  // El brief del cliente solo se usa para completar; las herramientas fijan evento, edad y temática, y al final del turno
  // se le suma lo que dijo el cliente (`briefConHechos`).
  const briefPrevio = parsed.data.brief;
  const datos: Record<string, unknown> = {};
  // El uso que dijo con sus palabras vuelve a la interfaz: «Cuánto cuesta» lo abre ya elegido.
  if (usoConfirmado && usoConfirmado !== estado?.uso) datos.uso = usoConfirmado;
  const deadline = crearDeadlineIA(request.signal, DEADLINE_TURNO_MS);
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
    // Lo pedido sin decoraciones («Spiderman»): las ideas van en sus colores y se dice UNA vez por temática (respuesta-guiada).
    let cercanasPorColor: CercanasPorColor | null = null;
    const textosAsistente = messages.filter((mensaje) => mensaje.role === "assistant").map((mensaje) => mensaje.content);
    const cercanasDe = (tematica: string, exactas: number): CercanasPorColor | null => {
      if (exactas > 0) return null;
      const colores = coloresTipicosDe(tematica);
      // «spiderman» → «Spiderman»: un personaje es un nombre propio.
      const dicha = esPersonaje(tematica) ? tematica.trim().replace(/(^|\s)(\p{Ll})/gu, (_, espacio: string, letra: string) => `${espacio}${letra.toLocaleUpperCase("es")}`) : tematica;
      return colores.length && !fraseCercanasYaDicha(textosAsistente, tematica) ? { tematica: dicha, colores } : null;
    };
    // La temática que escribe el modelo se guarda con los colores que dijo el cliente, no con los de la temática del
    // catálogo más parecida («blanco y dorado» → no «Blanco, dorado y nude»; probador 2026-10-07, ideas-guiadas.ts).
    const dichoPorCliente = messages.filter((mensaje) => mensaje.role === "user").map((mensaje) => mensaje.content);
    const tematicaDelCliente = (tematica: string, herramienta: string): string => {
      const fiel = tematicaFielAlCliente(tematica, dichoPorCliente);
      if (fiel.quitados.length) decidir("regla:tematica_fiel_cliente", "temática guardada con los colores que dijo el cliente", { tematica: fiel.tematica, quitados: fiel.quitados }, { entrada: { herramienta, tematicaModelo: tematica } });
      return fiel.tematica;
    };
    /** Un cambio del plan vigente por chat: se valida contra el plan y las reglas, y la vista lo aplica con el editor. */
    const editarPlan = async (nombre: HerramientaEdicion, args: Record<string, unknown>) => {
      if (!planActual) return { ok: false, motivo: "sin_plan_vigente" };
      if (datos.edicionPlan) return { ok: false, motivo: "un_cambio_por_turno", accion_requerida: "Ya hay un cambio en camino: di cuál haces y que después puede pedir el siguiente." };
      const resultado = pedidoDesdeHerramienta(nombre, args, { plan: planActual, ultimoUsuario, deteccion: deteccionEdicion });
      decidir("regla:edicion_plan_chat", "cambio del plan vigente pedido por chat (lo aplica la vista con el editor, sin rehacer el plan)", resultado, { entrada: { herramienta: nombre, argsModelo: args, deteccion: deteccionEdicion } });
      if (!resultado.ok) return resultado;
      datos.edicionPlan = resultado.pedido;
      return { ok: true, cambio: fraseDelPedido(resultado.pedido), aviso: avisoEdicionDelPlanAbierto(estado) };
    };
    const herramientasDeEdicion = Object.fromEntries(HERRAMIENTAS_EDICION.map((nombre) => [nombre, (args: Record<string, unknown>) => editarPlan(nombre, args)]));
    const registro = {
      ...herramientasDeEdicion,
      [HERRAMIENTA_ELEGIR_IDEA]: async (args: Record<string, unknown>) => {
        if (!ideasVisibles.length) return { ok: false, motivo: "sin_ideas_a_la_vista" };
        const resultado = ideaDesdeHerramienta(args, ideasVisibles, eleccionIdea);
        decidir("regla:elegir_idea_chat", "idea elegida por chat (la vista hace lo mismo que «Me gusta esta»)", resultado, { entrada: { argsModelo: args, deteccion: eleccionIdea } });
        if (!resultado.ok) return resultado;
        datos.ideaElegida = resultado.idea;
        return { ok: true, idea: resultado.idea.titulo, aviso: "La interfaz marca esa idea como elegida y muestra lo que lleva y qué puede hacer con ella. Responde con UNA frase cálida, sin «Opciones:»." };
      },
      guardar_brief_guiado: async (args: Record<string, unknown>) => {
        const entrada = z.object({ evento: z.string().trim().min(1).max(120), edad: z.number().int().min(0).max(120).nullish(), tematica: z.string().trim().min(1).max(160) }).strict().parse(args);
        // 0 = «sin edad» (boda, baby shower…): el contrato de salida no cambia.
        const brief: BriefCompleto = { evento: entrada.evento, edad: entrada.edad ?? 0, tematica: tematicaDelCliente(entrada.tematica, "guardar_brief_guiado") };
        datos.brief = brief;
        return { brief };
      },
      buscar_decoraciones_sempertex: async (args: Record<string, unknown>) => {
        const pedida = z.object({ evento: z.string().trim().max(120).nullish(), edad: z.number().int().min(0).max(120).nullish(), tematica: z.string().trim().max(160).nullish() }).strict().parse(args);
        const previo = briefVigente();
        const evento = pedida.evento || previo.evento;
        const tematica = pedida.tematica ? tematicaDelCliente(pedida.tematica, "buscar_decoraciones_sempertex") : previo.tematica;
        if (!evento || !tematica) return { ok: false, motivo: "brief_incompleto", accion_requerida: "Pregunta lo que falta (qué celebra o qué temática o colores quiere) antes de buscar." };
        const brief: BriefCompleto = { evento, edad: pedida.edad ?? previo.edad ?? 0, tematica };
        datos.brief = brief;
        // Misma búsqueda con la que se validan las «Opciones:» (ideas-guiadas): el género del baby shower sale de la
        // temática o de los colores de cada idea, y si no hay de lo pedido van las reales más cercanas del mismo evento.
        const resultado = ideasGuiadas({ evento: brief.evento, edad: brief.edad, tematica: brief.tematica, ultimoUsuario });
        const encontradas = resultado.ideas;
        datos.decoraciones = encontradas;
        const exactas = encontradas.filter((decoracion) => decoracion.coincidencia === "exacta").length;
        cercanasPorColor = encontradas.length ? cercanasDe(brief.tematica, exactas) : null;
        decidir("regla:busqueda_biblioteca", "ideas reales del catálogo que ve el cliente", { total: encontradas.length, exactas, via: resultado.via, ideas: encontradas.map((decoracion) => ({ id: decoracion.id, titulo: decoracion.titulo, tematica: decoracion.tematica, coincidencia: decoracion.coincidencia })), cercanasPorColor }, {
          entrada: { brief, consulta: resultado.consulta, generoBaby: resultado.genero },
          ...(resultado.via === "evento" ? { motivo: "sin ideas de lo pedido: se muestran las reales más cercanas del mismo evento, sin anunciarlo como fracaso" } : resultado.via === "vacio" ? { motivo: "sin ideas para el evento: se ofrecen temáticas con decoraciones" } : {}),
        });
        if (!encontradas.length) {
          const conIdeas = tematicasDisponibles(brief.evento).filter((tematica) => ideasRealesDeOpcion(tematica, { evento: brief.evento, edad: brief.edad }) > 0).slice(0, 4);
          return { brief, ideas: [], aviso: `NO digas que no hay ni que no encontraste. Pregunta en una frase qué estilo le gusta y cierra con «Opciones: ${[...conIdeas, CHIP_FOTO_GUIADA].join(" | ")}».` };
        }
        const aviso = cercanasPorColor
          ? `Son ideas reales en los colores típicos de ${brief.tematica} (${cercanasPorColor.colores.join(", ")}): la interfaz ya le dice al cliente, con calidez, que no hay de esa temática exacta. No lo repitas ni digas «no encontré»: pregunta solo si alguna le gusta, en una frase.`
          : exactas === 0
          ? "Son ideas reales del catálogo, las más cercanas a lo que pidió: preséntalas con naturalidad («Te dejo unas ideas que pueden encantarte, ¿alguna te gusta?»). NO digas que no encontraste, que no hay ni que no son exactas."
          : exactas < encontradas.length ? `Las primeras ${exactas} son de lo que pidió y las demás, parecidas: preséntalas todas con naturalidad, sin decir que algo no existe.` : "Todas son de lo que pidió.";
        // Al modelo solo le hacen falta los títulos: el cliente ya ve las fotos y el detalle.
        return { brief, ideas: encontradas.map((decoracion) => ({ titulo: decoracion.titulo, coincidencia: decoracion.coincidencia })), aviso };
      },
      proponer_composicion: async (args: Record<string, unknown>) => {
        const base = PropuestaComposicionSchema.parse(args);
        // El alcance que eligió el cliente manda aunque el modelo se salga del esquema del turno.
        const delAlcance = alcancePropuesta === "individual"
          ? [{ estructura: piezaPedida ?? base.piezas[0]!.estructura, cantidad: 1 }]
          : alcancePropuesta === "completa" ? base.piezas.map((pieza) => ({ ...pieza, cantidad: Math.min(pieza.cantidad, 4) })) : base.piezas;
        // La pieza y la medida que pidió el cliente con sus palabras mandan sobre las del modelo («arco orgánico de unos 3
        // metros» → `arco` de 3 m de ancho, no `arco_asimetrico` de 2 m). Solo sin plan vigente: un cambio sobre el plan
        // conserva lo suyo (instruccion-plan.ts), y un botón de pieza individual manda sobre la pieza.
        const pedido = planActual ? { piezas: delAlcance, cambios: [] } : propuestaConLoPedido(delAlcance, { ...(hechos.estructura ? { estructura: hechos.estructura } : {}), ...(hechos.medida ? { medida: hechos.medida } : {}) }, { individual: alcancePropuesta === "individual", conservarPieza: Boolean(piezaPedida) });
        if (pedido.cambios.length) decidir("regla:propuesta_con_lo_pedido", "pieza y medida que pidió el cliente aplicadas a la propuesta del modelo", pedido.piezas, { entrada: { piezasModelo: delAlcance, estructura: hechos.estructura ?? null, medida: hechos.medida ?? null }, motivo: pedido.cambios.join("; ") });
        const piezas = pedido.piezas;
        // Cada pieza del plan es individual y un plan lleva como mucho 8 (MAX_PIEZAS_PLAN): la suma se acota aquí, a la vista.
        const acotadas = recortarCantidades(piezas);
        // El tono que dijo el cliente («celeste») y no la familia que eligió el modelo («azul»): tonos-color.ts.
        const colores = coloresConTonosDelCliente(base.colores, dichoPorCliente);
        const validada = normalizarPropuestaComposicion({ ...base, colores, piezas: acotadas.piezas });
        decidir("regla:propuesta_normalizada", "propuesta del modelo ajustada al alcance, al catálogo oficial y a los tonos del cliente", validada, { entrada: { propuestaModelo: base, alcancePropuesta, piezaPedida: piezaPedida ?? null, piezasTrasAlcance: piezas, piezasRecortadas: acotadas.recortadas, coloresConTonos: colores } });
        datos.propuesta = validada;
        return { propuesta: validada, aviso: "Las piezas y colores vienen del catálogo oficial. Responde con una sola frase («Te preparo el plan con las cantidades exactas.»): la interfaz arma el plan en seguida." };
      },
      ofrecer_opciones: async () => { datos.opciones = ["contratar", "costear", "comprar", "aprender"]; return { opciones: datos.opciones }; },
      preguntar_uso: async () => {
        // Ya lo eligió o lo dijo («soy decorador», «Para uso personal»): no se le vuelve a preguntar (usabilidad 97, punto 2).
        if (usoConfirmado) {
          decidir("regla:uso_del_cliente", "el modelo quiso preguntar el uso, pero el cliente ya lo dijo", { pregunta: false, uso: usoConfirmado }, { entrada: { usoInterfaz: estado?.uso ?? null, usoConversacion: hechos.uso ?? null } });
          return { ok: false, motivo: "uso_ya_elegido", uso: usoConfirmado, accion_requerida: "No preguntes el uso: llama costear_decoracion ahora." };
        }
        datos.preguntaUso = true;
        return { pregunta: "¿Es para tu negocio o para uso personal?" };
      },
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
        if (!decoracion) {
          datos.cotizacion = null;
          return { ok: false, motivo: "costeo_pendiente_datos_de_catalogo", aviso: "Esta decoración todavía no tiene productos asociados en el catálogo; no inventes un precio." };
        }
        // D-038: el precio de la idea es el del plan que el cliente recibe al elegirla (motor 3D o Python, según la bandera).
        // El motor, el cruce con la tienda (250 KB) y los planes guardados se cargan SOLO aquí, con `import()`: el resto de
        // los turnos no los paga, y el motor solo con la bandera en 3d.
        const costeo = await costearDecoracion(decoracion, usoConfirmado, {
          leerMotor: async () => (await leerMotorGuiada(request)).motor,
          tienePlanGuardado: async (ideaId) => (await import("@/lib/plan/planes-ideas-guardados")).planGuardadoDeIdea(ideaId) !== null,
          cotizarConMotor: async (ideaId) => {
            const [{ cotizarIdeaConMotor }, motor, { planGuardadoDeIdea }] = await Promise.all([import("@/lib/guiada-motor/cotizar-idea"), import("@/lib/globos3d/motor/v1"), import("@/lib/plan/planes-ideas-guardados")]);
            return cotizarIdeaConMotor(ideaId, {
              planGuardado: planGuardadoDeIdea, crosswalk: async () => motor.crosswalkIncluido(), crosswalkEnVivo: () => motor.crosswalkEnVivo(), snapshotPublicado: () => motor.snapshotPublicado(),
              cotizarLista: (entrada) => llamarPythonListaMateriales({ entrada, requestId: crypto.randomUUID(), correlationId: requestId, parentSignal: deadline.signal }),
            });
          },
          cotizarConPython: async (ideaId) => {
            const [{ cotizarIdeaConPython, DEADLINE_COTIZAR_IDEA_MS }, { planGuardadoDeIdea }, { resolverIdeaSola }] = await Promise.all([import("@/lib/guiada-motor/cotizar-idea-python"), import("@/lib/plan/planes-ideas-guardados"), import("@/lib/plan/resolver-idea")]);
            // Recordada por su pedido: «Crear mi plan con esta idea» la reutiliza (D-038).
            return cotizarIdeaConPython(ideaId, { planGuardado: planGuardadoDeIdea, resolver: (pedido) => resolverIdeaSola(pedido, { requestId: crypto.randomUUID(), correlationId: requestId, signal: deadline.signal, deadlineMs: DEADLINE_COTIZAR_IDEA_MS }) });
          },
          cotizarLista: (entrada) => llamarPythonListaMateriales({ entrada, requestId: crypto.randomUUID(), correlationId: requestId, parentSignal: deadline.signal }),
          auditar: decidir,
        });
        // Durable (plan_audit_log): `decidir` solo llega a stdout y a /tmp. Una fila por cada «¿cuánto cuesta?», con lo que
        // decidió el costeo (motor 3D, plan de Python, lista curada o sin precio), su motivo, el total y el hash del plan.
        const decision = costeo.decision;
        const filaAuditoria = filaDeCotizacionDeIdea(decision, decoracion.id, requestId, "/api/asistente-guiado");
        await registrarAuditoriaPlan3d(filaAuditoria);
        datos.cotizacion = costeo.cotizacion;
        return costeo.respuesta;
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
    // Cambio de temática a mitad (probador, 2026-10-06: «mejor cambiemos, mi hijo ahora quiere dinosaurios»): el servidor
    // guarda el brief nuevo (la cabecera lo refleja) y busca las ideas reales de la nueva temática antes de que hable el
    // modelo; en ese turno el modelo solo las presenta, sin herramientas (antes rehacía el mismo plan recoloreado).
    // Un cambio puntual del plan o elegir una idea con palabras no es cambiar de temática ni pedir ideas.
    const cambioTematica = alcancePropuesta || turnoDelPlan || eleccionIdea ? null : detectarCambioTematica({ ultimoUsuario, tematicaPrevia: briefPrevio.tematica });
    let ideasCambio: string[] = [];
    if (cambioTematica) {
      const eventoCambio = eventoTurno();
      if (eventoCambio) {
        const brief: BriefCompleto = { evento: eventoCambio, edad: briefVigente().edad ?? 0, tematica: cambioTematica.nueva.slice(0, 160) };
        const resultado = ideasGuiadas({ evento: brief.evento, edad: brief.edad, tematica: brief.tematica, ultimoUsuario });
        datos.brief = brief;
        if (resultado.ideas.length) datos.decoraciones = resultado.ideas;
        const exactas = resultado.ideas.filter((idea) => idea.coincidencia === "exacta").length;
        cercanasPorColor = resultado.ideas.length ? cercanasDe(brief.tematica, exactas) : null;
        ideasCambio = resultado.ideas.map((idea) => idea.titulo);
        decidir("regla:cambio_tematica", "el cliente cambió de temática: brief nuevo e ideas reales de la nueva temática", {
          brief, total: resultado.ideas.length, exactas, via: resultado.via, cercanasPorColor,
          ideas: resultado.ideas.map((idea) => ({ id: idea.id, titulo: idea.titulo, coincidencia: idea.coincidencia })),
        }, { entrada: { ultimoUsuario, briefPrevio, grupo: cambioTematica.grupo, planVigente: Boolean(planActual) }, motivo: cambioTematica.motivo });
      } else {
        decidir("regla:cambio_tematica", "el cliente nombró otra temática pero no se sabe el evento: lo resuelve el modelo", { aplicado: false }, { entrada: { ultimoUsuario, briefPrevio, grupo: cambioTematica.grupo } });
      }
    }
    // «Muéstrame otras ideas con columnas» (verificador, 2026-10-06, solicitud 2c18cf03): pedir VER ideas no es cambiar el
    // plan. Antes el modelo llamaba proponer_composicion, la vista la aceptaba sola y se armaba y cobraba un plan nuevo.
    // Ahora el servidor busca las ideas reales (primero las que llevan la pieza nombrada) y el modelo solo las presenta.
    const pedidoIdeas = alcancePropuesta || ideasCambio.length || turnoDelPlan || eleccionIdea ? null : pedidoDeIdeas(ultimoUsuario);
    let ideasPedidas: string[] = [];
    if (pedidoIdeas) {
      const vigente = briefVigente();
      const eventoIdeas = eventoTurno();
      if (eventoIdeas) {
        const edad = vigente.edad ?? 0;
        const resultado = ideasGuiadas({ evento: eventoIdeas, edad, tematica: vigente.tematica ?? "", ultimoUsuario });
        // «Prefiero ver ideas parecidas» a una foto (probador, 2026-10-07): las de su estructura y sus colores, sin las
        // que ya vio (antes volvía el mismo aro con `conPieza: 0`). Sin ninguna, la búsqueda de siempre.
        const aLaFoto = esPedidoParecidasAFoto(ultimoUsuario)
          ? ideasParecidasAFoto({ texto: ultimoUsuario, piezas: pedidoIdeas.piezas, evento: eventoIdeas, edad, excluir: ideasYaVistas({ evento: eventoIdeas, edad, tematica: vigente.tematica ?? "", mensajesPrevios: dichoPorCliente.slice(0, -1), ...(decoracionConfirmada ? { elegida: decoracionConfirmada } : {}) }) })
          : null;
        // Si la búsqueda no trae bastantes con la pieza nombrada, las del mismo evento que sí la llevan (como parecidas).
        const delEvento = pedidoIdeas.piezas.length ? ideasGuiadas({ evento: eventoIdeas, edad, tematica: "" }).ideas.map((idea) => ({ ...idea, coincidencia: "cercana" as const })) : [];
        const { ideas, conPieza } = aLaFoto?.ideas.length ? aLaFoto : ordenarIdeasPorPieza(resultado.ideas, delEvento, pedidoIdeas.piezas);
        if (ideas.length) {
          datos.decoraciones = ideas;
          ideasPedidas = ideas.map((idea) => idea.titulo);
          const exactas = ideas.filter((idea) => idea.coincidencia === "exacta").length;
          // Las parecidas a la foto no son «las ideas en los colores de la temática»: esa frase no va.
          cercanasPorColor = vigente.tematica && !aLaFoto?.ideas.length ? cercanasDe(vigente.tematica, exactas) : null;
        }
        decidir("regla:pedido_ideas", "el cliente pidió ver ideas del catálogo: se buscan aquí y su plan no cambia", {
          total: ideas.length, conPieza, via: aLaFoto?.ideas.length ? "parecidas_foto" : resultado.via, piezas: pedidoIdeas.piezas, ...(aLaFoto ? { conColor: aLaFoto.conColor } : {}),
          ideas: ideas.map((idea) => ({ id: idea.id, titulo: idea.titulo, coincidencia: idea.coincidencia, piezas: idea.piezas.map((pieza) => pieza.estructura) })),
        }, { entrada: { ultimoUsuario, brief: vigente, evento: eventoIdeas, planVigente: Boolean(planActual) }, ...(ideas.length ? {} : { motivo: "sin ideas para el evento: lo resuelve el modelo" }) });
      } else {
        decidir("regla:pedido_ideas", "el cliente pidió ver ideas pero no se sabe el evento: lo resuelve el modelo", { aplicado: false }, { entrada: { ultimoUsuario } });
      }
    }
    const eventoInicial = eventoTurno();
    const edadInicial = briefVigente().edad || undefined;
    const estilosEvento = eventoInicial
      ? tematicasDisponibles(eventoInicial).map((tematica) => ({ tematica, ideas: ideasRealesDeOpcion(tematica, { evento: eventoInicial, edad: edadInicial }) })).filter((item) => item.ideas > 0)
      : [];
    const paletasEvento = eventoInicial ? paletasSugeridasDe(eventoInicial) : [];
    decidir("regla:opciones_validas_turno", "géneros y estilos que llevan a decoraciones reales (los únicos que se ofrecen)", { generos, evento: eventoInicial ?? null, estilos: estilosEvento, paletasSugeridas: paletasEvento }, {
      entrada: { briefEvento: briefVigente().evento ?? null, eventoDeMensajes: eventoDeMensajes(mensajesCliente) ?? null, edad: edadInicial ?? null },
    });
    /** El brief del turno: el de antes, lo que fijaron las herramientas y lo que dijo el cliente (sin modelo). */
    const briefDelTurno = (): BriefGuiado => {
      const fijado = BriefCompletoSchema.safeParse(datos.brief);
      const { edadTexto: _edadAnterior, ...base }: BriefGuiado = { ...briefPrevio, ...(fijado.success ? fijado.data : {}) };
      void _edadAnterior;
      // «4 a 6 años» y no «5 años»: el rango que eligió el cliente, si es compatible con la edad que guardó el modelo.
      const edadTexto = base.edad && /cumple/i.test(base.evento ?? "") ? etiquetaEdadCliente(base.edad, mensajesDelCliente) : undefined;
      return briefConHechos(base, hechos, { ...(usoConfirmado ? { uso: usoConfirmado } : {}), ...(edadTexto ? { edadTexto } : {}) });
    };
    const hechosTexto = textoHechosCliente(briefDelTurno(), { conPlan: Boolean(planActual) });
    const estadoConfirmado = [
      elegida ? `Decoración elegida por el cliente en la interfaz: «${elegida.titulo}».` : "El cliente todavía no eligió una idea del catálogo.",
      usoConfirmado ? `Uso elegido: ${usoConfirmado === "negocio" ? "para su negocio" : "uso personal"} (no lo vuelvas a preguntar).` : "El cliente todavía no eligió si es para negocio o uso personal.",
      ...(hechosTexto ? [hechosTexto] : []),
      planActual
        ? `Plan vigente del cliente: ${textoPlanActual(planActual)} Piezas del plan (nómbralas así en las herramientas): ${textoPiezasParaModelo(planActual)}. Un cambio puntual (cambiar un color por otro, añadir o quitar un color, más o menos de un color, sumar una pieza, quitar una pieza, dejar una pieza en otros colores, moverla o renombrarla, agrandar, achicar o poner una medida) va SOLO con las herramientas de edición, que conservan todo lo demás; «agrégale una guirnalda» SUMA la pieza al plan (agregar_pieza_plan), nunca arma un plan nuevo. proponer_composicion solo si el pedido no cabe en ellas, conservando todo lo que no pidió cambiar.`
        : "El cliente todavía no tiene un plan a medida.",
      ...(ideasVisibles.length ? [`Ideas del catálogo que el cliente tiene a la vista, en orden: ${textoIdeasParaModelo(ideasVisibles)}. Si elige una con palabras, llama elegir_idea.`] : []),
      `Temáticas del catálogo (las ÚNICAS que puedes ofrecer en «Opciones:» al preguntar temática, estilo o colores; elige 3-6 que encajen con el evento): ${tematicasCatalogo}.`,
      `Géneros de baby shower con decoraciones (los ÚNICOS que puedes ofrecer al preguntar el género): ${generosValidos.map((genero) => NOMBRE_GENERO[genero]).join(", ") || "ninguno (no preguntes el género: pregunta el estilo)"}${generosSin.length ? `; NO ofrezcas ${generosSin.join(" ni ")}: no hay decoraciones` : ""}.`,
      ...(eventoInicial && estilosEvento.length ? [`Estilos con decoraciones para ${eventoInicial} (ofrece solo estos al preguntar estilo o colores): ${estilosEvento.map((item) => item.tematica).join(" | ")}.`] : []),
      ...(eventoInicial && paletasEvento.length ? [`Colores sugeridos para ${eventoInicial} (los típicos de esa celebración): ${paletasEvento.join(" | ")}. Al preguntar los colores, ofrece ESTOS primero en «Opciones:», en este orden, y «Otros colores» al final.`] : []),
    ].join(" ");
    // Con el uso ya dicho, preguntar_uso no existe en el turno: el modelo no puede volver a preguntarlo.
    let herramientasTurno: Herramienta[] = herramientas.filter((herramienta) => (decoracionConfirmada || !HERRAMIENTAS_DE_DECORACION.has(herramienta.nombre)) && !(usoConfirmado && herramienta.nombre === "preguntar_uso"));
    if (planActual) herramientasTurno = [...herramientasTurno, herramientaAccionPlan];
    // Las de edición del plan y elegir_idea; con un cambio puntual SOLO las de edición (el modelo ya no puede rehacer el
    // plan entero con proponer_composicion) y con una idea elegida con palabras solo elegir_idea (edicion-plan-chat.ts).
    herramientasTurno = herramientasConEdicion({ base: herramientasTurno, plan: planActual, ideas: ideasVisibles, deteccion: deteccionEdicion, eleccion: eleccionIdea }).herramientas;
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
    if (ideasCambio.length || ideasPedidas.length) herramientasTurno = [];
    decidir("regla:herramientas_turno", "herramientas que el modelo tiene en este turno", herramientasTurno.map((herramienta) => herramienta.nombre), {
      motivo: ideasCambio.length ? "cambio de temática: el servidor ya guardó el brief y buscó las ideas" : ideasPedidas.length ? "pidió ver ideas: el servidor ya las buscó y el plan no cambia" : alcancePropuesta ? `alcance «${alcancePropuesta}»: solo propuesta y brief` : edicionPuntual ? `cambio puntual del plan (${deteccionEdicion.estado}): solo herramientas de edición` : deteccionEdicion.estado === "consulta" ? "pregunta por su plan: sin herramientas" : eleccionIdea ? "eligió una idea con palabras: solo elegir_idea" : decoracionConfirmada ? "hay una idea elegida" : "sin idea elegida: sin herramientas de decoración",
    });
    const instruccionTurno = pedidoDirecto && alcancePropuesta === "individual"
      ? `\n\nEN ESTE TURNO el cliente ya pidió UNA pieza con su medida («${pedidoDirecto.estructura.texto}», «${pedidoDirecto.medida.texto}»): llama proponer_composicion ahora con esa pieza, en los colores que dijo (si no dijo colores, unos que combinen con su evento). No busques ideas en la biblioteca ni le preguntes nada más.`
      : alcancePropuesta
      ? `\n\nEN ESTE TURNO el cliente eligió ${alcancePropuesta === "completa" ? "una decoración completa (2-3 piezas)" : `una pieza individual${piezaPedida ? `: ${ESTRUCTURAS_OFICIALES[piezaPedida].nombre.toLocaleLowerCase("es")}` : ""}`}: llama proponer_composicion ahora y no busques ideas en la biblioteca.`
      : deteccionEdicion.estado === "edicion"
        ? `\n\nEN ESTE TURNO el cliente pidió un cambio puntual de su plan (${fraseDelPedido(deteccionEdicion.pedido)}): llama ${deteccionEdicion.herramienta} y responde con UNA frase corta que diga qué cambias. No rehagas el plan.`
      : deteccionEdicion.estado === "incompleta"
        ? `\n\nEN ESTE TURNO el cliente pidió un cambio puntual de su plan, pero falta un dato (${deteccionEdicion.motivo}): si lo deduces sin dudas llama la herramienta de edición; si no, pregúntaselo en una frase corta. No rehagas el plan.`
      : deteccionEdicion.estado === "consulta"
        ? "\n\nEN ESTE TURNO el cliente pregunta por su plan vigente: respóndele en una o dos frases con los datos del plan de arriba (piezas, medidas, colores y globos). No cambies nada ni llames herramientas."
      : eleccionIdea
        ? `\n\nEN ESTE TURNO el cliente eligió la idea «${eleccionIdea.idea.titulo}» (la ${eleccionIdea.posicion}.ª que tiene a la vista): llama elegir_idea y responde con UNA frase cálida, sin «Opciones:».`
      : ideasCambio.length && cambioTematica
        ? `\n\nEN ESTE TURNO el cliente cambió la temática de «${cambioTematica.anterior}» a «${cambioTematica.nueva}»: ya guardé el cambio y la interfaz le muestra estas ideas reales del catálogo: ${ideasCambio.map((titulo) => `«${titulo}»`).join(", ")}. Responde en una o dos frases cálidas: confirma el cambio y pregúntale si alguna le gusta o si prefiere que le proponga un plan nuevo con esa temática. No llames herramientas ni enumeres los títulos.`
        : ideasPedidas.length
          ? `

EN ESTE TURNO el cliente pidió ver ideas${pedidoIdeas?.palabra ? ` con ${pedidoIdeas.palabra}` : ""} del catálogo: la interfaz ya le muestra estas ideas reales: ${ideasPedidas.map((titulo) => `«${titulo}»`).join(", ")}. Responde en una o dos frases cálidas y pregúntale si alguna le gusta${planActual ? "; recuérdale que puede sumarla a su plan con «Agregar a mi plan» o crear un plan nuevo con ella" : ""}. No cambies su plan, no llames herramientas ni enumeres los títulos.`
          : "";
    // Fuera de plan, propuesta y proveedores, cada frase y cada opción que ve el cliente lleva a decoraciones reales.
    const contextoRespuesta = (): ContextoRespuesta => ({
      evento: eventoTurno(), edad: briefVigente().edad || undefined, generosValidos,
      aplicar: !(planActual || alcancePropuesta || datos.propuesta || datos.proveedores !== undefined || datos.ciudadesDisponibles !== undefined),
      ideasEnTurno: Array.isArray(datos.decoraciones) ? datos.decoraciones.length : 0,
      cercanasPorColor,
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
              // Respaldo: las reglas leyeron un cambio puntual completo (o la idea elegida) y el modelo no llamó su
              // herramienta. Se aplica lo que leyeron las reglas: el cliente nunca recibe «listo» sin cambio.
              if (deteccionEdicion.estado === "edicion" && !datos.edicionPlan && !datos.propuesta) {
                datos.edicionPlan = deteccionEdicion.pedido;
                reply = fraseDelPedido(deteccionEdicion.pedido);
                decidir("regla:edicion_plan_chat", "el modelo no llamó la herramienta de edición: se aplica lo que leyeron las reglas", deteccionEdicion.pedido, { entrada: { herramienta: deteccionEdicion.herramienta, textoModelo: crudo } });
              }
              if (datos.edicionPlan && datos.propuesta) {
                // Un cambio puntual no rehace el plan: la propuesta sobra.
                decidir("regla:edicion_plan_chat", "hubo un cambio puntual y una propuesta: se queda el cambio puntual", { descartada: datos.propuesta }, { entrada: { edicion: datos.edicionPlan } });
                delete datos.propuesta;
              }
              if (eleccionIdea && !datos.ideaElegida) {
                datos.ideaElegida = { id: eleccionIdea.idea.id, titulo: eleccionIdea.idea.titulo, posicion: eleccionIdea.posicion };
                decidir("regla:elegir_idea_chat", "el modelo no llamó elegir_idea: se elige la que leyeron las reglas", datos.ideaElegida, { entrada: { textoModelo: crudo } });
              }
              // El brief que vuelve lleva lo que dijo el cliente (evento, uso, medida, pieza…) y el rango de edad que eligió.
              const briefHerramientas = datos.brief ?? null;
              const briefFinal = briefDelTurno();
              const huella = (brief: object) => JSON.stringify(Object.entries(brief).sort(([a], [b]) => a.localeCompare(b)));
              if (huella(briefFinal) !== huella(briefPrevio)) {
                datos.brief = briefFinal;
                decidir("regla:brief_guiado", "brief que vuelve al cliente (herramientas + lo que dijo con sus palabras)", briefFinal, { entrada: { briefPrevio, briefHerramientas } });
              }
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
