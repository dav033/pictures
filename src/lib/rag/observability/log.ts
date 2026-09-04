import type { Pool } from "pg";
import type { ObservabilidadBusqueda, PiezaObservabilidad, ResultadoBusquedaObservabilidad } from "./types";

function metadataAuditable(value: unknown, depth = 0): unknown {
  if (depth > 4 || value == null) return value == null ? null : "[truncated]";
  if (typeof value === "string") return value.length > 1200 ? `${value.slice(0, 1200)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 80).map((item) => metadataAuditable(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 80).flatMap(([key, item]) => {
      if (/(base64|image|secret|api.?key|token|payload|prompt)/i.test(key)) return [];
      return [[key, metadataAuditable(item, depth + 1)]];
    }));
  }
  return "[unsupported]";
}

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
    observabilidad?: ObservabilidadBusqueda;
  },
): Promise<string | null> {
  try {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO rag_query_log
         (request_id, tipo, mensaje, intent, retrieved_product_ids, retrieval_scores, status,
          latency_parse_ms, latency_retrieval_ms, latency_total_ms,
           franja, plan_canasta, canasta, utilizacion, relajaciones,
           event_label, closed_occasion_recognized, component_queries,
           candidate_counts_by_tier, selected_match_levels, outcome, latency_planning_ms)
        VALUES ($1, 'busqueda', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                $15, $16, $17, $18, $19, $20, $21)
        RETURNING id`,
      [
        datos.requestId,
         datos.mensaje.slice(0, 2000),
         JSON.stringify(metadataAuditable(datos.intent)),
        datos.retrievedProductIds,
         JSON.stringify(metadataAuditable(datos.retrievalScores)),
        datos.status,
        datos.latencyParseMs,
        datos.latencyRetrievalMs,
        datos.latencyTotalMs,
        datos.franja ?? null,
        datos.planCanasta != null ? JSON.stringify(datos.planCanasta) : null,
         datos.canasta != null ? JSON.stringify(metadataAuditable(datos.canasta)) : null,
        datos.utilizacion ?? null,
         datos.relajaciones != null ? JSON.stringify(metadataAuditable(datos.relajaciones)) : null,
        datos.observabilidad?.eventLabel?.slice(0, 240) ?? null,
        datos.observabilidad?.closedOccasionRecognized ?? null,
        datos.observabilidad ? JSON.stringify(metadataAuditable(datos.observabilidad.componentQueries)) : null,
        datos.observabilidad ? JSON.stringify(metadataAuditable(datos.observabilidad.candidateCountsByTier)) : null,
        datos.observabilidad ? JSON.stringify(metadataAuditable(datos.observabilidad.selectedPieces)) : null,
        datos.observabilidad?.outcome ?? null,
        datos.observabilidad?.planningLatencyMs ?? null,
       ],
    );
    return result.rows[0]?.id ?? null;
  } catch (error) {
    console.error("[rag-log] no se pudo registrar búsqueda:", error);
    return null;
  }
}

/** Actualiza resultado de búsqueda cuando el turno posterior confirma plan o pide aclaración. */
export async function actualizarResultadoBusqueda(
  pool: Pool,
  requestId: string,
  outcome: ResultadoBusquedaObservabilidad,
  planningLatencyMs?: number,
  selectedPieces?: PiezaObservabilidad[],
): Promise<void> {
  try {
    await pool.query(
      `UPDATE rag_query_log
          SET outcome = $2,
              latency_planning_ms = COALESCE($3, latency_planning_ms),
              selected_match_levels = COALESCE($4, selected_match_levels)
        WHERE request_id = $1 AND tipo = 'busqueda'`,
      [requestId, outcome, planningLatencyMs ?? null, selectedPieces ? JSON.stringify(metadataAuditable(selectedPieces)) : null],
    );
  } catch (error) {
    console.error("[rag-log] no se pudo actualizar resultado de búsqueda:", error);
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
       [datos.requestId, datos.selectedProductIds, JSON.stringify(metadataAuditable(datos.rejected)), datos.status, datos.latencyTotalMs],
    );
  } catch (error) {
    console.error("[rag-log] no se pudo registrar selección:", error);
  }
}

/**
 * Trazabilidad del plan determinista. Se guardan decisiones y hashes, nunca
 * prompts completos de proveedor, imágenes ni secretos; así el incidente se
 * puede reconstruir sin convertir la tabla de observabilidad en un almacén
 * de contenido sensible.
 */
export async function registrarPlanAudit(
  pool: Pool,
  datos: {
    requestId: string;
    planHash?: string;
    solicitudOriginal?: string;
    restricciones?: unknown;
    ragQueryIds?: string[];
    candidateProductIds?: string[];
    selectedProductIds?: string[];
    geometry?: unknown;
    costMinCop?: number;
    costChosenCop?: number;
    ceilingCop?: number;
    deltaCop?: number;
    packages?: unknown;
    instances?: unknown;
    status: string;
    error?: string;
    quoteHash?: string;
    sceneSpecHash?: string;
    qaHash?: string;
    flagSnapshot?: unknown;
  },
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO plan_audit_log
         (request_id, plan_hash, solicitud_original, restricciones, rag_query_ids,
           rag_query_refs, candidate_product_ids, selected_product_ids, geometry, cost_min_cop,
           cost_chosen_cop, ceiling_cop, delta_cop, packages, instances, status, error,
           quote_hash, scene_spec_hash, qa_hash, flag_snapshot)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
      [
        datos.requestId,
        datos.planHash ?? null,
        datos.solicitudOriginal?.slice(0, 2000) ?? null,
         datos.restricciones != null ? JSON.stringify(metadataAuditable(datos.restricciones)) : null,
         datos.ragQueryIds ?? [],
         datos.ragQueryIds ?? [],
        datos.candidateProductIds ?? [],
        datos.selectedProductIds ?? [],
         datos.geometry != null ? JSON.stringify(metadataAuditable(datos.geometry)) : null,
        datos.costMinCop ?? null,
        datos.costChosenCop ?? null,
        datos.ceilingCop ?? null,
        datos.deltaCop ?? null,
         datos.packages != null ? JSON.stringify(metadataAuditable(datos.packages)) : null,
         datos.instances != null ? JSON.stringify(metadataAuditable(datos.instances)) : null,
         datos.status,
         datos.error?.slice(0, 1000) ?? null,
         datos.quoteHash ?? null,
         datos.sceneSpecHash ?? null,
         datos.qaHash ?? null,
         datos.flagSnapshot != null ? JSON.stringify(metadataAuditable(datos.flagSnapshot)) : null,
      ],
    );
  } catch (error) {
    console.error("[rag-log] no se pudo registrar auditoría de plan:", error);
  }
}
