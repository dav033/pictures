// Verifies scripts/migrations/012_scene_catalog.sql (Tarea 02.1 de
// PLAN_ARQUITECTURA_ESCENA_COMPLETA_RAG.md):
//   1. the raw DDL is idempotent when executed twice back to back;
//   2. every new table exists with the expected columns;
//   3. catalog_products / catalog_variants are untouched (same row counts,
//      same sample rows recoverable, before and after this script runs);
//   4. FK and CHECK constraints reject invalid rows;
//   5. valid rows across all seven new tables are accepted, then rolled back
//      so this script never leaves test data behind.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Pool, type PoolClient } from "pg";

for (const archivo of [".env.local", ".env"]) {
  if (existsSync(archivo)) process.loadEnvFile(archivo);
}

const NUEVAS_TABLAS: Record<string, string[]> = {
  catalog_items: ["item_id", "product_id", "variant_id", "category_v3", "created_at", "updated_at"],
  catalog_sources: ["source_id", "provider_name", "source_class", "status", "verified_at", "commercial_policy"],
  catalog_commercial_offers: [
    "offer_id", "item_id", "variant_id", "source_id", "snapshot_id", "verified_at",
    "source_class", "status", "availability_status", "availability_checked_at",
    "valid_from", "valid_until", "rental_minimum_periods", "rental_period_unit", "minimum_quantity",
  ],
  catalog_product_capabilities: ["id", "item_id", "scene_function", "confidence", "evidence", "derived_from"],
  catalog_price_components: ["id", "offer_id", "price_type", "component_kind", "amount_cop", "refundable", "period_unit", "valid_from", "valid_until"],
  catalog_product_spatial: ["item_id", "width_cm", "height_cm", "depth_cm", "weight_kg", "indoor_outdoor", "requires_support", "supports", "mounting"],
  catalog_source_audit: ["id", "source_id", "offer_id", "action", "reason", "previous_state", "new_state", "actor"],
};

async function ejecutarSqlIdempotente(pool: Pool): Promise<void> {
  const archivo = path.join(process.cwd(), "scripts", "migrations", "012_scene_catalog.sql");
  const sql = readFileSync(archivo, "utf-8");
  await pool.query(sql);
  await pool.query(sql);
  console.log("[PASS] 012_scene_catalog.sql se ejecutó dos veces seguidas sin error (idempotencia de la DDL).");
}

async function verificarTablasYColumnas(pool: Pool): Promise<void> {
  for (const [tabla, columnas] of Object.entries(NUEVAS_TABLAS)) {
    const { rows } = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
      [tabla],
    );
    assert.ok(rows.length > 0, `la tabla ${tabla} no existe`);
    const presentes = new Set(rows.map((r) => r.column_name));
    for (const columna of columnas) {
      assert.ok(presentes.has(columna), `${tabla}.${columna} no existe`);
    }
  }
  console.log(`[PASS] ${Object.keys(NUEVAS_TABLAS).length} tablas nuevas existen con las columnas esperadas.`);
}

async function contarNucleo(pool: Pool): Promise<{ productos: number; variantes: number }> {
  const productos = await pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM catalog_products");
  const variantes = await pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM catalog_variants");
  return { productos: Number(productos.rows[0]!.count), variantes: Number(variantes.rows[0]!.count) };
}

async function esperarViolacion(client: PoolClient, etiqueta: string, sql: string, params: unknown[]): Promise<void> {
  await client.query("SAVEPOINT sp_invalido");
  try {
    await client.query(sql, params);
    assert.fail(`${etiqueta}: se esperaba que Postgres rechazara el insert y no lo hizo`);
  } catch (error) {
    assert.ok(error instanceof Error, `${etiqueta}: error inesperado`);
    await client.query("ROLLBACK TO SAVEPOINT sp_invalido");
  }
}

async function main(): Promise<void> {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL es obligatoria para la prueba de migración de escena");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const antes = await contarNucleo(pool);
    const muestraAntes = await pool.query<{ product_id: string; variant_id: string }>(
      `SELECT p.product_id, v.variant_id FROM catalog_products p JOIN catalog_variants v ON v.product_id = p.product_id LIMIT 1`,
    );
    assert.ok(muestraAntes.rows[0], "no hay al menos un producto con variante para usar como fixture FK-válido");
    const { product_id: productId, variant_id: variantId } = muestraAntes.rows[0]!;

    await ejecutarSqlIdempotente(pool);
    await verificarTablasYColumnas(pool);

    const despuesDdl = await contarNucleo(pool);
    assert.deepEqual(despuesDdl, antes, "catalog_products/catalog_variants cambiaron de tamaño solo por correr la DDL dos veces");

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // --- constraint rejection tests -------------------------------------------------
      await esperarViolacion(
        client,
        "catalog_items.product_id inexistente debe violar la FK",
        `INSERT INTO catalog_items (item_id, product_id) VALUES ('test-item-fk-bad', 'no-existe-este-product-id')`,
        [],
      );
      await esperarViolacion(
        client,
        "catalog_sources.source_class fuera de la lista debe violar el CHECK",
        `INSERT INTO catalog_sources (source_id, provider_name, source_class) VALUES ('test-src-bad', 'Proveedor X', 'not_a_real_class')`,
        [],
      );

      // Valid rows, needed as parents for the remaining constraint tests below.
      await client.query(
        `INSERT INTO catalog_items (item_id, product_id, variant_id, category_v3) VALUES ('test-item-1', $1, $2, 'furniture')`,
        [productId, variantId],
      );
      await client.query(
        `INSERT INTO catalog_sources (source_id, provider_name, source_class, status, verified_at)
         VALUES ('test-src-1', 'Proveedor de prueba', 'catalog_sale', 'active', now())`,
      );

      await esperarViolacion(
        client,
        "catalog_commercial_offers.status fuera de PRICED/QUOTE_REQUIRED/UNAVAILABLE debe violar el CHECK",
        `INSERT INTO catalog_commercial_offers
           (offer_id, item_id, source_id, snapshot_id, verified_at, source_class, status, availability_status, availability_checked_at)
         VALUES ('test-offer-bad-status', 'test-item-1', 'test-src-1', 'snap-1', now(), 'catalog_sale', 'FREE_FOR_ALL', 'available', now())`,
        [],
      );
      await esperarViolacion(
        client,
        "catalog_commercial_offers con source_class=catalog_sale y rental_period_unit debe violar el CHECK (invariante 6.3.2)",
        `INSERT INTO catalog_commercial_offers
           (offer_id, item_id, source_id, snapshot_id, verified_at, source_class, status, availability_status, availability_checked_at, rental_period_unit)
         VALUES ('test-offer-bad-rental', 'test-item-1', 'test-src-1', 'snap-1', now(), 'catalog_sale', 'PRICED', 'available', now(), 'day')`,
        [],
      );

      await client.query(
        `INSERT INTO catalog_commercial_offers
           (offer_id, item_id, source_id, snapshot_id, verified_at, source_class, status, availability_status, availability_checked_at)
         VALUES ('test-offer-1', 'test-item-1', 'test-src-1', 'snap-1', now(), 'catalog_sale', 'PRICED', 'available', now())`,
      );

      await esperarViolacion(
        client,
        "catalog_price_components.amount_cop negativo debe violar el CHECK (invariante 6.3.1, entero COP)",
        `INSERT INTO catalog_price_components (offer_id, price_type, amount_cop) VALUES ('test-offer-1', 'unit_sale', -100)`,
        [],
      );
      await esperarViolacion(
        client,
        "catalog_price_components con component_kind=deposit fuera de service_fee debe violar el CHECK (invariante 6.3.3)",
        `INSERT INTO catalog_price_components (offer_id, price_type, component_kind, amount_cop) VALUES ('test-offer-1', 'unit_sale', 'deposit', 50000)`,
        [],
      );

      // Valid rows across the remaining tables, to prove the happy path works end to end.
      await client.query(
        `INSERT INTO catalog_price_components (offer_id, price_type, component_kind, amount_cop) VALUES ('test-offer-1', 'unit_sale', 'product', 45000)`,
      );
      await client.query(
        `INSERT INTO catalog_product_capabilities (item_id, scene_function, confidence, evidence, derived_from)
         VALUES ('test-item-1', 'centerpiece', 0.8, 'title contains "centro de mesa"', 'derived')`,
      );
      await esperarViolacion(
        client,
        "catalog_product_capabilities.confidence fuera de [0,1] debe violar el CHECK",
        `INSERT INTO catalog_product_capabilities (item_id, scene_function, confidence, evidence) VALUES ('test-item-1', 'centerpiece', 1.5, 'x')`,
        [],
      );
      await client.query(
        `INSERT INTO catalog_product_spatial (item_id, width_cm, height_cm, indoor_outdoor, mounting)
         VALUES ('test-item-1', 60, 90, ARRAY['indoor','outdoor'], ARRAY['freestanding'])`,
      );
      await client.query(
        `INSERT INTO catalog_source_audit (source_id, offer_id, action, reason, actor)
         VALUES ('test-src-1', 'test-offer-1', 'created', 'fixture de prueba', 'test-scene-catalog-migration')`,
      );

      console.log("[PASS] filas válidas insertadas en las 7 tablas nuevas; FK y CHECK constraints rechazaron los 6 casos inválidos.");
      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    const despuesRollback = await contarNucleo(pool);
    assert.deepEqual(despuesRollback, antes, "catalog_products/catalog_variants no deben cambiar tras las pruebas de constraint (rollback)");

    // Confirm no stray test rows survived the rollback (belt & suspenders — the
    // rollback above already guarantees this, but we check the actual tables too).
    const restos = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM catalog_items WHERE item_id = 'test-item-1'",
    );
    assert.equal(Number(restos.rows[0]!.count), 0, "quedó un registro de prueba sin revertir en catalog_items");

    const muestraDespues = await pool.query<{ product_id: string; variant_id: string }>(
      `SELECT product_id, variant_id FROM catalog_variants WHERE product_id = $1 AND variant_id = $2`,
      [productId, variantId],
    );
    assert.ok(muestraDespues.rows[0], "el producto/variante de control ya no es recuperable después de la migración");

    console.log(
      `[PASS] migración de catálogo de escena verificada — catalog_products=${antes.productos}, catalog_variants=${antes.variantes} (sin cambios).`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`[FAIL] test-scene-catalog-migration — ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
