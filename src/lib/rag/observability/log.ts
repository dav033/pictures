import type { Pool } from "pg";

/**
 * Trazabilidad (plan §6.1/§6.2): cada búsqueda y cada selección quedan en
 * Postgres, no solo en logs de consola que se pierden al reiniciar. Un fallo
 * al escribir el log NUNCA debe tumbar la conversación — por eso todo esto
 * atrapa sus propios errores en vez de dejarlos subir al caller.
 */
export async function registrarBusqueda(
  pool: Pool,
  datos: {
    requestId: string;
    mensaje: string;
    intent: unknown;
    retrievedProductIds: string[];
    retrievalScores: unknown;
    status: string;
    latencyParseMs: number;
    latencyRetrievalMs: number;
    latencyTotalMs: number;
    // Sólo se llenan cuando el turno resolvió una franja de presupuesto
    // (ver PLAN_RAG_FRANJAS_PRESUPUESTO.md §5.1) — sin esto no se puede
    // reconstruir después "por qué esta canasta y no otra".
    franja?: string;
    planCanasta?: unknown;
    canasta?: unknown;
    utilizacion?: number;
    relajaciones?: unknown;
  },
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO rag_query_log
         (request_id, tipo, mensaje, intent, retrieved_product_ids, retrieval_scores, status,
          latency_parse_ms, latency_retrieval_ms, latency_total_ms,
          franja, plan_canasta, canasta, utilizacion, relajaciones)
       VALUES ($1, 'busqueda', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        datos.requestId,
        datos.mensaje,
        JSON.stringify(datos.intent),
        datos.retrievedProductIds,
        JSON.stringify(datos.retrievalScores),
        datos.status,
        datos.latencyParseMs,
        datos.latencyRetrievalMs,
        datos.latencyTotalMs,
        datos.franja ?? null,
        datos.planCanasta != null ? JSON.stringify(datos.planCanasta) : null,
        datos.canasta != null ? JSON.stringify(datos.canasta) : null,
        datos.utilizacion ?? null,
        datos.relajaciones != null ? JSON.stringify(datos.relajaciones) : null,
      ],
    );
  } catch (error) {
    console.error("[rag-log] no se pudo registrar búsqueda:", error);
  }
}

export async function registrarSeleccion(
  pool: Pool,
  datos: {
    requestId: string;
    selectedProductIds: string[];
    rejected: unknown;
    status: string;
    latencyTotalMs: number;
  },
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO rag_query_log
         (request_id, tipo, selected_product_ids, rejected, status, latency_total_ms)
       VALUES ($1, 'seleccion', $2, $3, $4, $5)`,
      [datos.requestId, datos.selectedProductIds, JSON.stringify(datos.rejected), datos.status, datos.latencyTotalMs],
    );
  } catch (error) {
    console.error("[rag-log] no se pudo registrar selección:", error);
  }
}
