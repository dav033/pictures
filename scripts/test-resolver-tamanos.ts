import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { Pool } from "pg";
import { resolverVariantesPorDespiece } from "../src/lib/rag/tamanos/resolver";

for (const archivo of [".env.local", ".env", ".env.example"]) {
  if (existsSync(archivo)) process.loadEnvFile(archivo);
}

type FixtureVariant = {
  variant_id: string;
  product_id: string;
  diam_pulg: number;
  available: boolean;
  unidades_paq: number;
};

function linea(variant: FixtureVariant, cantidad = 1) {
  return { tamano: `R-${variant.diam_pulg}`, pulgadas: variant.diam_pulg, cantidad };
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL es obligatoria para el test del resolver PG");
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const fixture = await pool.query<{ product_id: string; title: string; variant_count: string }>(
      `SELECT p.product_id, p.title, COUNT(DISTINCT v.diam_pulg)::text AS variant_count
         FROM catalog_products p
         JOIN catalog_variants v ON v.product_id = p.product_id
        WHERE p.status = 'ACTIVE'
          AND v.forma = 'redondo'
          AND v.diam_pulg IS NOT NULL
          AND v.price > 0
          AND v.available = true
          AND v.unidades_paq IS NOT NULL
          AND v.unidades_paq > 0
        GROUP BY p.product_id, p.title
       HAVING COUNT(DISTINCT v.diam_pulg) >= 2
        ORDER BY COUNT(DISTINCT v.diam_pulg) DESC, p.product_id
        LIMIT 1`,
    );
    assert.ok(fixture.rows[0], "no hay fixture PG ACTIVE con al menos dos diámetros redondos disponibles");

    const variants = await pool.query<FixtureVariant>(
      `SELECT v.variant_id, v.product_id, v.diam_pulg::float8 AS diam_pulg,
              v.available, v.unidades_paq::int AS unidades_paq
         FROM catalog_variants v
         JOIN catalog_products p ON p.product_id = v.product_id
        WHERE v.product_id = $1
          AND p.status = 'ACTIVE'
          AND v.forma = 'redondo'
          AND v.diam_pulg IS NOT NULL
          AND v.price > 0
          AND v.available = true
          AND v.unidades_paq IS NOT NULL
          AND v.unidades_paq > 0
        ORDER BY v.diam_pulg, v.variant_id`,
      [fixture.rows[0]!.product_id],
    );
    assert.ok(variants.rows.length >= 2, "fixture perdió sus variantes redondas");

    const allowed = variants.rows[0]!;
    const outside = variants.rows.find((variant) => variant.diam_pulg !== allowed.diam_pulg);
    assert.ok(outside, "fixture no tiene una hermana de diámetro distinto");
    const whitelist = new Set([allowed.variant_id]);

    const exact = await resolverVariantesPorDespiece(
      pool,
      allowed.product_id,
      [linea(allowed)],
      whitelist,
    );
    assert.equal(exact.lineas.length, 1, "variante recuperada no resolvió una línea exacta");
    assert.equal(exact.lineas[0]?.variantId, allowed.variant_id, "resolver devolvió una variante distinta a la recuperada");
    assert.equal(exact.lineas[0]?.sustitucion, null, "diámetro exacto no debe marcar sustitución");

    const siblingRequest = await resolverVariantesPorDespiece(
      pool,
      allowed.product_id,
      [linea(outside)],
      whitelist,
    );
    assert.equal(siblingRequest.lineas.length, 1, "la solicitud de hermana debe resolver con la whitelist disponible");
    assert.equal(siblingRequest.lineas[0]?.variantId, allowed.variant_id, "resolver usó una variante hermana fuera de whitelist");
    assert.notEqual(siblingRequest.lineas[0]?.variantId, outside.variant_id, "variante hermana fuera de whitelist se filtró");
    assert.equal(siblingRequest.lineas[0]?.sustitucion?.pedido, `R-${outside.diam_pulg}`, "sustitución no quedó explícita");
    assert.equal(siblingRequest.lineas[0]?.diamPulgEntregado, allowed.diam_pulg);

    const missing = await resolverVariantesPorDespiece(
      pool,
      "producto-inexistente-test-rag",
      [linea(allowed)],
      new Set(),
    );
    assert.equal(missing.lineas.length, 0, "producto inexistente produjo líneas resolubles");
    assert.equal(missing.sinCobertura.length, 1, "producto inexistente no reportó cobertura faltante");

    console.log(
      `[PASS] resolver PG whitelist — producto=${allowed.product_id} (${fixture.rows[0]!.title}), ` +
        `variantes=${variants.rows.length}, exacta=${allowed.variant_id}, hermana_fuera=${outside.variant_id}, inexistente=0 líneas`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`[FAIL] resolver PG whitelist — ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
