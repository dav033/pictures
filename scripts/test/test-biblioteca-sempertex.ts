import { strict as assert } from "node:assert";
import { decoracionesSempertex, proveedoresSempertex, bibliotecaVisible } from "@/lib/biblioteca-sempertex/biblioteca";
import { DecoracionSempertexSchema } from "@/lib/biblioteca-sempertex/esquemas";
import { getRagPool } from "@/lib/rag/db";

assert.equal(decoracionesSempertex.length, 14);
assert.equal(proveedoresSempertex.length, 13);
assert.ok(["Bogotá", "Medellín", "Cali", "Barranquilla"].every((ciudad) => proveedoresSempertex.filter((proveedor) => proveedor.zona.ciudad === ciudad && (proveedor.tipo === "decorador_happia" || proveedor.tipo === "mbp")).length === 2));
assert.ok(decoracionesSempertex.every((decoracion) => decoracion.origen === "ejemplo" && decoracion.id.startsWith("ej-") && decoracion.aviso === "DATO DE EJEMPLO — no es real"));
assert.ok(decoracionesSempertex.every((decoracion) => decoracion.materiales.length > 0 && (decoracion.fotos[0]?.url.startsWith("https://cdn.shopify.com/") || decoracion.fotos[0]?.url.startsWith("/biblioteca-sempertex/kits/")) && decoracion.fotos[0]?.fuente.includes("Foto real del E-Decor")));
assert.ok(decoracionesSempertex.every((decoracion) => decoracion.pasos.length >= 4 && decoracion.pasos.length <= 6));
assert.ok(proveedoresSempertex.every((proveedor) => proveedor.origen === "ejemplo" && proveedor.id.startsWith("ej-prov-") && proveedor.contacto === null && new URL(proveedor.url).hostname === "example.com"));
assert.ok(bibliotecaVisible().every((decoracion) => decoracion.origen === "ejemplo" || decoracion.id.startsWith("deco-")));
assert.equal(DecoracionSempertexSchema.safeParse({ ...decoracionesSempertex[0], id: "deco-incorrecto" }).success, false);
assert.equal(DecoracionSempertexSchema.safeParse({ ...decoracionesSempertex[0], materiales: [{ variantId: "x", sku: null, cantidad: 1, precio: 100 }] }).success, false);
const variantIds = [...new Set(decoracionesSempertex.flatMap((decoracion) => decoracion.materiales.map((material) => material.variantId)))];
async function verificarSnapshot(): Promise<void> {
if (!process.env.DATABASE_URL) {
  console.warn("[AVISO] test-biblioteca-sempertex: DATABASE_URL ausente; se omite comprobación de variantes en snapshot vigente.");
} else {
  const pool = getRagPool();
  let variantIdsEnSnapshot: string[] | null = null;
  let handlesEnSnapshot: string[] | null = null;
  try {
    const resultado = await pool.query<{ variant_id: string }>(
      `WITH snapshot AS (
         SELECT source_snapshot_id FROM rag_source_snapshots
          WHERE source_kind = 'products_catalog' AND status = 'published'
          ORDER BY published_at DESC NULLS LAST, fetched_at DESC LIMIT 1
       )
       SELECT v.variant_id FROM catalog_variants v
       JOIN catalog_products p ON p.product_id = v.product_id
       JOIN snapshot s ON s.source_snapshot_id = v.source_snapshot_id
        WHERE p.source_snapshot_id = s.source_snapshot_id
          AND p.status = 'ACTIVE' AND p.available = TRUE
          AND v.available = TRUE AND v.currency = 'COP' AND v.price > 0
          AND NULLIF(to_jsonb(v)->>'unidades_paq', '')::integer > 0
          AND v.variant_id = ANY($1::text[])`,
      [variantIds],
    );
    variantIdsEnSnapshot = resultado.rows.map((row) => row.variant_id);
    const handles = [...new Set(decoracionesSempertex.flatMap((decoracion) => decoracion.shopifyHandle ? [decoracion.shopifyHandle] : []))];
    const kits = await pool.query<{ handle: string }>(
      `WITH snapshot AS (
         SELECT source_snapshot_id FROM rag_source_snapshots
          WHERE source_kind = 'products_catalog' AND status = 'published'
          ORDER BY published_at DESC NULLS LAST, fetched_at DESC LIMIT 1
       )
       SELECT p.handle FROM catalog_products p JOIN snapshot s ON s.source_snapshot_id = p.source_snapshot_id
        WHERE p.handle = ANY($1::text[]) AND p.status = 'ACTIVE' AND p.available = TRUE
          AND p.product_type = 'E-DECORS'`,
      [handles],
    );
    handlesEnSnapshot = kits.rows.map((row) => row.handle);
  } catch (error) {
    console.warn(`[AVISO] test-biblioteca-sempertex: base de datos no disponible; se omite comprobación del snapshot (${error instanceof Error ? error.message : "error de conexión"}).`);
  } finally {
    await pool.end();
  }
  if (variantIdsEnSnapshot !== null) {
    assert.deepEqual(variantIdsEnSnapshot.sort(), [...variantIds].sort(), "Toda variante debe estar disponible y tener precio en el snapshot vigente.");
    const handles = [...new Set(decoracionesSempertex.flatMap((decoracion) => decoracion.shopifyHandle ? [decoracion.shopifyHandle] : []))];
    assert.deepEqual(handlesEnSnapshot?.sort(), handles.sort(), "Todo kit enlazado debe existir y estar activo en el snapshot vigente.");
    console.log(`test-biblioteca-sempertex: ${variantIds.length} variantes verificadas en snapshot vigente.`);
  }
}
console.log("test-biblioteca-sempertex: comprobaciones de contratos correctas");
}

void verificarSnapshot();
