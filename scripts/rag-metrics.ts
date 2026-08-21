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
