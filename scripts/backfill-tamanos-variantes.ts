import { existsSync } from "node:fs";
import { Pool } from "pg";
import { decodificarTamano } from "../src/lib/shopify/derivar";

for (const archivo of [".env.local", ".env"]) {
  if (existsSync(archivo)) process.loadEnvFile(archivo);
}

/**
 * Backfill único (PLAN_TAMANOS_GLOBO.md F1): las variantes ya en Postgres
 * guardan el option1 crudo en `options` (normalize.ts lo captura desde
 * siempre) pero nunca se decodificó a las columnas nuevas de tamaño/forma
 * (migración 006). No hace falta red ni volver a sincronizar Shopify — el
 * dato fuente ya está en la base, solo falta correrle `decodificarTamano()`.
 * Idempotente: puede correrse de nuevo sin efecto si nada cambió.
 */
async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows } = await pool.query<{ variant_id: string; option1: string | null }>(
      `SELECT variant_id, options->>'option1' AS option1 FROM catalog_variants`,
    );
    console.log(`${rows.length} variantes a procesar.`);

    let actualizadas = 0;
    let decodificadas = 0;
    for (const row of rows) {
      const tamano = decodificarTamano(row.option1);
      if (tamano) decodificadas++;
      await pool.query(
        `UPDATE catalog_variants
         SET codigo_tamano = $2, forma = $3, diam_pulg = $4, largo_pulg = $5, ancho_cm = $6, alto_cm = $7
         WHERE variant_id = $1`,
        [
          row.variant_id,
          row.option1 ?? null,
          tamano?.forma ?? null,
          tamano?.diamPulg ?? null,
          tamano?.largoPulg ?? null,
          tamano?.anchoCm ?? null,
          tamano?.altoCm ?? null,
        ],
      );
      actualizadas++;
    }

    console.log(`[PASS] ${actualizadas} variantes actualizadas, ${decodificadas} con tamaño decodificado (${((decodificadas / rows.length) * 100).toFixed(1)}%).`);

    const { rows: sinDecodificar } = await pool.query<{ option1: string | null; n: string }>(
      `SELECT options->>'option1' AS option1, COUNT(*) AS n
       FROM catalog_variants WHERE diam_pulg IS NULL AND forma IS NULL
       GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 20`,
    );
    if (sinDecodificar.length) {
      console.log("\n--- Códigos sin decodificar (no son globo, o forma no aplica — ver derivar.ts) ---");
      for (const r of sinDecodificar) console.log(`  ${JSON.stringify(r.option1)}: ${r.n}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[FAIL] backfill falló:", error);
  process.exitCode = 1;
});
