import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import {
  contieneIdentidadSensible,
  type ProductsCatalogSource,
} from "../src/lib/rag/sources/contracts";
import {
  createManifest,
  fetchSourceJson,
  parseProductsCatalog,
  PRODUCTS_CATALOG_URL,
  type SourceManifest,
} from "../src/lib/rag/sources/fetch";
import { canonicalizeCatalog } from "../src/lib/rag/catalog/canonicalize";
import { persistStagedCatalog } from "../src/lib/rag/catalog/persist-staged";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const DEFAULT_MANIFEST = path.resolve(process.cwd(), "data", "manifests", "rag-products-source.json");
const DEFAULT_FIXTURE = path.resolve(process.cwd(), "eval", "fixtures", "products_catalog.fixture.json");

type CliOptions = {
  manifestPath: string | null;
  dryRun: boolean;
  offline: boolean;
  fixturePath: string;
  allowPartial: boolean;
  maxDropRatio: number;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    manifestPath: null,
    dryRun: false,
    offline: false,
    fixturePath: DEFAULT_FIXTURE,
    allowPartial: false,
    maxDropRatio: 0.5,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--manifest") {
      const next = argv[index + 1];
      if (next && !next.startsWith("--")) options.manifestPath = path.resolve(process.cwd(), next), index++;
      else options.manifestPath = DEFAULT_MANIFEST;
    } else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--offline") options.offline = true;
    else if (arg === "--fixture") {
      const next = argv[++index];
      if (!next || next.startsWith("--")) throw new Error("--fixture requiere una ruta");
      options.fixturePath = path.resolve(process.cwd(), next);
      options.offline = true;
    } else if (arg === "--allow-partial") options.allowPartial = true;
    else if (arg === "--max-drop-ratio") {
      const value = Number(argv[++index]);
      if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("--max-drop-ratio debe estar entre 0 y 1");
      options.maxDropRatio = value;
    } else throw new Error(`argumento no reconocido: ${arg}`);
  }
  return options;
}

async function readFixture(file: string): Promise<{ body: string; response: Response }> {
  const body = await readFile(file, "utf8");
  return { body, response: new Response(body, { status: 200, headers: { "content-type": "application/json" } }) };
}

async function fetchProducts(options: CliOptions): Promise<{ source: ProductsCatalogSource; manifest: SourceManifest }> {
  const fetched = options.offline
    ? await readFixture(options.fixturePath)
    : await fetchSourceJson("products_catalog", PRODUCTS_CATALOG_URL, { timeoutMs: 30_000, retries: 3, retryDelayMs: 300 });
  const contentType = fetched.response.headers.get("content-type");
  if (!contentType || !/^application\/json(?:\s*;|$)/i.test(contentType)) throw new Error("products_catalog content-type is not application/json");
  const source = parseProductsCatalog(fetched.body);
  const manifest = createManifest(
    "products_catalog",
    options.offline ? `fixture://${path.basename(options.fixturePath)}` : PRODUCTS_CATALOG_URL,
    fetched.body,
    fetched.response,
    source,
  );
  if (contieneIdentidadSensible(manifest)) throw new Error("source manifest contains a sensitive identity key");
  return { source, manifest };
}

async function writeManifest(file: string, manifest: SourceManifest): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify({ generated_at: new Date().toISOString(), sources: [manifest] }, null, 2)}\n`, "utf8");
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const { source, manifest } = await fetchProducts(options);
  const catalog = canonicalizeCatalog(source);
  const sourceSnapshotId = `products_catalog:${manifest.sha256}`;
  console.log(`[PASS] canonicalized ${catalog.source_products} products/${catalog.source_variants} variants -> ${catalog.products.length} products/${catalog.products.reduce((n, p) => n + p.variants.length, 0)} variants; rejected ${catalog.rejections.length}`);

  if (options.manifestPath) {
    await writeManifest(options.manifestPath, manifest);
    console.log(`[PASS] safe manifest written: ${path.relative(process.cwd(), options.manifestPath)}`);
  }
  if (options.dryRun) return;

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL no está configurada; use --dry-run para validar sin publicar");
  const pool = new Pool({ connectionString: url });
  try {
    const result = await persistStagedCatalog(pool, catalog, {
      sourceSnapshotId,
      manifest,
      allowPartial: options.allowPartial,
      maxDropRatio: options.maxDropRatio,
    });
    console.log(`[PASS] published ${result.publishedProducts} products/${result.publishedVariants} variants; rejected ${result.rejectedRecords}; deleted ${result.deletedProducts}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`[FAIL] CDN catalog import: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
});
