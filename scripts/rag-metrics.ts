import { existsSync } from "node:fs";
import { Pool } from "pg";

for (const archivo of [".env.local", ".env"]) {
  if (existsSync(archivo)) process.loadEnvFile(archivo);
}

/**
 * Métricas agregadas (plan §6.3), leídas de lo que ya se registra en
 * rag_query_log / catalog_sync_log / catalog_webhook_log — nada de esto se
 * inventa ni se estima, sale de filas reales.
 */
async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const dias = Number(process.argv[2] ?? 7);

  try {
    console.log(`--- Métricas RAG (últimos ${dias} días) ---\n`);

    const { rows: latencias } = await pool.query<{
      p50_parse: number | null; p95_parse: number | null;
      p50_retrieval: number | null; p95_retrieval: number | null;
      n: number;
    }>(
      `SELECT
         percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_parse_ms) AS p50_parse,
         percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_parse_ms) AS p95_parse,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_retrieval_ms) AS p50_retrieval,
         percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_retrieval_ms) AS p95_retrieval,
         COUNT(*)::int AS n
       FROM rag_query_log
       WHERE tipo = 'busqueda' AND created_at > now() - ($1 || ' days')::interval`,
      [dias],
    );
    const lat = latencias[0];
    console.log("Latencia de búsquedas:");
    console.log(`  n=${lat.n}`);
    console.log(`  parseo (Gemini):  p50=${Math.round(lat.p50_parse ?? 0)}ms  p95=${Math.round(lat.p95_parse ?? 0)}ms`);
    console.log(`  retrieval (DB):   p50=${Math.round(lat.p50_retrieval ?? 0)}ms  p95=${Math.round(lat.p95_retrieval ?? 0)}ms`);

    const { rows: zeroResult } = await pool.query<{ total: number; sin_resultado: number }>(
      `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'NO_MATCH')::int AS sin_resultado
       FROM rag_query_log WHERE tipo = 'busqueda' AND created_at > now() - ($1 || ' days')::interval`,
      [dias],
    );
    const zr = zeroResult[0];
    console.log(
      `\nZero-results rate: ${zr.sin_resultado}/${zr.total} (${zr.total ? ((zr.sin_resultado / zr.total) * 100).toFixed(1) : "0"}%)`,
    );

    const { rows: openIntent } = await pool.query<{
      unclassified: number;
      useful_unclassified: number;
      classified: number;
      useful_classified: number;
      final_no_match: number;
      before_fallback_no_match: number;
      relaxed: number;
      mean_role_coverage: number | null;
      mean_structure_coverage: number | null;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE event_label IS NOT NULL AND COALESCE(closed_occasion_recognized, false) = false)::int AS unclassified,
         COUNT(*) FILTER (WHERE event_label IS NOT NULL AND COALESCE(closed_occasion_recognized, false) = false AND outcome = 'plan_confirmado')::int AS useful_unclassified,
         COUNT(*) FILTER (WHERE event_label IS NOT NULL AND closed_occasion_recognized = true)::int AS classified,
         COUNT(*) FILTER (WHERE event_label IS NOT NULL AND closed_occasion_recognized = true AND outcome = 'plan_confirmado')::int AS useful_classified,
         COUNT(*) FILTER (WHERE status = 'NO_MATCH')::int AS final_no_match,
         COUNT(*) FILTER (WHERE status = 'NO_MATCH' OR (status <> 'NO_MATCH' AND jsonb_typeof(relajaciones) = 'array' AND jsonb_array_length(relajaciones) > 0))::int AS before_fallback_no_match,
         COUNT(*) FILTER (WHERE jsonb_typeof(relajaciones) = 'array' AND jsonb_array_length(relajaciones) > 0)::int AS relaxed,
         AVG(CASE WHEN jsonb_typeof(canasta->'piezas') = 'array' THEN jsonb_array_length(canasta->'piezas') END) AS mean_role_coverage,
         (SELECT AVG(CASE WHEN jsonb_typeof(geometry) = 'array' THEN jsonb_array_length(geometry) END)
            FROM plan_audit_log
           WHERE created_at > now() - ($1 || ' days')::interval
             AND plan_hash IS NOT NULL) AS mean_structure_coverage
       FROM rag_query_log
       WHERE tipo = 'busqueda' AND created_at > now() - ($1 || ' days')::interval`,
      [dias],
    );
    const oi = openIntent[0];
    console.log("\nIntención abierta:");
    console.log(`  propuesta útil en eventos no clasificados=${oi.useful_unclassified}/${oi.unclassified} (${oi.unclassified ? ((oi.useful_unclassified / oi.unclassified) * 100).toFixed(1) : "0"}%)`);
    console.log(`  propuesta útil en eventos clasificados=${oi.useful_classified}/${oi.classified} (${oi.classified ? ((oi.useful_classified / oi.classified) * 100).toFixed(1) : "0"}%)`);
    console.log(`  delta conversión no clasificados vs clasificados=${conversionDelta(oi.useful_unclassified, oi.unclassified, oi.useful_classified, oi.classified)}`);
    console.log(`  NO_MATCH final=${oi.final_no_match}; estimado antes de fallback=${oi.before_fallback_no_match}; relajaciones=${oi.relaxed}`);
    console.log(`  cobertura media de roles/piezas=${formatMetric(oi.mean_role_coverage)}; estructuras=${formatMetric(oi.mean_structure_coverage)}`);

    const { rows: levels } = await pool.query<{ exact_event: number; thematic: number; adaptable: number }>(
      `SELECT
         COUNT(*) FILTER (WHERE piece->>'matchLevel' = 'exact_event')::int AS exact_event,
         COUNT(*) FILTER (WHERE piece->>'matchLevel' = 'thematic')::int AS thematic,
         COUNT(*) FILTER (WHERE piece->>'matchLevel' = 'adaptable')::int AS adaptable
       FROM rag_query_log q
       CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(q.selected_match_levels) = 'array' THEN q.selected_match_levels ELSE '[]'::jsonb END) piece
       WHERE q.tipo = 'busqueda' AND q.created_at > now() - ($1 || ' days')::interval`,
      [dias],
    );
    const level = levels[0];
    const levelTotal = Number(level.exact_event ?? 0) + Number(level.thematic ?? 0) + Number(level.adaptable ?? 0);
    console.log(`  piezas por nivel exacto/temático/adaptable=${share(level.exact_event, levelTotal)} / ${share(level.thematic, levelTotal)} / ${share(level.adaptable, levelTotal)}`);

    const { rows: seleccion } = await pool.query<{ total: number; con_rechazo: number; rechazos_whitelist: number }>(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE jsonb_array_length(rejected) > 0)::int AS con_rechazo,
         COALESCE(SUM((SELECT COUNT(*) FROM jsonb_array_elements(rejected) r
                       WHERE r->>'motivo' ILIKE '%recuperados%' OR r->>'motivo' ILIKE '%whitelist%')), 0)::int AS rechazos_whitelist
       FROM rag_query_log WHERE tipo = 'seleccion' AND created_at > now() - ($1 || ' days')::interval`,
      [dias],
    );
    const sel = seleccion[0];
    console.log(`\nSelecciones: ${sel.total} totales, ${sel.con_rechazo} con al menos un item rechazado`);
    console.log(
      `Invalid-id attempt rate (product_id fuera de whitelist): ${sel.rechazos_whitelist} intento(s) — cada uno es un id que el LLM mandó sin que viniera de una búsqueda real`,
    );

    const { rows: planes } = await pool.query<{
      total: number;
      presentados: number;
      aprobados_antes_de_generar: number;
      sobre_techo: number;
      qa_intentos: number;
      qa_conformes: number;
      ratio_costo: number | null;
      ahorro_paquetes: number | null;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE plan_hash IS NOT NULL)::int AS total,
         COUNT(*) FILTER (WHERE status IN ('VERIFICADO', 'APROBACION_REQUERIDA'))::int AS presentados,
         COUNT(*) FILTER (WHERE status = 'CLIENT_APPROVED')::int AS aprobados_antes_de_generar,
         COUNT(*) FILTER (WHERE ceiling_cop IS NOT NULL AND cost_chosen_cop > ceiling_cop)::int AS sobre_techo,
         COUNT(*) FILTER (WHERE status LIKE 'IMAGEN_QA%')::int AS qa_intentos,
         COUNT(*) FILTER (WHERE qa_hash LIKE '%:pass')::int AS qa_conformes,
         AVG(CASE WHEN cost_min_cop > 0 THEN cost_chosen_cop::numeric / cost_min_cop END) AS ratio_costo,
         AVG(COALESCE((packages->>'ahorro_paquetes_cop')::numeric, 0)) AS ahorro_paquetes
       FROM plan_audit_log
       WHERE created_at > now() - ($1 || ' days')::interval`,
      [dias],
    );
    const plan = planes[0];
    console.log("\nPlanes y generación:");
    console.log(`  planes presentados=${plan.presentados}/${plan.total}; aprobados antes de generar=${plan.aprobados_antes_de_generar}`);
    console.log(`  sobre techo sin consentimiento=${plan.sobre_techo}`);
    console.log(`  costo elegido / mínimo compatible=${plan.ratio_costo == null ? "N/A" : Number(plan.ratio_costo).toFixed(3)}`);
    console.log(`  QA visual conforme=${plan.qa_intentos ? `${plan.qa_conformes}/${plan.qa_intentos}` : "N/A"}`);
    console.log(`  ahorro medio por consolidación de paquetes=${Math.round(Number(plan.ahorro_paquetes ?? 0))} COP`);

    const { rows: sync } = await pool.query<{
      total: number; fallidos: number; ultimo: string | null; ultimo_normalizados: number | null;
    }>(
      `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE error IS NOT NULL)::int AS fallidos,
              MAX(finished_at)::text AS ultimo,
              (SELECT normalized_products FROM catalog_sync_log WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1) AS ultimo_normalizados
       FROM catalog_sync_log WHERE started_at > now() - ($1 || ' days')::interval`,
      [dias],
    );
    const s = sync[0];
    console.log(`\nSincronizaciones de catálogo: ${s.total} totales, ${s.fallidos} fallida(s)`);
    console.log(`  última exitosa: ${s.ultimo ?? "N/A"} (${s.ultimo_normalizados ?? "N/A"} productos normalizados)`);

    const { rows: webhooks } = await pool.query<{ total: number; procesados: number; errores: number; rechazados: number; desactualizados: number }>(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'processed')::int AS procesados,
              COUNT(*) FILTER (WHERE status = 'error')::int AS errores,
              COUNT(*) FILTER (WHERE status = 'rejected')::int AS rechazados,
              COUNT(*) FILTER (WHERE status = 'ignored_stale')::int AS desactualizados
       FROM catalog_webhook_log WHERE received_at > now() - ($1 || ' days')::interval`,
      [dias],
    );
    const w = webhooks[0];
    console.log(`\nWebhooks recibidos: ${w.total} — procesados=${w.procesados} errores=${w.errores} rechazados=${w.rechazados} descartados_por_viejos=${w.desactualizados}`);

    if (lat.n === 0 && zr.total === 0 && sel.total === 0) {
      console.log("\n(Sin actividad en el período — normal si RAG_ENABLED todavía no está en producción.)");
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[FAIL] métricas fallaron:", error);
  process.exitCode = 1;
});

function formatMetric(value: number | null): string {
  return value == null ? "N/A" : Number(value).toFixed(2);
}

function share(value: number, total: number): string {
  return `${value}/${total} (${total ? ((value / total) * 100).toFixed(1) : "0"}%)`;
}

function conversionDelta(unclassifiedUseful: number, unclassifiedTotal: number, classifiedUseful: number, classifiedTotal: number): string {
  if (!unclassifiedTotal || !classifiedTotal) return "N/A";
  return `${(((unclassifiedUseful / unclassifiedTotal) - (classifiedUseful / classifiedTotal)) * 100).toFixed(1)} pp`;
}
