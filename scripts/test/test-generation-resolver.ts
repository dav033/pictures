import { existsSync } from "node:fs";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { getDb } from "../../src/lib/db";
import { classifyGenerationIds, normalizeGenerationSources } from "../../src/lib/generacion/provenance";
import { resolverProductosParaGeneracion } from "../../src/lib/rag/generate-products";

/**
 * Lo que este arnés probaba y ya no tiene sujeto en TypeScript (ADR-0023 paso 5):
 * los tres casos que resolvían un plan con `resolverPlan(pool, plan, whitelist)`
 * para firmar su `plan_hash` y mandarlo a /api/generate —el hash que sobrevive a
 * la revalidación contra el catálogo, la frontera "pasa la validación y se para
 * sin llave de proveedor", el payload malformado y la regresión R-12→R-24. Ese
 * resolutor ya no existe: /api/generate resuelve llamando al servicio Python, y
 * reproducirlos aquí exigiría un FastAPI levantado, que es justo lo que ejercitan
 * `plan:test-python-allowlist` y `smoke:rutas-python-local`. Lo que queda aquí es
 * lo que sigue siendo de Next y de PostgreSQL: la procedencia de las fuentes, la
 * resolución de productos contra el catálogo real y el rechazo en cerrado de una
 * generación sin propuesta aprobada.
 */

for (const archivo of [".env.local", ".env"]) {
  if (existsSync(archivo)) process.loadEnvFile(archivo);
}

type FilaReal = {
  product_id: string;
  variant_id: string;
  price: string;
  producto_titulo: string;
  variante_titulo: string | null;
  imagen: string | null;
  descripcion: string | null;
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function rechaza(promise: Promise<unknown>, texto: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => errorText(error).includes(texto));
}

async function postGenerate(body: unknown): Promise<{ status: number; error?: string }> {
  const { POST } = await import("../../src/app/api/generate/route");
  const response = await POST(new Request("http://localhost/api/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
  const data = (await response.json()) as { error?: string };
  return { status: response.status, error: data.error };
}

function testSourceProvenance(): void {
  const olderValidation = ["rag-old"];
  const newerValidation = ["rag-current"];
  const validatedRagIds = new Set([...olderValidation, ...newerValidation, "67890"]);
  assert.deepEqual(
    classifyGenerationIds(["legacy-selection", ...olderValidation, ...newerValidation], validatedRagIds),
    { productIds: ["legacy-selection"], ragVariantIds: [...olderValidation, ...newerValidation] },
  );
  assert.deepEqual(
    classifyGenerationIds(["rag-current"], validatedRagIds),
    { productIds: [], ragVariantIds: ["rag-current"] },
  );
  assert.deepEqual(
    classifyGenerationIds(["legacy-selection"], validatedRagIds),
    { productIds: ["legacy-selection"], ragVariantIds: [] },
  );
  assert.deepEqual(
    classifyGenerationIds(["rag-old", "legacy-replacement"], validatedRagIds),
    { productIds: ["legacy-replacement"], ragVariantIds: ["rag-old"] },
  );
  assert.deepEqual(
    classifyGenerationIds(["rag-old", "legacy-a", "rag-old", "legacy-a", "12345", "67890", "67890"], validatedRagIds),
    { productIds: ["legacy-a", "12345"], ragVariantIds: ["rag-old", "67890"] },
  );
  assert.deepEqual(
    normalizeGenerationSources(
      ["legacy-selection", "46594156462375", "46594156462375"],
      ["46594156462375", "46594221048103", "46594221048103"],
    ),
    {
      productIds: ["legacy-selection"],
      ragVariantIds: ["46594156462375", "46594221048103"],
    },
  );
  console.log("[PASS] provenance: multi-turn RAG retention, legacy replacement, source ordering, and stable deduplication.");
}

async function main(): Promise<void> {
  testSourceProvenance();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL no está configurada.");

  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 2_500 });
  const previousApiKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "";

  try {
    const { rows: snapshotRows } = await pool.query<{ source_snapshot_id: string }>(
      `SELECT source_snapshot_id
         FROM rag_source_snapshots
        WHERE source_kind = 'products_catalog'
          AND status = 'published'
        ORDER BY published_at DESC NULLS LAST, fetched_at DESC, source_snapshot_id DESC
        LIMIT 1`,
    );
    const snapshotId = snapshotRows[0]?.source_snapshot_id;
    assert.ok(snapshotId, "La base RAG debe tener un snapshot publicado para probar la procedencia de generación.");
    const { rows } = await pool.query<FilaReal>(
      `SELECT v.product_id, v.variant_id, v.price::text AS price,
              p.title AS producto_titulo, v.title AS variante_titulo,
              p.image_urls[1] AS imagen, p.description_text AS descripcion
         FROM catalog_variants v
         JOIN catalog_products p ON p.product_id = v.product_id
        WHERE p.status = 'ACTIVE'
           AND p.available = true
           AND v.available = true
           AND v.price > 0
           AND p.source_snapshot_id = $1
           AND v.source_snapshot_id = $1
         ORDER BY v.variant_id
         LIMIT 2`,
      [snapshotId],
    );
    assert.ok(rows.length >= 1, "La base RAG debe tener al menos una variante activa disponible con precio positivo.");

    const db = getDb();
    const legacyShopifyRow = db
      .prepare("SELECT id FROM shopify_variante WHERE disponible = 1 AND precio > 0 ORDER BY id LIMIT 1")
      .get() as { id: string } | undefined;
    const legacyCuratedRow = db.prepare("SELECT id FROM productos ORDER BY id LIMIT 1").get() as { id: string } | undefined;
    const allLegacyIds = [...new Set([legacyShopifyRow?.id, legacyCuratedRow?.id].filter((id): id is string => Boolean(id)))];
    // The two stores intentionally have separate authority, but a historical
    // fixture can reuse an identifier. Keep the mixed-source test on a pair
    // that the runtime can legally classify without ambiguity.
    const legacyIds = allLegacyIds.filter((id) => !rows.some((row) => row.variant_id === id));
    assert.ok(legacyIds.length > 0, "La base SQLite debe tener al menos un producto legado.");
    const legacyId = legacyIds[0];
    const [rag] = rows;
    const ragIds = rows.map((row) => row.variant_id);
    const ragProduct = await resolverProductosParaGeneracion({ ragVariantIds: [rag.variant_id] }, pool);
    const productoRag = ragProduct.productos[0];
    const nombreEsperado = rag.variante_titulo ? `${rag.producto_titulo} — ${rag.variante_titulo}` : rag.producto_titulo;
    assert.equal(productoRag?.id, rag.variant_id);
    assert.equal(productoRag?.familiaId, rag.product_id);
    assert.equal(productoRag?.precio, Number(rag.price));
    assert.equal(productoRag?.nombre, nombreEsperado);
    assert.equal(productoRag?.descripcion, rag.descripcion ?? nombreEsperado);
    assert.equal(productoRag?.foto ?? null, rag.imagen);
    console.log(`[PASS] PG real: ${rag.variant_id} resuelve metadata confiable de la misma fila.`);

    const snapshotProduct = await resolverProductosParaGeneracion(
      { ragVariantIds: [rag.variant_id], catalogSnapshotId: snapshotId },
      pool,
    );
    assert.equal(snapshotProduct.productos[0]?.id, rag.variant_id);
    console.log(`[PASS] snapshot firmado: ${rag.variant_id} solo resuelve dentro de ${snapshotId}.`);

    const { rows: rejectedRows } = await pool.query<{ variant_id: string }>(
      `SELECT v.variant_id
         FROM catalog_variants v
         JOIN catalog_products p ON p.product_id = v.product_id
        WHERE p.status IS DISTINCT FROM 'ACTIVE'
           OR p.available IS DISTINCT FROM true
           OR v.available IS DISTINCT FROM true
           OR (v.price IS NOT NULL AND v.price <= 0)
        ORDER BY v.variant_id
        LIMIT 1`,
    );
    const rejectedVariant = rejectedRows[0]?.variant_id;
    if (rejectedVariant) {
      await rechaza(
        resolverProductosParaGeneracion({ ragVariantIds: [rejectedVariant] }, pool),
        "RAG variant IDs could not be validated",
      );
      console.log(`[PASS] PG no elegible (${rejectedVariant}): variante inactiva/no disponible/sin precio positivo rechazada.`);
    } else {
      console.log("[N/A] PG no elegible: no hay variantes inactivas, no disponibles o con precio no positivo para probar.");
    }

    for (const id of legacyIds) {
      const legacy = await resolverProductosParaGeneracion({ productIds: [id] }, pool);
      assert.deepEqual(legacy.productos.map((product) => product.id), [id]);
      assert.equal(legacy.rag.length, 0);
    }
    console.log(`[PASS] legado SQLite: ${legacyIds.join(", ")} sigue resolviendo por su fuente existente.`);

    if (ragIds.length >= 2) {
      const mixed = await resolverProductosParaGeneracion({ productIds: legacyIds, ragVariantIds: [ragIds[1], ragIds[0]] }, pool);
      assert.deepEqual(mixed.productos.map((product) => product.id), [...legacyIds, ragIds[1], ragIds[0]]);
      console.log("[PASS] orden mixto: legado primero; cada fuente conserva su orden de entrada.");
    } else {
      console.log("[N/A] orden mixto con dos RAG: la base solo tiene una variante elegible.");
    }

    await rechaza(resolverProductosParaGeneracion({ ragVariantIds: ["__missing-rag-variant__"] }, pool), "RAG variant IDs could not be validated");
    console.log("[PASS] PG desconocido: un variant_id inexistente se rechaza.");

    await rechaza(resolverProductosParaGeneracion({ productIds: [legacyId, legacyId] }, pool), "productIds contains duplicate IDs");
    await rechaza(resolverProductosParaGeneracion({ ragVariantIds: [rag.variant_id, rag.variant_id] }, pool), "ragVariantIds contains duplicate IDs");
    await rechaza(resolverProductosParaGeneracion({ productIds: [legacyId], ragVariantIds: [legacyId] }, pool), "cannot be present in both");
    console.log("[PASS] duplicados: cada campo y el cruce entre fuentes se rechazan explícitamente.");

    await rechaza(resolverProductosParaGeneracion({ productIds: "no-es-array" }, pool), "productIds must be an array");
    await rechaza(resolverProductosParaGeneracion({ ragVariantIds: [rag.variant_id, 7] }, pool), "ragVariantIds must be an array");
    console.log("[PASS] payload runtime: los campos de origen se validan en tiempo de ejecución.");

    // ADR-0023 paso 1: sin propuesta aprobada no hay imagen. La petición se
    // rechaza en cerrado antes de tocar catálogo o proveedor.
    globalThis.__ragPool = pool;
    const sinPropuesta = await postGenerate({ ragVariantIds: [rag.variant_id] });
    assert.equal(sinPropuesta.status, 400);
    assert.match(sinPropuesta.error ?? "", /APROBACION_REQUERIDA/);
    console.log("[PASS] HTTP /api/generate: una petición sin propuesta aprobada se rechaza sin llamar al proveedor.");
  } finally {
    if (previousApiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousApiKey;
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(`[FAIL] generation resolver regression — ${errorText(error)}`);
  process.exitCode = 1;
});
