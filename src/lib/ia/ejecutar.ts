import "server-only";
import { ejecutarConversacion as core, ejecutarConversacionStream as coreStream } from "@sempertex/agente-core";
import type { Cotizacion } from "@/lib/cotizacion/motor";
import type { ItemRechazado, ItemValidado } from "@/lib/rag/chat/validar";
import type { ProductoCandidato } from "@/lib/rag/chat/buscar";
import type { Faceta, FiltrosCatalogo } from "@/lib/shopify/consultas";
import type { Brief, DecoracionConProductos, Producto } from "@/lib/types";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import { referenciaSinGlobosYaPreguntada } from "@/lib/plan/restricciones";
import { crearEstadoConversacion, crearRegistroHerramientas, HERRAMIENTAS_SOLO_LECTURA, herramientasActivas, textoAlAgotarVueltas, VUELTAS_MAX } from "./registro-herramientas";
import type { EstadoConversacion } from "./registro-herramientas";
import type { ReferenceBlueprintV2 } from "./reference-blueprint";
import { sanearBrief } from "./brief-herramienta";
import { cierreAnticipado, disponibilidadDelTurno } from "./convergencia-plan";
import { colorDeCatalogo } from "@/lib/plan/colores-catalogo";
import { coloresFotoParaBusqueda } from "@/lib/plan/colores-referencia";
import { textoFinalTurno } from "./texto-final-turno";
import type { ChatPort, Mensaje } from "./tipos";
import type { CatalogAllowlist } from "@/lib/rag/retrieval/types";
import type { FlujoIA } from "@sempertex/agente-core";
import type { NivelCreatividad } from "./creatividad";

type TelemetriaConversacion = {
  flujo: FlujoIA;
  requestId?: string;
  correlationId?: string;
  superficie?: string;
  thinkingLevel?: string;
  promptVersion?: string;
};

/** What the HTTP route knows about the request (Plan A §A0.1 audit columns). */
type HechosRegistro = { tieneFotoEspacio?: boolean; tieneImagenesReferencia?: boolean; loraMode?: string };

function hechosDelTurno(opts: { referenceBlueprint?: ReferenceBlueprintV2; telemetria?: TelemetriaConversacion; hechosPeticion?: HechosRegistro }) {
  const hechos = opts.hechosPeticion ?? {};
  // Unknown stays unknown: without a blueprint and no route facts nothing is claimed.
  const tieneReferencia = opts.referenceBlueprint ? true : hechos.tieneImagenesReferencia;
  return {
    ...(tieneReferencia !== undefined ? { tieneReferencia } : {}),
    ...(hechos.tieneFotoEspacio !== undefined ? { tieneFotoEspacio: hechos.tieneFotoEspacio } : {}),
    ...(hechos.loraMode ? { loraMode: hechos.loraMode } : {}),
    superficie: opts.telemetria?.superficie ?? "/api/chat",
  };
}

/**
 * Este archivo es un wrapper delgado sobre el motor genérico de
 * @sempertex/agente-core: conserva la firma pública exacta que tenía antes
 * de esa extracción (mismos parámetros, mismo `ResultadoConversacion`
 * "gordo" con `recomendaciones`/`ragCandidatos`/etc.) para que
 * `src/app/api/chat/route.ts` y `scripts/eval-chat-thinking.ts` no tengan
 * que cambiar. Todo lo que antes vivía como `EstadoConversacion` mutable
 * dentro del loop ahora vive en `./registro-herramientas`, capturado en el
 * closure del `registro` que se le pasa al motor — el motor genérico nunca
 * ve `Brief`/`Producto`/nada específico de decoración.
 */

export type ResultadoConversacion = {
  texto: string;
  brief: Brief;
  recomendaciones: Producto[];
  decoraciones: DecoracionConProductos[];
  categorias: Faceta[];
  filtrosCategorias?: FiltrosCatalogo;
  cotizacion?: Cotizacion;
  proveedor: ChatPort["id"];
  modelo: string;
  seleccionFinalIA?: Producto[];
  instruccionIA?: string;
  ragCandidatos?: ProductoCandidato[];
  ragValidados?: ItemValidado[];
  ragRechazados?: ItemRechazado[];
  ragTotal?: number;
  plan?: PlanResuelto;
  referenceBlueprint?: ReferenceBlueprintV2;
};

/**
 * One state per turn. The request joins every customer message (event label,
 * named pieces, budget), while colors and structures follow the latest messages
 * (restricciones-conversacion.ts, E2E 2026-09-15 D3).
 */
function estadoDelTurno(historial: Mensaje[], brief: Brief, referenceBlueprint: ReferenceBlueprintV2 | undefined): EstadoConversacion {
  const mensajesCliente = historial.flatMap((mensaje) => (mensaje.rol === "usuario" ? [mensaje.texto] : []));
  return crearEstadoConversacion(brief, mensajesCliente.join(" "), referenceBlueprint, {
    referenciaSinGlobosPreguntada: referenciaSinGlobosYaPreguntada(historial),
    mensajesCliente,
  });
}

/**
 * Time budget of one turn (convergencia-plan.ts): past the limit the turn ends
 * with a useful question, or with the proposal already on screen, instead of
 * calling the model until the route deadline.
 */
function cierreDelTurno(estado: EstadoConversacion): string | null {
  const pedidosCliente = estado.restriccionesUsuario.colores.filter((color) => color.polaridad === "obligatorio").map((color) => colorDeCatalogo(color.valor));
  const coloresPedidos = pedidosCliente.length ? pedidosCliente : coloresFotoParaBusqueda(estado.referenceBlueprint);
  const coloresDisponibles = [...disponibilidadDelTurno(estado.ragCandidatos ?? []).values()]
    .filter((producto) => producto.mezclas.length > 0)
    .flatMap((producto) => producto.colores);
  return cierreAnticipado({
    transcurridoMs: Date.now() - estado.inicioTurnoMs,
    hayPlan: Boolean(estado.planResuelto),
    coloresPedidos: [...new Set(coloresPedidos)],
    coloresDisponibles: [...new Set(coloresDisponibles)],
  });
}

/** Never an empty turn, never a claimed change without a plan (texto-final-turno.ts). */
function textoDelTurno(estado: EstadoConversacion, texto: string, historial: Mensaje[]): string {
  return textoFinalTurno(texto, { planConfirmado: Boolean(estado.planResuelto), seleccionConfirmada: Boolean(estado.seleccionFinalIA?.length) }, historial);
}

function empaquetar(estado: EstadoConversacion, texto: string, proveedor: ChatPort["id"], modelo: string): ResultadoConversacion {
  return {
    texto,
    // The `fin` event validates the brief strictly: only valid fields leave the turn.
    brief: sanearBrief(estado.brief),
    recomendaciones: estado.recomendaciones,
    decoraciones: estado.decoraciones,
    categorias: estado.categoriasSugeridas,
    filtrosCategorias: estado.filtrosCategorias,
    cotizacion: estado.cotizacion,
    proveedor,
    modelo,
    seleccionFinalIA: estado.seleccionFinalIA,
    instruccionIA: estado.instruccionIA,
    ragCandidatos: estado.ragCandidatos,
    ragValidados: estado.ragValidados,
    ragRechazados: estado.ragRechazados,
    ragTotal: estado.ragTotal,
    plan: estado.planResuelto,
    referenceBlueprint: estado.referenceBlueprint,
  };
}

export async function ejecutarConversacion(opts: {
  chat: ChatPort;
  sistema: string;
  historial: Mensaje[];
  brief: Brief;
  /** Blueprint de referencia visual analizado en este turno — ver
   * `EstadoConversacion.referenceBlueprint`. */
  referenceBlueprint?: ReferenceBlueprintV2;
  /** Observabilidad pura: se llama justo antes de ejecutar cada herramienta,
   * con su nombre y args ya parseados. No cambia el flujo. */
  onLlamada?: (nombre: string, args: Record<string, unknown>) => void;
  catalogAllowlist?: CatalogAllowlist;
  /** `LORA_*` cause when the LoRA catalog pool is unavailable; see crearRegistroHerramientas. */
  catalogoLoraNoDisponible?: string;
  signal?: AbortSignal;
  telemetria?: TelemetriaConversacion;
  hechosPeticion?: HechosRegistro;
}): Promise<ResultadoConversacion> {
  const estado = estadoDelTurno(opts.historial, opts.brief, opts.referenceBlueprint);
  const resultado = await core({
    chat: opts.chat,
    sistema: opts.sistema,
    historial: opts.historial,
    herramientas: herramientasActivas(),
    registro: crearRegistroHerramientas(estado, { catalogAllowlist: opts.catalogAllowlist, catalogoLoraNoDisponible: opts.catalogoLoraNoDisponible, correlationId: opts.telemetria?.correlationId, signal: opts.signal, hechosPeticion: hechosDelTurno(opts) }),
    herramientasSoloLectura: HERRAMIENTAS_SOLO_LECTURA,
    vueltasMax: VUELTAS_MAX,
    onLlamada: opts.onLlamada,
    alAgotarVueltas: () => textoAlAgotarVueltas(estado),
    cierreAnticipado: () => cierreDelTurno(estado),
    signal: opts.signal,
    telemetria: opts.telemetria ?? { flujo: "armador_decoracion", superficie: "/api/chat" },
  });
  return empaquetar(estado, textoDelTurno(estado, resultado.texto, resultado.historial), resultado.proveedor, resultado.modelo);
}

export type EventoConversacion =
  | { tipo: "texto"; delta: string }
  // `ok` acompaña a `lista`: una herramienta que terminó no es una que salió bien.
  | { tipo: "herramienta"; nombre: string; estado: "ejecutando" | "lista"; ok?: boolean }
  | { tipo: "fin"; resultado: ResultadoConversacion };

export async function* ejecutarConversacionStream(opts: {
  chat: ChatPort;
  sistema: string;
  historial: Mensaje[];
  brief: Brief;
  /** Blueprint de referencia visual analizado en este turno — ver
   * `EstadoConversacion.referenceBlueprint`. */
  referenceBlueprint?: ReferenceBlueprintV2;
  catalogAllowlist?: CatalogAllowlist;
  /** `LORA_*` cause when the LoRA catalog pool is unavailable; see crearRegistroHerramientas. */
  catalogoLoraNoDisponible?: string;
  /** Creativity level (creatividad.ts); the system prompt already carries its design rule. */
  creatividad?: NivelCreatividad;
  signal?: AbortSignal;
  telemetria?: TelemetriaConversacion;
  hechosPeticion?: HechosRegistro;
}): AsyncGenerator<EventoConversacion> {
  const estado = estadoDelTurno(opts.historial, opts.brief, opts.referenceBlueprint);
  const generador = coreStream({
    chat: opts.chat,
    sistema: opts.sistema,
    historial: opts.historial,
    herramientas: herramientasActivas(),
    registro: crearRegistroHerramientas(estado, { catalogAllowlist: opts.catalogAllowlist, catalogoLoraNoDisponible: opts.catalogoLoraNoDisponible, correlationId: opts.telemetria?.correlationId, signal: opts.signal, creatividad: opts.creatividad, hechosPeticion: hechosDelTurno(opts) }),
    herramientasSoloLectura: HERRAMIENTAS_SOLO_LECTURA,
    vueltasMax: VUELTAS_MAX,
    alAgotarVueltas: () => textoAlAgotarVueltas(estado),
    cierreAnticipado: () => cierreDelTurno(estado),
    signal: opts.signal,
    telemetria: opts.telemetria ?? { flujo: "armador_decoracion", superficie: "/api/chat" },
  });

  for await (const evento of generador) {
    if (evento.tipo === "fin") {
      yield { tipo: "fin", resultado: empaquetar(estado, textoDelTurno(estado, evento.resultado.texto, evento.resultado.historial), evento.resultado.proveedor, evento.resultado.modelo) };
    } else {
      yield evento;
    }
  }
}
