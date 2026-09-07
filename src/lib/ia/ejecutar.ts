import "server-only";
import { ejecutarConversacion as core, ejecutarConversacionStream as coreStream } from "@sempertex/agente-core";
import type { Cotizacion } from "@/lib/cotizacion/motor";
import type { ResultadoMedidas } from "@/lib/medidas/geometria";
import type { ItemRechazado, ItemValidado } from "@/lib/rag/chat/validar";
import type { ProductoCandidato } from "@/lib/rag/chat/buscar";
import type { Faceta, FiltrosCatalogo } from "@/lib/shopify/consultas";
import type { Brief, DecoracionConProductos, Producto } from "@/lib/types";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import { crearEstadoConversacion, crearRegistroHerramientas, herramientasActivas, textoAlAgotarVueltas, VUELTAS_MAX } from "./registro-herramientas";
import type { EstadoConversacion } from "./registro-herramientas";
import type { ReferenceBlueprintV2 } from "./reference-blueprint";
import type { ChatPort, Mensaje } from "./tipos";
import type { CatalogAllowlist } from "@/lib/rag/retrieval/types";

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
  medidas?: ResultadoMedidas;
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

function empaquetar(estado: EstadoConversacion, texto: string, proveedor: ChatPort["id"], modelo: string): ResultadoConversacion {
  return {
    texto,
    brief: estado.brief,
    recomendaciones: estado.recomendaciones,
    decoraciones: estado.decoraciones,
    categorias: estado.categoriasSugeridas,
    filtrosCategorias: estado.filtrosCategorias,
    medidas: estado.medidas,
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
  signal?: AbortSignal;
}): Promise<ResultadoConversacion> {
  const solicitud = opts.historial.filter((mensaje) => mensaje.rol === "usuario").map((mensaje) => mensaje.texto).join(" ");
  const estado = crearEstadoConversacion(opts.brief, solicitud, opts.referenceBlueprint);
  const resultado = await core({
    chat: opts.chat,
    sistema: opts.sistema,
    historial: opts.historial,
    herramientas: herramientasActivas(),
    registro: crearRegistroHerramientas(estado, { catalogAllowlist: opts.catalogAllowlist }),
    vueltasMax: VUELTAS_MAX,
    onLlamada: opts.onLlamada,
    alAgotarVueltas: () => textoAlAgotarVueltas(estado),
    signal: opts.signal,
  });
  return empaquetar(estado, resultado.texto, resultado.proveedor, resultado.modelo);
}

export type EventoConversacion =
  | { tipo: "texto"; delta: string }
  | { tipo: "herramienta"; nombre: string; estado: "ejecutando" | "lista" }
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
  signal?: AbortSignal;
}): AsyncGenerator<EventoConversacion> {
  const solicitud = opts.historial.filter((mensaje) => mensaje.rol === "usuario").map((mensaje) => mensaje.texto).join(" ");
  const estado = crearEstadoConversacion(opts.brief, solicitud, opts.referenceBlueprint);
  const generador = coreStream({
    chat: opts.chat,
    sistema: opts.sistema,
    historial: opts.historial,
    herramientas: herramientasActivas(),
    registro: crearRegistroHerramientas(estado, { catalogAllowlist: opts.catalogAllowlist }),
    vueltasMax: VUELTAS_MAX,
    alAgotarVueltas: () => textoAlAgotarVueltas(estado),
    signal: opts.signal,
  });

  for await (const evento of generador) {
    if (evento.tipo === "fin") {
      yield { tipo: "fin", resultado: empaquetar(estado, evento.resultado.texto, evento.resultado.proveedor, evento.resultado.modelo) };
    } else {
      yield evento;
    }
  }
}
