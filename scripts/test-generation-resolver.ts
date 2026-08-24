import { existsSync } from "node:fs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { getDb } from "../src/lib/db";
import { classifyGenerationIds, normalizeGenerationSources } from "../src/lib/generacion/provenance";
import { crearTokenAprobacion } from "../src/lib/plan/aprobacion";
import { planHash } from "../src/lib/plan/hash";
import { resolverPlan } from "../src/lib/plan/resolver";
import { PlanDecoracionSchema } from "../src/lib/plan/tipos";
import { resolverProductosParaGeneracion } from "../src/lib/rag/generate-products";

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
  const { POST } = await import("../src/app/api/generate/route");
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
        ORDER BY v.variant_id
        LIMIT 2`,
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

    // Boundary evidence without a paid provider: no API key is exposed to the
    // route, so a valid PG id must get past catalog validation and stop at the
    // expected missing-provider configuration error.
    globalThis.__ragPool = pool;
    const validPgBoundary = await postGenerate({ ragVariantIds: [rag.variant_id] });
    assert.equal(validPgBoundary.status, 503);
    assert.ok(validPgBoundary.error && !/could not be validated/i.test(validPgBoundary.error));
    assert.match(validPgBoundary.error ?? "", /llave/i);
    console.log("[PASS] HTTP /api/generate: PG válido supera validación de catálogo; se detiene sin proveedor configurado (sin llamada pagada).");

    const { rows: planRows } = await pool.query<{ product_id: string; variant_id: string }>(
      `SELECT p.product_id, v.variant_id
         FROM catalog_products p
         JOIN catalog_variants v ON v.product_id = p.product_id
        WHERE p.status = 'ACTIVE'
          AND p.available = true
          AND v.available = true
          AND v.price > 0
          AND NULLIF(to_jsonb(v)->>'unidades_paq', '')::integer > 0
        ORDER BY v.variant_id
        LIMIT 1`,
    );
    assert.ok(planRows[0], "La base RAG debe tener una variante cotizable para probar el hash aprobado.");
    const planParaHash = PlanDecoracionSchema.parse({
      plan_version: "1.0",
      plan_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      concepto: { titulo: "Hash aprobado", descripcion: "Prueba de revalidación antes de generar.", paleta: [] },
      espacio: { tipo: "salón", fuente: "supuesto" },
      estructuras: [{
        estructura_id: "EST_01_ACCESORIO",
        nombre: "Pieza aprobada",
        tipo: "accesorio",
        rol_escena: "focal",
        ubicacion: "fondo_pared",
        medidas: {},
        repeticiones: 1,
        densidad: "sencilla",
        mezcla: "clasica",
        materiales: [{ product_id: planRows[0]!.product_id, variant_id: planRows[0]!.variant_id, participacion: 1, rol_material: "principal" }],
        unidades_declaradas: 1,
        porque: "Fixture de hash.",
      }],
      supuestos: [],
    });
    const planAprobado = await resolverPlan(pool, planParaHash, new Map([[planRows[0]!.product_id, new Set([planRows[0]!.variant_id])]]));
    assert.equal(planAprobado.sin_cobertura.length, 0);
    const requestId = randomUUID();
    const token = crearTokenAprobacion(planAprobado.plan_hash, requestId);
    const approvedPlanBoundary = await postGenerate({
      ragVariantIds: [planRows[0]!.variant_id],
      planHash: planAprobado.plan_hash,
      plan: { ...planAprobado, request_id: requestId, approval_token: token },
    });
    assert.notEqual(approvedPlanBoundary.error && /Plan hash does not match/i.test(approvedPlanBoundary.error), true);
    console.log("[PASS] HTTP /api/generate: un plan aprobado conserva el hash al revalidarse con la whitelist del catálogo.");

    const invalidBoundary = await postGenerate({ productIds: "no-es-array" });
    assert.equal(invalidBoundary.status, 400);
    assert.match(invalidBoundary.error ?? "", /productIds must be an array/i);
    console.log("[PASS] HTTP /api/generate: payload malformado devuelve 400 sin llegar al proveedor.");

    const { rows: r24Rows } = await pool.query<{ product_id: string; variant_id: string }>(
      `SELECT p.product_id, v.variant_id
         FROM catalog_products p
         JOIN catalog_variants v ON v.product_id = p.product_id
        WHERE p.title ILIKE '%Diamantes Dorados Fashion Transparente%'
          AND v.codigo_tamano = 'R-24' AND v.available = true
        LIMIT 1`,
    );
    if (!r24Rows[0]) {
      console.log("[N/A] prueba HTTP R-24: el producto del incidente no está en este snapshot de catálogo.");
      return;
    }
    const declarativePlan = PlanDecoracionSchema.parse({
      plan_version: "1.0",
      plan_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      concepto: { titulo: "Regresión R-24", descripcion: "No sustituir columnas R-12 por R-24.", paleta: ["dorado"] },
      espacio: { tipo: "jardín", fuente: "supuesto" },
      estructuras: [{
        estructura_id: "EST_01_COLUMNAS",
        nombre: "Columnas de entrada",
        tipo: "columna",
        rol_escena: "focal",
        ubicacion: "entrada",
        medidas: { alto_m: 1.8 },
        repeticiones: 2,
        densidad: "media",
        mezcla: "clasica",
        materiales: [{ product_id: r24Rows[0].product_id, participacion: 1, rol_material: "principal" }],
        porque: "Caso que antes cotizaba 29 paquetes gigantes.",
      }],
      supuestos: [],
    });
    const hash = planHash(declarativePlan);
    const invalidSizeBoundary = await postGenerate({
      ragVariantIds: [r24Rows[0].variant_id],
      planHash: hash,
      plan: {
        plan: declarativePlan,
        plan_hash: hash,
        compras: [{ variant_id: r24Rows[0].variant_id }],
      },
    });
    assert.equal(invalidSizeBoundary.status, 400);
    assert.match(invalidSizeBoundary.error ?? "", /sin cobertura/i);
    console.log("[PASS] HTTP /api/generate: R-12→R-24 se bloquea antes de llamar al proveedor o emitir cotización.");
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
