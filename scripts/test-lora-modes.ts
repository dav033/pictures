import assert from "node:assert/strict";
import type { Pool } from "pg";
import { listLoraModeOptions, resolveLoraMode, resolveLoraModeDatasetAllowlist } from "../src/lib/lora/mode-resolver";
import { linkDatasetElementsToCatalog } from "../src/lib/lora/dataset-catalog-link";

const modeRow = {
  slug: "training_1" as const,
  display_name: "Producto Sempertex v007",
  training_run_id: "run-v007",
  enforce_dataset_allowlist: true,
  lora_scale: 0.8,
  enabled: true,
  updated_at: "2026-09-03T00:00:00.000Z",
  run_status: "succeeded",
  specialization: "product" as const,
  trigger_token: "eventdecor_style_v3",
  artifact_id: "artifact-v007",
  artifact_status: "backed_up",
  evaluation_status: "approved",
  provider_url: "https://v3b.fal.media/files/product-v007.safetensors",
};

const artifactRow = {
  artifact_id: "artifact-v007",
  run_id: "run-v007",
  dataset_id: "dataset-v007",
  label: "sempertex-producto-v007",
  specialization: "product" as const,
  provider_url: modeRow.provider_url,
  trigger_token: modeRow.trigger_token,
  base_model: "FLUX.2 [dev]",
  tokenizer_revision: "mistral-vlm-24b",
  resolution: 1024,
  run_status: "succeeded",
  artifact_status: "backed_up",
  evaluation_status: "approved",
};

const pool = {
  query: async (sql: string) => sql.includes("lora_mode_slots")
    ? { rows: [modeRow] }
    : { rows: [artifactRow] },
} as unknown as Pool;

async function main(): Promise<void> {
  const options = await listLoraModeOptions(pool);
  assert.equal(options[0]?.ready, true);
  assert.deepEqual(options[0]?.selection, { product: { artifactId: "artifact-v007", scale: 0.8 } });

  const resolved = await resolveLoraMode("training_1", pool);
  assert.equal(resolved[0]?.trigger, "eventdecor_style_v3");
  assert.equal(resolved[0]?.scale, 0.8);

  const pendingPool = {
    query: async () => ({ rows: [{ ...modeRow, run_status: "queued", artifact_id: null, artifact_status: null, evaluation_status: "pending", provider_url: null }] }),
  } as unknown as Pool;
  await assert.rejects(() => resolveLoraMode("training_1", pendingPool), /LORA_MODE_NOT_READY/);

  const rejectedPool = {
    query: async (sql: string) => sql.includes("lora_mode_slots")
      ? { rows: [{ ...modeRow, evaluation_status: "rejected" }] }
      : { rows: [{ ...artifactRow, evaluation_status: "rejected" }] },
  } as unknown as Pool;
  const rejectedOptions = await listLoraModeOptions(rejectedPool);
  assert.equal(rejectedOptions[0]?.status, "failed");
  assert.equal(rejectedOptions[0]?.ready, false);
  await assert.rejects(() => resolveLoraMode("training_1", rejectedPool), /LORA_MODE_NOT_READY/);

  const nodeEnvOriginal = process.env.NODE_ENV;
  const allowRejectedOriginal = process.env.LORA_ALLOW_REJECTED_FOR_TESTING;
  Object.defineProperty(process.env, "NODE_ENV", { configurable: true, enumerable: true, value: "development", writable: true });
  process.env.LORA_ALLOW_REJECTED_FOR_TESTING = "true";
  try {
    const testingOptions = await listLoraModeOptions(rejectedPool);
    assert.equal(testingOptions[0]?.status, "testing_rejected");
    assert.equal(testingOptions[0]?.ready, true);
    const testingResolved = await resolveLoraMode("training_1", rejectedPool);
    assert.equal(testingResolved[0]?.runId, "run-v007");
  } finally {
    if (nodeEnvOriginal === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
    else Object.defineProperty(process.env, "NODE_ENV", { configurable: true, enumerable: true, value: nodeEnvOriginal, writable: true });
    if (allowRejectedOriginal === undefined) delete process.env.LORA_ALLOW_REJECTED_FOR_TESTING;
    else process.env.LORA_ALLOW_REJECTED_FOR_TESTING = allowRejectedOriginal;
  }

  const productionEnvOriginal = process.env.NODE_ENV;
  const productionAllowRejectedOriginal = process.env.LORA_ALLOW_REJECTED_FOR_TESTING;
  Object.defineProperty(process.env, "NODE_ENV", { configurable: true, enumerable: true, value: "production", writable: true });
  process.env.LORA_ALLOW_REJECTED_FOR_TESTING = "true";
  try {
    const productionOptions = await listLoraModeOptions(rejectedPool);
    assert.equal(productionOptions[0]?.status, "failed");
    assert.equal(productionOptions[0]?.ready, false);
    await assert.rejects(() => resolveLoraMode("training_1", rejectedPool), /LORA_MODE_NOT_READY/);
  } finally {
    if (productionEnvOriginal === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
    else Object.defineProperty(process.env, "NODE_ENV", { configurable: true, enumerable: true, value: productionEnvOriginal, writable: true });
    if (productionAllowRejectedOriginal === undefined) delete process.env.LORA_ALLOW_REJECTED_FOR_TESTING;
    else process.env.LORA_ALLOW_REJECTED_FOR_TESTING = productionAllowRejectedOriginal;
  }

  console.log("[PASS] modos LoRA: v007 bloqueado en producción y disponible solo para pruebas locales explícitas");

  await testDatasetLinkedAfterCatalogReimport();
  console.log("[PASS] allowlist LoRA: dataset vinculado al catálogo re-importado por SKU canónico exacto");
}

/**
 * Regression: the catalog was re-imported from another Shopify source, so the
 * product/variant ids stored in lora_dataset_element_stats no longer exist.
 * The allowlist must link by exact canonical SKU and report what cannot be
 * linked, instead of failing as if the dataset were empty.
 */
async function testDatasetLinkedAfterCatalogReimport(): Promise<void> {
  const stats = [
    { canonical_id: "old-p1:old-v1", product_id: "old-p1", variant_id: "old-v1", sku: "20014242", image_count: 23 },
    { canonical_id: "old-p1:old-v2", product_id: "old-p1", variant_id: "old-v2", sku: "20099999", image_count: 3 },
    { canonical_id: "old-p2:old-v3", product_id: "old-p2", variant_id: "old-v3", sku: "30000993", image_count: 2 },
  ];
  const catalog = [
    { variant_id: "new-v1", product_id: "new-p1", sku_canonical: "20014242", sku_ambiguous: false },
    { variant_id: "new-v2a", product_id: "new-p2", sku_canonical: "30000993", sku_ambiguous: true },
    { variant_id: "new-v2b", product_id: "new-p2", sku_canonical: "30000993", sku_ambiguous: true },
  ];

  const pureLink = linkDatasetElementsToCatalog(
    stats.map((row) => ({ canonicalId: row.canonical_id, productId: row.product_id, variantId: row.variant_id, sku: row.sku, imageCount: row.image_count })),
    catalog.map((row) => ({ variantId: row.variant_id, productId: row.product_id, skuCanonical: row.sku_canonical, skuAmbiguous: row.sku_ambiguous })),
    new Set(["new-p1", "new-p2"]),
  );
  assert.deepEqual(pureLink.linked, [{ canonicalId: "old-p1:old-v1", productId: "new-p1", variantId: "new-v1", imageCount: 23, via: "sku_canonical" }]);
  assert.deepEqual(pureLink.unmatched, ["old-p1:old-v2"]);
  assert.deepEqual(pureLink.ambiguous, ["old-p2:old-v3"]);

  // A still-valid id wins, but never over a contradicting SKU; B2B- prefix is not identity.
  const idLink = linkDatasetElementsToCatalog(
    [
      { canonicalId: "a", productId: "p", variantId: "v", sku: "B2B-111", imageCount: 1 },
      { canonicalId: "b", productId: "p", variantId: "w", sku: "999", imageCount: 1 },
      { canonicalId: "c", productId: "p", variantId: "stale", sku: null, imageCount: 1 },
    ],
    [
      { variantId: "v", productId: "p", skuCanonical: "111", skuAmbiguous: false },
      { variantId: "w", productId: "p", skuCanonical: "222", skuAmbiguous: false },
    ],
    new Set(["p"]),
  );
  assert.deepEqual(idLink.linked.map((item) => [item.canonicalId, item.via]), [["a", "variant_id"]]);
  assert.deepEqual(idLink.conflicts, ["b"]);
  assert.deepEqual(idLink.unmatched, ["c"]);

  // Catalog queries honor their id parameters, so stale dataset ids find nothing.
  const catalogRows = [
    { variant_id: "new-v1", product_id: "new-p1", sku: "B2B-20014242", titulo: "B2b Globo Latex Redondo Reflex Dorado" },
    { variant_id: "new-v1-pack50", product_id: "new-p1", sku: "B2B-20017754", titulo: "B2b Globo Latex Redondo Reflex Dorado" },
  ];
  const idsParam = (params: unknown[] | undefined): string[] => {
    const first = params?.[0];
    return Array.isArray(first) ? first.filter((value): value is string => typeof value === "string") : [];
  };
  const reimportedPool = {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes("lora_mode_slots")) return { rows: [{ ...modeRow, dataset_id: "dataset-v004" }] };
      if (sql.includes("FROM lora_dataset_element_stats")) return { rows: stats };
      if (sql.includes("sku_canonical = ANY")) return { rows: catalog };
      if (sql.includes("FROM catalog_products WHERE product_id")) return { rows: [] };
      if (sql.includes("identidad_visual")) {
        return { rows: idsParam(params).includes("new-v1") ? catalogRows.map(({ product_id, variant_id }) => ({ product_id, variant_id })) : [] };
      }
      if (sql.includes("JOIN catalog_products p")) {
        const ids = idsParam(params);
        return { rows: catalogRows.filter((row) => ids.includes(row.variant_id)) };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  } as unknown as Pool;
  const warn = console.warn;
  console.warn = () => undefined;
  try {
    const allowlist = await resolveLoraModeDatasetAllowlist("training_1", reimportedPool);
    assert.deepEqual(allowlist?.productIds, ["new-p1"]);
    assert.deepEqual(allowlist?.variantIds, ["new-v1", "new-v1-pack50"]);
  } finally {
    console.warn = warn;
  }

  // Fail closed with an explicit code when nothing links: never an empty-looking dataset.
  const unlinkedPool = {
    query: async (sql: string) => {
      if (sql.includes("lora_mode_slots")) return { rows: [{ ...modeRow, dataset_id: "dataset-v004" }] };
      if (sql.includes("FROM lora_dataset_element_stats")) return { rows: stats };
      return { rows: [] };
    },
  } as unknown as Pool;
  console.warn = () => undefined;
  try {
    await assert.rejects(() => resolveLoraModeDatasetAllowlist("training_1", unlinkedPool), /LORA_DATASET_CATALOG_UNLINKED: dataset-v004 \(unmatched=3, ambiguous=0, conflicts=0\)/);
  } finally {
    console.warn = warn;
  }
}

main().catch((error) => {
  console.error("[FAIL] test-lora-modes", error);
  process.exitCode = 1;
});
