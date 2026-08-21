import "server-only";
import { ejecutarConversacion as core, ejecutarConversacionStream as coreStream } from "@sempertex/agente-core";
import type { Cotizacion } from "@/lib/cotizacion/motor";
import type { ResultadoMedidas } from "@/lib/medidas/geometria";
import type { ItemRechazado, ItemValidado } from "@/lib/rag/chat/validar";
import type { ProductoCandidato } from "@/lib/rag/chat/buscar";
import type { Faceta, FiltrosCatalogo } from "@/lib/shopify/consultas";
import type { Brief, DecoracionConProductos, Producto } from "@/lib/types";
import { crearEstadoConversacion, crearRegistroHerramientas, herramientasActivas, textoAlAgotarVueltas, VUELTAS_MAX } from "./registro-herramientas";
import type { EstadoConversacion } from "./registro-herramientas";
import type { ChatPort, Mensaje } from "./tipos";

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
  };
}

export async function ejecutarConversacion(opts: {
  chat: ChatPort;
  sistema: string;
  historial: Mensaje[];
  brief: Brief;
  /** Observabilidad pura: se llama justo antes de ejecutar cada herramienta,
   * con su nombre y args ya parseados. No cambia el flujo. */
  onLlamada?: (nombre: string, args: Record<string, unknown>) => void;
}): Promise<ResultadoConversacion> {
  const estado = crearEstadoConversacion(opts.brief);
  const resultado = await core({
    chat: opts.chat,
    sistema: opts.sistema,
    historial: opts.historial,
    herramientas: herramientasActivas(),
    registro: crearRegistroHerramientas(estado),
    vueltasMax: VUELTAS_MAX,
    onLlamada: opts.onLlamada,
    alAgotarVueltas: () => textoAlAgotarVueltas(estado),
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
}): AsyncGenerator<EventoConversacion> {
  const estado = crearEstadoConversacion(opts.brief);
  const generador = coreStream({
    chat: opts.chat,
    sistema: opts.sistema,
    historial: opts.historial,
    herramientas: herramientasActivas(),
    registro: crearRegistroHerramientas(estado),
    vueltasMax: VUELTAS_MAX,
    alAgotarVueltas: () => textoAlAgotarVueltas(estado),
  });

  for await (const evento of generador) {
    if (evento.tipo === "fin") {
      yield { tipo: "fin", resultado: empaquetar(estado, evento.resultado.texto, evento.resultado.proveedor, evento.resultado.modelo) };
    } else {
      yield evento;
    }
  }
}
