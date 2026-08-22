import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { canonicalizeCatalog } from "../src/lib/rag/catalog/canonicalize";
import {
  identitiesFromCanonicalCatalog,
  aggregateOrderData,
  type CatalogVariantIdentity,
  type OrderAggregateReport,
} from "../src/lib/rag/orders/aggregate";
import { persistOrderDemand } from "../src/lib/rag/orders/persist";
import {
  contieneIdentidadSensible,
  type OrderDataSource,
  type ProductsCatalogSource,
} from "../src/lib/rag/sources/contracts";
import {
  createManifest,
  fetchSourceJson,
  ORDER_DATA_URL,
  parseOrderData,
  parseProductsCatalog,
  PRODUCTS_CATALOG_URL,
  type SourceManifest,
} from "../src/lib/rag/sources/fetch";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const DEFAULT_MANIFEST = path.resolve(process.cwd(), "data", "manifests", "rag-order-demand.json");
const DEFAULT_ORDER_FIXTURE = path.resolve(process.cwd(), "eval", "fixtures", "order_data.fixture.json");
const DEFAULT_CATALOG_FIXTURE = path.resolve(process.cwd(), "eval", "fixtures", "products_catalog.fixture.json");

type CliOptions = {
  manifestPath: string | null;
  dryRun: boolean;
  offline: boolean;
  orderFixture: string;
  catalogFixture: string;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    manifestPath: null,
    dryRun: false,
    offline: false,
    orderFixture: DEFAULT_ORDER_FIXTURE,
    catalogFixture: DEFAULT_CATALOG_FIXTURE,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--manifest") {
      const next = argv[index + 1];
      if (next && !next.startsWith("--")) {
        options.manifestPath = path.resolve(process.cwd(), next);
        index++;
      } else {
        options.manifestPath = DEFAULT_MANIFEST;
      }
    } else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--offline") options.offline = true;
    else if (arg === "--fixture") {
      const next = argv[++index];
      if (!next || next.startsWith("--")) throw new Error("--fixture requiere una ruta de order_data");
      options.orderFixture = path.resolve(process.cwd(), next);
      options.offline = true;
    } else if (arg === "--catalog-fixture") {
      const next = argv[++index];
      if (!next || next.startsWith("--")) throw new Error("--catalog-fixture requiere una ruta");
      options.catalogFixture = path.resolve(process.cwd(), next);
      options.offline = true;
    } else throw new Error(`argumento no reconocido: ${arg}`);
  }
  return options;
}

async function fixtureResponse(file: string): Promise<{ body: string; response: Response }> {
  const body = await readFile(file, "utf8");
  return { body, response: new Response(body, { status: 200, headers: { "content-type": "application/json" } }) };
}

function assertJsonContentType(response: Response, kind: string): void {
  const contentType = response.headers.get("content-type");
  if (!contentType || !/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new Error(`${kind} content-type is not application/json`);
  }
}

async function getOrderSource(options: CliOptions): Promise<{ source: OrderDataSource; manifest: SourceManifest }> {
  const fetched = options.offline
    ? await fixtureResponse(options.orderFixture)
    : await fetchSourceJson("order_data", ORDER_DATA_URL, { timeoutMs: 30_000, retries: 3, retryDelayMs: 300 });
  assertJsonContentType(fetched.response, "order_data");
  const source = parseOrderData(fetched.body);
  const manifest = createManifest(
    "order_data",
    options.offline ? `fixture://${path.basename(options.orderFixture)}` : ORDER_DATA_URL,
    fetched.body,
    fetched.response,
    source,
  );
  return { source, manifest };
}

async function getCatalogSource(options: CliOptions): Promise<ProductsCatalogSource> {
  const fetched = options.offline
    ? await fixtureResponse(options.catalogFixture)
    : await fetchSourceJson("products_catalog", PRODUCTS_CATALOG_URL, { timeoutMs: 30_000, retries: 3, retryDelayMs: 300 });
  assertJsonContentType(fetched.response, "products_catalog");
  return parseProductsCatalog(fetched.body);
}

function safeManifest(
  manifest: SourceManifest,
  catalogCounts: { products: number; variants: number },
  report: OrderAggregateReport,
): Record<string, unknown> {
  const value = {
    generated_at: new Date().toISOString(),
    source: {
      kind: manifest.kind,
      url: manifest.url,
      fetched_at: manifest.fetched_at,
      status: manifest.status,
      content_type: manifest.content_type,
      bytes: manifest.bytes,
      sha256: manifest.sha256,
      counts: manifest.counts,
      contract_version: manifest.contract_version,
    },
    catalog_counts: catalogCounts,
    aggregate: report,
  };
  if (contieneIdentidadSensible(value)) throw new Error("safe order manifest contains a sensitive identity key");
  return value;
}

async function writeSafeManifest(file: string, value: Record<string, unknown>): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/**
 * Publication uses the catalog already committed by the product importer.
 * This prevents a second remote canonicalization from joining orders to a
 * different catalog version. The source catalog is used only by dry-runs.
 */
async function loadPublishedIdentities(pool: Pool): Promise<CatalogVariantIdentity[]> {
  const result = await pool.query<{
    variant_id: string;
    source_variant_id: string;
    product_id: string;
    sku_original: string | null;
    sku_canonical: string | null;
    sku_ambiguous: boolean;
  }>(
    `SELECT cv.variant_id,
            COALESCE(cv.source_variant_id, cv.variant_id) AS source_variant_id,
            cv.product_id,
            COALESCE(cv.sku_original, cv.sku) AS sku_original,
            COALESCE(cv.sku_canonical, cv.sku) AS sku_canonical,
            COALESCE(cv.sku_ambiguous, FALSE) AS sku_ambiguous
       FROM catalog_variants cv
       JOIN catalog_products cp ON cp.product_id = cv.product_id
      WHERE COALESCE(cp.source_status, cp.status) = 'ACTIVE'
        AND cv.price > 0`,
  );
  if (result.rows.length === 0) {
    throw new Error("published catalog is empty; import products_catalog before order demand");
  }
  return result.rows.map((row) => ({
    variantId: row.variant_id,
    sourceVariantId: row.source_variant_id,
    productId: row.product_id,
    skuOriginal: row.sku_original,
    skuCanonical: row.sku_canonical,
    skuAmbiguous: row.sku_ambiguous,
  }));
}

function printReport(report: OrderAggregateReport): void {
  console.log(
    `[PASS] observed_demand: ${report.orders} orders/${report.lines} lines; matched ${report.matchedLines}; ` +
      `ambiguous SKU lines ${report.ambiguousSkuLines} (+${report.matchedWithAmbiguousSkuLines} exact-ID lines); ` +
      `unmatched ${report.unmatchedLines}; ` +
      `aggregates ${report.aggregateVariants}; units ${report.unitsObserved}`,
  );
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const { source, manifest } = await getOrderSource(options);
  let pool: Pool | null = null;
  let identities: CatalogVariantIdentity[];
  let catalogCounts: { products: number; variants: number };

  if (options.dryRun) {
    const catalogSource = await getCatalogSource(options);
    const canonicalCatalog = canonicalizeCatalog(catalogSource);
    identities = identitiesFromCanonicalCatalog(canonicalCatalog);
    catalogCounts = {
      products: catalogSource.length,
      variants: catalogSource.reduce((count, product) => count + product.variants.length, 0),
    };
  } else {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL no está configurada; use --dry-run para validar sin publicar");
    pool = new Pool({ connectionString: url });
    try {
      identities = await loadPublishedIdentities(pool);
    } catch (error) {
      await pool.end();
      throw error;
    }
    catalogCounts = { products: new Set(identities.map((row) => row.productId)).size, variants: identities.length };
  }

  const batch = aggregateOrderData(source, identities);
  const sourceSnapshotId = `order_data:${manifest.sha256}`;
  printReport(batch.report);

  if (options.manifestPath) {
    await writeSafeManifest(options.manifestPath, safeManifest(manifest, catalogCounts, batch.report));
    console.log(`[PASS] safe manifest written: ${path.relative(process.cwd(), options.manifestPath)}`);
  }
  if (options.dryRun) return;

  if (!pool) throw new Error("internal error: database pool missing");
  try {
    const result = await persistOrderDemand(pool, batch, { sourceSnapshotId, manifest });
    console.log(
      `[PASS] snapshot ${result.snapshotId} persisted: ${result.aggregateRows} aggregates; ` +
        `${result.insertedRows} new, ${result.existingRows} existing, ${result.staleRowsDeleted} stale deleted; replay-safe=${result.idempotent}`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`[FAIL] order aggregate import: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
});
