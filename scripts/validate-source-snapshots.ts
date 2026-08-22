import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ZodError } from "zod";
import {
  contieneIdentidadSensible,
  type SourceKind,
  summarizeSource,
} from "../src/lib/rag/sources/contracts";
import {
  createManifest,
  fetchSourceJson,
  ORDER_DATA_URL,
  parseByKind,
  PRODUCTS_CATALOG_URL,
  type SourceManifest,
} from "../src/lib/rag/sources/fetch";

for (const archivo of [".env.local", ".env"]) {
  if (existsSync(archivo)) process.loadEnvFile(archivo);
}

const DEFAULT_FIXTURES = path.resolve(process.cwd(), "eval", "fixtures");

type CliOptions = {
  offline: boolean;
  useFixtures: boolean;
  fixturesDir: string;
  urls: string[];
  manifestPath: string | null;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { offline: false, useFixtures: false, fixturesDir: DEFAULT_FIXTURES, urls: [], manifestPath: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--offline") {
      options.offline = true;
      options.useFixtures = true;
      continue;
    }
    if (arg === "--fixtures") {
      options.useFixtures = true;
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) options.fixturesDir = path.resolve(process.cwd(), next), i++;
      continue;
    }
    if (arg === "--url") {
      const next = argv[i + 1];
      // `--url` sin argumento es un alias explícito para las dos URLs
      // versionadas por defecto. Esto permite un comando estable en runbooks:
      // `tsx scripts/validate-source-snapshots.ts --url`.
      if (!next || next.startsWith("--")) continue;
      i++;
      options.urls.push(next);
      continue;
    }
    if (arg === "--manifest") {
      const next = argv[++i];
      if (!next || next.startsWith("--")) throw new Error("--manifest requiere una ruta");
      options.manifestPath = path.resolve(process.cwd(), next);
      continue;
    }
    throw new Error(`argumento no reconocido: ${arg}`);
  }
  if (options.urls.length > 2) throw new Error("se permiten como máximo dos --url (productos y órdenes)");
  return options;
}

function classifyUrl(url: string, index: number): SourceKind {
  if (/order_data/i.test(url)) return "order_data";
  if (/products_catalog/i.test(url)) return "products_catalog";
  return index === 0 ? "products_catalog" : "order_data";
}

function fixtureName(kind: SourceKind): string {
  return kind === "products_catalog" ? "products_catalog.fixture.json" : "order_data.fixture.json";
}

function issueSummary(error: unknown): string {
  if (!(error instanceof ZodError)) return "invalid JSON or source contract";
  const paths = error.issues.slice(0, 8).map((issue) => issue.path.join(".") || "$");
  return `contract issues at ${paths.join(", ")}${error.issues.length > 8 ? " (more omitted)" : ""}`;
}

function jsonContentType(contentType: string | null): boolean {
  return Boolean(contentType && /^application\/json(?:\s*;|$)/i.test(contentType));
}

const EXPECTED_LIVE_COUNTS: Record<SourceKind, ReturnType<typeof summarizeSource>> = {
  products_catalog: { products: 3297, variants: 6136, activeProducts: 1491, draftProducts: 1806, nonPositivePriceVariants: 278 },
  order_data: { orders: 200, lineItems: 1855, uniqueOrderSkus: 897 },
};

function assertExpectedLiveCounts(kind: SourceKind, manifest: SourceManifest): void {
  const expected = EXPECTED_LIVE_COUNTS[kind];
  for (const [key, value] of Object.entries(expected)) {
    if (manifest.counts[key as keyof typeof expected] !== value) {
      throw new Error(`current ${kind} count changed at ${key}; expected ${value}, observed ${manifest.counts[key as keyof typeof expected]}`);
    }
  }
}

async function readFixtureBody(kind: SourceKind, fixturesDir: string): Promise<{ body: string; response: Response }> {
  const body = await readFile(path.join(fixturesDir, fixtureName(kind)), "utf8");
  return { body, response: new Response(body, { status: 200, headers: { "content-type": "application/json" } }) };
}

async function loadOne(kind: SourceKind, url: string, options: CliOptions, index: number): Promise<SourceManifest> {
  const fixtureMode = options.useFixtures;
  const fetched = fixtureMode
    ? await readFixtureBody(kind, options.fixturesDir)
    : await fetchSourceJson(kind, url, { timeoutMs: 30_000, retries: 3, retryDelayMs: 300 });

  if (!jsonContentType(fetched.response.headers.get("content-type"))) {
    throw new Error(`${kind} content-type is not application/json`);
  }

  let parsed: ReturnType<typeof parseByKind>;
  try {
    parsed = parseByKind(kind, fetched.body);
  } catch (error) {
    throw new Error(`${kind} ${issueSummary(error)}`);
  }

  const manifest = createManifest(kind, fixtureMode ? `fixture://${fixtureName(kind)}` : url, fetched.body, fetched.response, parsed);
  if (contieneIdentidadSensible(manifest)) throw new Error(`${kind} manifest contains a sensitive identity key`);
  if (!fixtureMode && options.urls.length === 0) assertExpectedLiveCounts(kind, manifest);
  console.log(`[PASS] ${kind} contract — ${JSON.stringify(manifest.counts)} — ${fixtureMode ? "fixtures" : "remote"}`);
  void index;
  return manifest;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const urls = options.urls.length ? options.urls : [PRODUCTS_CATALOG_URL, ORDER_DATA_URL];
  const kinds = urls.map(classifyUrl);
  if (new Set(kinds).size !== 2) throw new Error("se requieren una URL de products_catalog y una de order_data");

  const manifests = await Promise.all(kinds.map((kind, index) => loadOne(kind, urls[index], options, index)));
  const output = { generated_at: new Date().toISOString(), sources: manifests };
  if (contieneIdentidadSensible(output)) throw new Error("persistible manifest contains a sensitive identity key");

  if (options.manifestPath) {
    await mkdir(path.dirname(options.manifestPath), { recursive: true });
    await writeFile(options.manifestPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
    console.log(`[PASS] safe manifest written: ${path.relative(process.cwd(), options.manifestPath)}`);
  }
  console.log(`[PASS] source validation complete — ${options.offline ? "offline" : "network"}; raw bodies were not persisted`);
}

main().catch((error) => {
  console.error(`[FAIL] source validation: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
});
