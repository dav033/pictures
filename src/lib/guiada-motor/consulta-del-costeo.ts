import { consultaConPlazo, type ConsultaConPlazo } from "@/lib/rag/consulta-con-plazo";

/**
 * Cuánto se espera al catálogo en UN costeo (D-038): el turno de la vista guiada tiene 60 s y el pool del RAG solo corta a los 30, así
 * que cada lectura del catálogo que pide el precio de una idea (presentaciones, cruce de ahora, snapshot publicado) tiene su plazo y
 * entre todas comparten el presupuesto. Vencido, lo que falta se cotiza sin ellas y se dice (`fuera`): nunca un turno colgado.
 */
export const PLAZO_CATALOGO_MS = 10_000;
export const CONEXION_CATALOGO_MS = 3_000;
export const CONSULTA_CATALOGO_MS = 5_000;

export type PlazosDelCatalogo = { presupuestoMs: number; conexionMs: number; consultaMs: number };
const PLAZOS: PlazosDelCatalogo = { presupuestoMs: PLAZO_CATALOGO_MS, conexionMs: CONEXION_CATALOGO_MS, consultaMs: CONSULTA_CATALOGO_MS };

type PoolDeLectura = Parameters<typeof consultaConPlazo>[0];

/** El pool del RAG, cargado al consultar: ni la ruta ni un turno que no toca el catálogo pagan `pg`. */
const poolDelRag = async (): Promise<PoolDeLectura> => (await import("@/lib/rag/db")).getRagPool();

/**
 * La conexión de solo lectura que usa un costeo. El pool se toma al consultar y el presupuesto empieza con la primera consulta; se corta
 * también si el turno se aborta.
 */
export function consultaDelCosteo(signal: AbortSignal, pool: () => Promise<PoolDeLectura> = poolDelRag, plazos: PlazosDelCatalogo = PLAZOS): ConsultaConPlazo {
  let presupuesto: AbortSignal | undefined;
  return {
    async query(texto, parametros) {
      presupuesto ??= AbortSignal.timeout(plazos.presupuestoMs);
      return consultaConPlazo(await pool(), { signal, presupuesto, conexionMs: plazos.conexionMs, consultaMs: plazos.consultaMs }).query(texto, parametros);
    },
  };
}
