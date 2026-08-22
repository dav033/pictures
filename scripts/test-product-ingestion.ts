import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { parseProductsCatalog, createManifest } from "../src/lib/rag/sources/fetch";
import type { ProductsCatalogSource } from "../src/lib/rag/sources/contracts";
import { canonicalizeCatalog } from "../src/lib/rag/catalog/canonicalize";
import { persistStagedCatalog } from "../src/lib/rag/catalog/persist-staged";
import { normalizarProducto } from "../src/lib/rag/catalog/normalize";
import type { ProductoPublico } from "../src/lib/shopify/tipos";

const DEFAULT_FIXTURE = path.resolve(process.cwd(), "eval", "fixtures", "products_catalog.fixture.json");

function parseArgs(argv: string[]): { fixture: string; idempotency: boolean; schema: boolean } {
  let fixture = DEFAULT_FIXTURE;
  let idempotency = false;
  let schema = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--fixture") {
      const next = argv[++index];
      if (!next || next.startsWith("--")) throw new Error("--fixture requiere una ruta");
      fixture = path.resolve(process.cwd(), next);
    } else if (arg === "--idempotency") idempotency = true;
    else if (arg === "--schema") schema = true;
    else if (arg !== "--canonicalize") throw new Error(`argumento no reconocido: ${arg}`);
  }
  return { fixture, idempotency, schema };
}

async function loadFixture(file: string): Promise<{ source: ProductsCatalogSource; body: string }> {
  const body = await readFile(file, "utf8");
  return { source: parseProductsCatalog(body), body };
}

function assertCanonicalInvariants(source: ProductsCatalogSource): void {
  const first = canonicalizeCatalog(source);
  const second = canonicalizeCatalog(source);
  assert.deepEqual(first, second, "identical source must canonicalize identically");
  assert.equal(first.products.length, 1, "fixture publishes only the ACTIVE product");
  assert.equal(first.products[0].status, "ACTIVE");
  assert.equal(first.products[0].variants.length, 1);
  const variant = first.products[0].variants[0];
  assert.equal(variant.price, 1234);
  assert.equal(variant.currency, "COP");
  assert.equal(variant.available, true);
  assert.equal(variant.inventory_quantity, 12);
  assert.equal(variant.codigo_tamano, "R-12");
  assert.equal(variant.forma, "redondo");
  assert.deepEqual(variant.derived_colors, ["rojo"]);
  assert.equal(variant.attribute_states.color, "derived");
  assert.equal(first.products[0].image_urls[0], "https://example.invalid/fixture-product-001.jpg");
  assert.match(first.products[0].search_text, /FIXTURE-SKU-001/);
  assert.doesNotMatch(first.products[0].search_text, /1234(?:\.00)?/);
  assert.doesNotMatch(first.products[0].search_text, /inventory|stock|availableForSale/i);
  assert.ok(first.rejections.some((rejection) => rejection.reason.startsWith("source_status_draft")));

  const heartSource: ProductsCatalogSource = [{
    ...source[0],
    id: "gid://shopify/Product/fixture-product-heart",
    handle: "fixture-heart-pack",
    tags: ["CORAZON 12"],
    variants: [{
      ...source[0].variants[0],
      id: "gid://shopify/ProductVariant/fixture-variant-heart",
      title: "CORAZON 12 / PAQUETE X 10",
    }],
  }];
  const heart = canonicalizeCatalog(heartSource);
  assert.equal(heart.products[0]?.variants[0]?.codigo_tamano, "C-12", "CORAZON 12 must normalize to explicit C-12");
  assert.equal(heart.products[0]?.variants[0]?.forma, "corazon", "CORAZON 12 must derive heart shape");

  const variantColorSource: ProductsCatalogSource = [{
    ...source[0],
    id: "gid://shopify/Product/fixture-product-variant-color",
    handle: "fixture-product-variant-color",
    title: "Cuchara Deluxe",
    tags: [],
    variants: [{
      ...source[0].variants[0],
      id: "gid://shopify/ProductVariant/fixture-variant-color",
      title: "ROJO / R-12",
    }],
  }];
  const variantColor = canonicalizeCatalog(variantColorSource).products[0]?.variants[0];
  assert.deepEqual(variantColor?.derived_colors, ["rojo"], "variant color evidence must come from the variant title");

  const roseGold = canonicalizeCatalog([{
    ...source[0],
    id: "gid://shopify/Product/fixture-product-rose-gold",
    handle: "fixture-product-rose-gold",
    title: "Globo dorado rosa",
    tags: ["DORADO ROSA", "DORADO", "ROSADO"],
    variants: [{
      ...source[0].variants[0],
      id: "gid://shopify/ProductVariant/fixture-variant-rose-gold",
      title: "DORADO ROSA / PAQUETE X 12",
    }],
  }]).products[0]?.variants[0];
  assert.deepEqual(roseGold?.derived_colors, ["dorado rosa"], "compound rose-gold must not be split into redundant colors");

  const productTitleColors = canonicalizeCatalog([
    {
      ...source[0],
      id: "gid://shopify/Product/fixture-product-title-colors",
      handle: "fixture-product-title-colors",
      title: "Velita Dorado-Plata-Negro",
      tags: ["DORADO", "PLATA", "NEGRO", "color sibling leakage must not matter"],
      variants: [
        { ...source[0].variants[0], id: "gid://shopify/ProductVariant/fixture-variant-title-colors-a", title: "PAQUETE X 10" },
        { ...source[0].variants[0], id: "gid://shopify/ProductVariant/fixture-variant-title-colors-b", title: "PAQUETE X 20" },
      ],
    },
    {
      ...source[0],
      id: "gid://shopify/Product/fixture-product-variant-colors",
      handle: "fixture-product-variant-colors",
      title: "Kit Dorado/Negro",
      tags: ["ROJO", "AZUL", "NEGRO"],
      variants: [{ ...source[0].variants[0], id: "gid://shopify/ProductVariant/fixture-variant-title-colors-c", title: "SURTIDO" }],
    },
  ]);
  assert.deepEqual(productTitleColors.products[0]?.variants[0]?.derived_colors, ["dorado", "plateado", "negro"], "all product-title colors must apply to a variant without direct color evidence");
  assert.deepEqual(productTitleColors.products[0]?.variants[1]?.derived_colors, ["dorado", "plateado", "negro"], "each sibling must inherit product-title colors");
  assert.deepEqual(productTitleColors.products[1]?.variants[0]?.derived_colors, ["multicolor", "dorado", "negro"], "assortment variants must retain generic and product-title colors, not sibling tags");

  const multivariantNoProductColor = canonicalizeCatalog([{
    ...source[0],
    id: "gid://shopify/Product/fixture-product-no-title-color",
    handle: "fixture-product-no-title-color",
    title: "Cuchara Deluxe",
    tags: ["ROJO", "AZUL", "NEGRO"],
    variants: [{ ...source[0].variants[0], id: "gid://shopify/ProductVariant/fixture-variant-no-title-color", title: "ESCARCHADA / PAQUETE X 10" }],
  }]).products[0]?.variants[0];
  assert.deepEqual(multivariantNoProductColor?.derived_colors, [], "a product color union must not leak into an unknown finish variant");

  const genericAssortment = canonicalizeCatalog([{
    ...source[0],
    id: "gid://shopify/Product/fixture-product-generic-assortment",
    handle: "fixture-product-generic-assortment",
    title: "Kit de globos",
    tags: [],
    variants: [{ ...source[0].variants[0], id: "gid://shopify/ProductVariant/fixture-variant-generic-assortment", title: "MULTICOLOR" }],
  }]).products[0]?.variants[0];
  assert.deepEqual(genericAssortment?.derived_colors, ["multicolor"], "generic MULTICOLOR evidence must not disappear");

  const titleSizeAndCategory = canonicalizeCatalog([{
    ...source[0],
    id: "gid://shopify/Product/fixture-product-title-size-category",
    handle: "fixture-product-title-size-category",
    title: "Decor-Kit Bouquet Globo Latex R12",
    productType: "LÁTEX",
    tags: [],
    variants: [{ ...source[0].variants[0], id: "gid://shopify/ProductVariant/fixture-variant-title-size-category", title: "PAQUETE X 12" }],
  }]).products[0];
  assert.equal(titleSizeAndCategory?.derived.category, "kit", "explicit Decor-Kit title must override legacy product type");
  assert.equal(titleSizeAndCategory?.variants[0]?.codigo_tamano, "R12", "R12 in product title must remain explicit size evidence");
  assert.equal(titleSizeAndCategory?.variants[0]?.forma, "redondo");
  assert.equal(titleSizeAndCategory?.variants[0]?.diam_pulg, 12);

  const titleWinsOverConflictingTags = canonicalizeCatalog([{
    ...source[0],
    id: "gid://shopify/Product/fixture-product-title-before-tags",
    handle: "fixture-product-title-before-tags",
    title: "Bouquet Globo Latex R12",
    tags: ["R-5", "R-12"],
    variants: [{ ...source[0].variants[0], id: "gid://shopify/ProductVariant/fixture-variant-title-before-tags", title: "PAQUETE X 12" }],
  }]).products[0]?.variants[0];
  assert.equal(titleWinsOverConflictingTags?.codigo_tamano, "R12", "product title size evidence must precede conflicting sibling tags");

  const conflictingTagsOnly = canonicalizeCatalog([{
    ...source[0],
    id: "gid://shopify/Product/fixture-product-conflicting-tags-only",
    handle: "fixture-product-conflicting-tags-only",
    title: "Bouquet Globo Latex",
    tags: ["R-5", "R-12"],
    variants: [{ ...source[0].variants[0], id: "gid://shopify/ProductVariant/fixture-variant-conflicting-tags-only", title: "PAQUETE X 12" }],
  }]).products[0]?.variants[0];
  assert.equal(conflictingTagsOnly?.codigo_tamano, null, "conflicting sibling size tags must not choose an arbitrary first value");

  const adjectiveSize = canonicalizeCatalog([{
    ...source[0],
    id: "gid://shopify/Product/fixture-product-adjective-size",
    handle: "fixture-product-adjective-size",
    title: "Servilleta Pequeña",
    tags: [],
    variants: [{ ...source[0].variants[0], id: "gid://shopify/ProductVariant/fixture-variant-adjective-size", title: "PAQUETE X 10" }],
  }]).products[0]?.variants[0];
  assert.equal(adjectiveSize?.diam_pulg, null, "adjectives must not fabricate hard inches");
  assert.equal(adjectiveSize?.forma, null, "adjectives must not fabricate a shape");

  const decorativeHearts = canonicalizeCatalog([{
    ...source[0],
    id: "gid://shopify/Product/fixture-product-decorative-hearts",
    handle: "fixture-product-decorative-hearts",
    title: "Vaso corazones pop",
    tags: [],
    variants: [{ ...source[0].variants[0], id: "gid://shopify/ProductVariant/fixture-variant-decorative-hearts", title: "PAQUETE X 10" }],
  }]).products[0]?.variants[0];
  assert.equal(decorativeHearts?.forma, null, "decorative hearts in a vessel title are not physical shape evidence");

  const escarchada = canonicalizeCatalog([{
    ...source[0],
    id: "gid://shopify/Product/fixture-product-escarchada",
    handle: "fixture-product-escarchada",
    title: "Globo rojo",
    tags: ["ROJO"],
    variants: [{
      ...source[0].variants[0],
      id: "gid://shopify/ProductVariant/fixture-variant-escarchada",
      title: "ESCARCHADA / PAQUETE X 12",
    }],
  }]).products[0]?.variants[0];
  assert.deepEqual(escarchada?.derived_colors, [], "ESCARCHADA is a finish/unknown, not an inherited color");

  const activeWithoutSellableVariant: ProductsCatalogSource = [{
    ...source[0],
    id: "gid://shopify/Product/fixture-product-zero",
    handle: "fixture-product-zero",
    variants: [{ ...source[0].variants[0], id: "gid://shopify/ProductVariant/fixture-variant-zero", price: "0.00", availableForSale: true }],
  }];
  const zeroPrice = canonicalizeCatalog(activeWithoutSellableVariant);
  assert.equal(zeroPrice.products.length, 0, "ACTIVE product with no positive variant must not publish");
  assert.ok(zeroPrice.rejections.some((rejection) => rejection.reason === "non_positive_price"));
  assert.ok(zeroPrice.rejections.some((rejection) => rejection.reason === "no_positive_price_variant"));

  const unavailablePositive: ProductsCatalogSource = [{
    ...source[0],
    id: "gid://shopify/Product/fixture-product-unavailable",
    handle: "fixture-product-unavailable",
    variants: [{ ...source[0].variants[0], id: "gid://shopify/ProductVariant/fixture-variant-unavailable", price: "2000.00", availableForSale: false, inventoryQuantity: 100 }],
  }];
  const unavailable = canonicalizeCatalog(unavailablePositive);
  assert.equal(unavailable.products.length, 1, "availability must not be inferred from inventory or another variant");
  assert.equal(unavailable.products[0].available, false);
  assert.equal(unavailable.products[0].variants[0].available, false);
  assert.equal(unavailable.products[0].variants[0].inventory_quantity, 100);

  const duplicateSource: ProductsCatalogSource = [
    ...source,
    {
      ...source[0],
      id: "gid://shopify/Product/fixture-product-003",
      handle: "fixture-globo-rojo-003",
      variants: [{ ...source[0].variants[0], id: "gid://shopify/ProductVariant/fixture-variant-003" }],
    },
  ];
  const duplicate = canonicalizeCatalog(duplicateSource);
  assert.equal(duplicate.products.length, 2);
  assert.ok(duplicate.products.every((product) => product.variants[0].sku_ambiguous));
  assert.equal(duplicate.products[0].product_id, "fixture-product-001");
  assert.equal(duplicate.products[0].variants[0].variant_id, "fixture-variant-001");
  console.log(`[PASS] canonicalize: ${first.products.length} publishable product, ${first.rejections.length} rejection(s), duplicate SKU marked ambiguous`);
}

function assertLegacyNormalizerInvariants(): void {
  const raw: ProductoPublico = {
    id: 700001,
    title: "Decor-Kit Bouquet Globo Latex R12",
    handle: "fixture-legacy-v2-equivalence",
    body_html: "<p>Fixture</p>",
    product_type: "LÁTEX",
    tags: ["DORADO ROSA", "DORADO", "ROSADO"],
    updated_at: "2026-01-01T00:00:00Z",
    variants: [{
      id: 700002,
      title: "R-12 ROJO",
      option1: "R-12",
      option2: null,
      option3: null,
      sku: "B2B-FIXTURE-LEGACY",
      price: "1234",
      available: true,
      grams: 5,
    }],
    images: [],
  };
  const result = normalizarProducto(raw, new Map([["B2B-FIXTURE-LEGACY", 12]]));
  assert.equal(result.ok, true, "legacy normalizer should accept the v2 equivalence fixture");
  if (!result.ok) return;
  assert.equal(result.producto.derived.category, "kit", "title category precedence must match canonical v2");
  assert.deepEqual(result.producto.derived.colors, ["dorado rosa"], "compound color must stay one v2 color");
  assert.deepEqual(result.variantes[0]?.derived_colors, ["rojo"], "variant color must come from variant evidence");
  assert.equal(result.variantes[0]?.forma, "redondo");
  assert.equal(result.variantes[0]?.diam_pulg, 12);

  const wine = normalizarProducto({ ...raw, id: 700003, title: "Bolsa para vino", handle: "fixture-legacy-wine", tags: [], product_type: "EMPAQUES" }, new Map());
  assert.equal(wine.ok, true);
  if (wine.ok) assert.deepEqual(wine.producto.derived.colors, [], "object/use context must not turn bolsa para vino into burdeos");
}

async function assertDbIdempotency(source: ProductsCatalogSource, body: string): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL no está configurada; use solo --canonicalize o levante Postgres");
  const response = new Response(body, { status: 200, headers: { "content-type": "application/json" } });
  const manifest = createManifest("products_catalog", "fixture://products_catalog.fixture.json", body, response, source);
  const catalog = canonicalizeCatalog(source);
  const pool = new Pool({ connectionString: url });
  const snapshotId = `test-products:${manifest.sha256}`;
  try {
    // The tiny synthetic fixture is intentionally partial relative to a live
    // catalog, so isolate this two-run test with an explicit opt-in.
    await persistStagedCatalog(pool, catalog, { sourceSnapshotId: snapshotId, manifest, maxDropRatio: 0, allowPartial: true });
    const firstProducts = await pool.query("SELECT product_id, handle, title, status, available, price_min, price_max, derived, search_text, embedding_source_hash FROM catalog_products ORDER BY product_id");
    const firstVariants = await pool.query("SELECT variant_id, product_id, sku, sku_canonical, sku_ambiguous, price, currency, inventory_quantity, available, codigo_tamano, forma FROM catalog_variants ORDER BY variant_id");
    const firstAudit = await pool.query("SELECT published_products, published_variants, rejected_records, status FROM rag_source_snapshots WHERE source_snapshot_id = $1", [snapshotId]);
    const firstRejections = await pool.query("SELECT COUNT(*)::text AS count FROM catalog_rejections WHERE source_snapshot_id = $1", [snapshotId]);
    await persistStagedCatalog(pool, catalog, { sourceSnapshotId: snapshotId, manifest, maxDropRatio: 0, allowPartial: true });
    const secondProducts = await pool.query("SELECT product_id, handle, title, status, available, price_min, price_max, derived, search_text, embedding_source_hash FROM catalog_products ORDER BY product_id");
    const secondVariants = await pool.query("SELECT variant_id, product_id, sku, sku_canonical, sku_ambiguous, price, currency, inventory_quantity, available, codigo_tamano, forma FROM catalog_variants ORDER BY variant_id");
    const secondAudit = await pool.query("SELECT published_products, published_variants, rejected_records, status FROM rag_source_snapshots WHERE source_snapshot_id = $1", [snapshotId]);
    const secondRejections = await pool.query("SELECT COUNT(*)::text AS count FROM catalog_rejections WHERE source_snapshot_id = $1", [snapshotId]);
    assert.deepEqual(secondProducts.rows, firstProducts.rows, "second identical publish changed product content");
    assert.deepEqual(secondVariants.rows, firstVariants.rows, "second identical publish changed variant content");
    assert.deepEqual(secondAudit.rows, firstAudit.rows, "second identical publish changed snapshot counters");
    assert.deepEqual(secondRejections.rows, firstRejections.rows, "second identical publish duplicated rejection audit rows");
    const orphaned = await pool.query("SELECT COUNT(*)::text AS count FROM catalog_variants v LEFT JOIN catalog_products p ON p.product_id = v.product_id WHERE p.product_id IS NULL");
    assert.equal(orphaned.rows[0]?.count, "0", "published variants must have a product");

    const beforePartial = await pool.query("SELECT COUNT(*)::text AS count FROM catalog_products");
    const emptyCatalog = canonicalizeCatalog([]);
    await assert.rejects(
      persistStagedCatalog(pool, emptyCatalog, { sourceSnapshotId: snapshotId, manifest, maxDropRatio: 0 }),
      /no publishable products/,
      "empty source must be rejected before purging published rows",
    );
    const afterPartial = await pool.query("SELECT COUNT(*)::text AS count FROM catalog_products");
    assert.deepEqual(afterPartial.rows, beforePartial.rows, "failed empty import must leave published catalog unchanged");
    console.log("[PASS] database idempotency: second identical ingest has identical published content");
  } finally {
    await pool.end();
  }
}

async function assertDbSchema(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL no está configurada; levante Postgres para --schema");
  const pool = new Pool({ connectionString: url });
  try {
    const tables = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [["rag_source_snapshots", "catalog_products_staging", "catalog_variants_staging", "catalog_products", "catalog_variants", "catalog_rejections"]],
    );
    const expected = new Set(["rag_source_snapshots", "catalog_products_staging", "catalog_variants_staging", "catalog_products", "catalog_variants", "catalog_rejections"]);
    assert.deepEqual(new Set(tables.rows.map((row) => row.table_name)), expected, "migration 007 tables are incomplete");
    const columns = await pool.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND (table_name, column_name) IN
       (('catalog_products','source_snapshot_id'),('catalog_products','source_status'),
        ('catalog_variants','sku_canonical'),('catalog_variants','sku_ambiguous'),
        ('catalog_rejections','source_snapshot_id'))`,
    );
    assert.equal(columns.rows.length, 5, "provenance/ambiguity columns are incomplete");
    const constraints = await pool.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
       WHERE conrelid IN ('catalog_products_staging'::regclass, 'catalog_variants_staging'::regclass)
         AND contype = 'c'`,
    );
    const definitions = constraints.rows.map((row) => row.definition).join(" ");
    assert.match(definitions, /price/i, "staging price constraint missing");
    assert.match(definitions, /btrim|product_id|variant_id/i, "staging non-empty ID constraint missing");
    const before = await pool.query("SELECT COUNT(*)::text AS count FROM catalog_products");
    const orphaned = await pool.query("SELECT COUNT(*)::text AS count FROM catalog_variants v LEFT JOIN catalog_products p ON p.product_id = v.product_id WHERE p.product_id IS NULL");
    assert.equal(orphaned.rows[0]?.count, "0", "published variants must have a product");
    const after = await pool.query("SELECT COUNT(*)::text AS count FROM catalog_products");
    assert.deepEqual(after.rows, before.rows, "schema verification must not mutate published data");
    console.log("[PASS] schema: migration 007 tables, provenance columns, constraints and FK invariants present");
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(options.fixture)) throw new Error(`fixture not found: ${options.fixture}`);
  const { source, body } = await loadFixture(options.fixture);
  assertCanonicalInvariants(source);
  assertLegacyNormalizerInvariants();
  if (options.schema) await assertDbSchema();
  if (options.idempotency) await assertDbIdempotency(source, body);
}

main().catch((error) => {
  console.error(`[FAIL] product ingestion test: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
});
