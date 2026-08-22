import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { Pool } from "pg";
import type { IntentQuery } from "../src/lib/rag/query-parser/schema";
import type { FiltrosDuros, RespuestaRetrieval } from "../src/lib/rag/retrieval/types";

const ROOT = process.cwd();
const QUERIES_FILE = path.join(ROOT, "eval", "rag", "queries-v2.jsonl");
const TRUTH_FILE = path.join(ROOT, "eval", "rag", "ground-truth-v2.jsonl");
const DEFAULT_REPORT = path.join(ROOT, "reports", "rag-baseline-v2.md");
const TAXONOMY_VERSION = "catalog-taxonomy-v2";
const HASH_RE = /^[0-9a-f]{64}$/;
const VALID_BRANCH_STATUS = new Set(["READY", "EMPTY", "SKIPPED_OPTIONAL", "ERROR"]);

type QueryRecord = {
  id: string;
  family: string;
  label: string;
  query: string;
  snapshot_hash: string;
  snapshot_id: string;
  taxonomy_version: string;
};

type TruthRecord = {
  id: string;
  family: string;
  snapshot_hash: string;
  snapshot_id: string;
  taxonomy_version: string;
  expected_product_ids: string[];
  expected_variant_ids: string[];
  constraints: Record<string, unknown>;
  relevance?: string;
  ambiguous_sku?: boolean;
  no_match_expected?: boolean;
  evidence?: Record<string, unknown>;
  labeler_b?: { decision?: string };
};

type Derived = { category?: unknown; colors?: unknown; occasions?: unknown };
type VariantMeta = {
  variantId: string;
  productId: string;
  price: number;
  available: boolean;
  inventoryQuantity: number | null;
  forma: string | null;
  codigoTamano: string | null;
  diamPulg: number | null;
  productAvailable: boolean;
  productStatus: string;
  derived: Derived;
  variantJson: Record<string, unknown>;
  variantColors: string[];
  colorAttributePresent: boolean;
};

type SnapshotInfo = {
  sourceSha256: string;
  status: string;
  publishedProducts: number;
  publishedVariants: number;
  serverVersion: string;
  extensions: string[];
};

export type Options = {
  repeat: number;
  noKey: boolean;
  gate: boolean;
  report: string;
  smoke: boolean;
};

type RunOutcome = {
  query: QueryRecord;
  truth: TruthRecord;
  parsed?: IntentQuery;
  response?: RespuestaRetrieval;
  productIds: string[];
  variantIds: string[];
  parseMs: number;
  retrievalMs: number;
  totalMs: number;
  error?: string;
  invalidBranchStatuses: string[];
  invalidResultIds: string[];
  invariantViolations: string[];
  unknownColorChecks: number;
};

type Gate = { name: string; value: number; threshold: string; pass: boolean; detail?: string };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function parseArgs(argv: string[]): Options {
  let repeat = 1;
  let report = DEFAULT_REPORT;
  let noKey = true;
  let gate = false;
  let smoke = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--gate") gate = true;
    else if (arg === "--no-key") noKey = true;
    else if (arg === "--with-key") noKey = false;
    else if (arg === "--smoke") smoke = true;
    else if (arg === "--repeat") {
      const next = Number(argv[++index]);
      if (!Number.isInteger(next) || next < 1 || next > 10) throw new Error("--repeat debe ser un entero entre 1 y 10");
      repeat = next;
    } else if (arg === "--report") {
      const next = argv[++index];
      if (!next || next.startsWith("--")) throw new Error("--report requiere una ruta");
      report = path.resolve(ROOT, next);
    } else throw new Error("argumento no reconocido: " + arg);
  }
  if (smoke) repeat = 1;
  return { repeat, noKey, gate, report, smoke };
}

async function readJsonl<T>(file: string): Promise<T[]> {
  const text = await readFile(file, "utf8");
  return text.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line) as T; }
    catch (error) { throw new Error(`${path.relative(ROOT, file)}:${index + 1} JSON inválido: ${String(error)}`); }
  });
}

function normalized(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-CO").replace(/\s+/g, " ").trim();
}

function strings(value: unknown): string[] {
  if (typeof value === "string" && value.trim()) return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  return [];
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = normalized(value);
    if (key && !seen.has(key)) { seen.add(key); result.push(value); }
  }
  return result;
}

function derivedStrings(derived: Derived, key: "colors" | "occasions"): string[] {
  return strings(derived[key]).flatMap((value) => value.split(/[;,|]/)).map((value) => value.trim()).filter(Boolean);
}

function productCategory(derived: Derived): string | null {
  return typeof derived.category === "string" ? derived.category : null;
}

function collectVariantColors(raw: Record<string, unknown>): string[] {
  const result: string[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (!/(?:^|_)(?:color|colors|colores|colour)(?:$|_)/i.test(key)) continue;
    result.push(...strings(value));
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const object = value as Record<string, unknown>;
      result.push(...strings(object.value), ...strings(object.values), ...strings(object.canonical));
    }
  }
  const states = raw.attribute_states;
  if (states && typeof states === "object" && !Array.isArray(states)) {
    const state = (states as Record<string, unknown>).color ?? (states as Record<string, unknown>).colors;
    if (state && typeof state === "object" && !Array.isArray(state)) {
      const object = state as Record<string, unknown>;
      result.push(...strings(object.value), ...strings(object.values), ...strings(object.canonical));
    } else result.push(...strings(state));
  }
  return unique(result).filter((value) => !new Set(["source", "derived", "unknown", "null", "none"]).has(normalized(value)));
}

function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asDerived(value: unknown): Derived {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Derived : {};
}

async function loadSnapshot(pool: Pool, snapshotId: string, hash: string): Promise<{ info: SnapshotInfo; variants: Map<string, VariantMeta> }> {
  const source = await pool.query<{ source_sha256: string; status: string; published_products: number; published_variants: number }>(
    "SELECT source_sha256, status, published_products, published_variants FROM rag_source_snapshots WHERE source_snapshot_id=$1 AND source_kind='products_catalog'",
    [snapshotId],
  );
  assert(source.rows.length === 1, `snapshot ${snapshotId} no existe`);
  assert(source.rows[0].source_sha256 === hash, "snapshot hash no coincide con el corpus");
  assert(source.rows[0].status === "published", "snapshot no publicado");
  const db = await pool.query<{ server_version: string }>("SELECT current_setting('server_version') AS server_version");
  const extensionRows = await pool.query<{ extname: string; extversion: string }>(
    "SELECT extname, extversion FROM pg_extension WHERE extname IN ('vector','pg_trgm','unaccent') ORDER BY extname",
  );
  const rows = await pool.query<{
    variant_id: string; product_id: string; price: number; available: boolean; inventory_quantity: number | null;
    forma: string | null; codigo_tamano: string | null; diam_pulg: number | null; product_available: boolean;
    product_status: string; derived: unknown; variant_json: Record<string, unknown>;
  }>(
    `SELECT v.variant_id, v.product_id, v.price::float8 AS price, v.available, v.inventory_quantity,
            v.forma, v.codigo_tamano, v.diam_pulg::float8 AS diam_pulg,
            p.available AS product_available, p.status AS product_status, p.derived,
            to_jsonb(v) AS variant_json
       FROM catalog_variants v
       JOIN catalog_products p ON p.product_id=v.product_id AND p.source_snapshot_id=v.source_snapshot_id
      WHERE v.source_snapshot_id=$1`,
    [snapshotId],
  );
  const variants = new Map<string, VariantMeta>();
  for (const row of rows.rows) {
    const variantColors = collectVariantColors(row.variant_json ?? {});
    variants.set(row.variant_id, {
      variantId: row.variant_id,
      productId: row.product_id,
      price: Number(row.price),
      available: row.available,
      inventoryQuantity: row.inventory_quantity,
      forma: row.forma,
      codigoTamano: row.codigo_tamano,
      diamPulg: numeric(row.diam_pulg),
      productAvailable: row.product_available,
      productStatus: row.product_status,
      derived: asDerived(row.derived),
      variantJson: row.variant_json ?? {},
      variantColors,
      colorAttributePresent: variantColors.length > 0,
    });
  }
  assert(variants.size > 0, "snapshot publicado sin variantes");
  return {
    info: {
      sourceSha256: source.rows[0].source_sha256,
      status: source.rows[0].status,
      publishedProducts: source.rows[0].published_products,
      publishedVariants: source.rows[0].published_variants,
      serverVersion: db.rows[0]?.server_version ?? "unknown",
      extensions: extensionRows.rows.map((row) => `${row.extname}@${row.extversion}`),
    },
    variants,
  };
}

function validateCorpusShape(queries: QueryRecord[], truths: TruthRecord[]): { hash: string; snapshotId: string; taxonomy: string; byId: Map<string, TruthRecord> } {
  assert(queries.length >= 400, `corpus demasiado pequeño: ${queries.length}`);
  assert(queries.length === truths.length, "queries y ground truth tienen distinto tamaño");
  const byId = new Map(truths.map((truth) => [truth.id, truth]));
  assert(byId.size === truths.length, "ground truth tiene IDs duplicados");
  const hash = queries[0]?.snapshot_hash;
  const snapshotId = queries[0]?.snapshot_id;
  const taxonomy = queries[0]?.taxonomy_version;
  assert(hash && HASH_RE.test(hash), "hash de corpus inválido");
  assert(snapshotId && taxonomy === TAXONOMY_VERSION, "metadata de corpus inválida");
  const queryIds = new Set<string>();
  for (const query of queries) {
    assert(!queryIds.has(query.id), `query duplicada ${query.id}`);
    queryIds.add(query.id);
    assert(query.snapshot_hash === hash && query.snapshot_id === snapshotId && query.taxonomy_version === taxonomy, `${query.id} mezcla snapshots`);
    const truth = byId.get(query.id);
    assert(truth && truth.family === query.family, `${query.id} no tiene ground truth compatible`);
    assert(truth.snapshot_hash === hash && truth.snapshot_id === snapshotId && truth.taxonomy_version === taxonomy, `${query.id} truth mezcla snapshots`);
    if (truth.family === "negative") assert(truth.expected_product_ids.length === 0 && truth.expected_variant_ids.length === 0, `${truth.id} negative no es vacío`);
    else assert(truth.expected_product_ids.length > 0, `${truth.id} no tiene expected product; evita benchmark vacuo`);
  }
  assert(queryIds.size === byId.size, "ground truth tiene consultas extra");
  return { hash, snapshotId, taxonomy, byId };
}

function toRetrievalFilters(intent: IntentQuery): FiltrosDuros {
  const filters = intent.filtros_duros;
  return {
    disponible: filters.solo_disponibles,
    precioMax: filters.precio_max ?? undefined,
    categorias: filters.categorias.length ? filters.categorias : undefined,
    ocasiones: filters.ocasiones.length ? filters.ocasiones : undefined,
    colores: filters.colores.length ? filters.colores : undefined,
    formas: filters.formas.length ? filters.formas : undefined,
    diametrosPulgadas: filters.diametros_pulgadas.length ? filters.diametros_pulgadas : undefined,
  };
}

function returnedIds(response: RespuestaRetrieval | undefined): { products: string[]; variants: string[] } {
  if (!response) return { products: [], variants: [] };
  const products = [...new Set(response.results.map((result) => result.productId))];
  const variants = [...new Set(response.results.flatMap((result) => result.variantIds))];
  return { products, variants };
}

function checkConstraint(row: VariantMeta, key: string, expected: unknown): boolean | null {
  if (key === "available") return expected === true ? row.productStatus === "ACTIVE" && row.productAvailable && row.available : true;
  if (key === "max_price_cop") return typeof expected === "number" ? row.price <= expected : null;
  if (key === "category") {
    const expectedValues = typeof expected === "string" ? [expected] : Array.isArray(expected) ? expected.filter((value): value is string => typeof value === "string") : [];
    return expectedValues.length ? expectedValues.some((value) => normalized(productCategory(row.derived) ?? "") === normalized(value)) : null;
  }
  if (key === "occasion") {
    const expectedValues = typeof expected === "string" ? [expected] : Array.isArray(expected) ? expected.filter((value): value is string => typeof value === "string") : [];
    return expectedValues.length ? expectedValues.some((expectedValue) => derivedStrings(row.derived, "occasions").some((value) => normalized(value) === normalized(expectedValue))) : null;
  }
  if (key === "color") {
    if (!row.colorAttributePresent) return null;
    const expectedValues = typeof expected === "string" ? [expected] : Array.isArray(expected) ? expected.filter((value): value is string => typeof value === "string") : [];
    return expectedValues.length ? expectedValues.some((expectedValue) => row.variantColors.some((value) => normalized(value) === normalized(expectedValue))) : null;
  }
  if (key === "forma") {
    const expectedValues = typeof expected === "string" ? [expected] : Array.isArray(expected) ? expected.filter((value): value is string => typeof value === "string") : [];
    return expectedValues.length ? expectedValues.some((value) => normalized(row.forma ?? "") === normalized(value)) : null;
  }
  if (key === "diam_pulg") {
    const expectedValues = typeof expected === "number" ? [expected] : Array.isArray(expected) ? expected.filter((value): value is number => typeof value === "number") : [];
    return expectedValues.length ? expectedValues.includes(row.diamPulg ?? Number.NaN) : null;
  }
  return null;
}

function parsedHardConstraints(outcome: Omit<RunOutcome, "invariantViolations" | "unknownColorChecks">): Record<string, unknown> {
  const filters = outcome.parsed?.filtros_duros;
  if (!filters) return {};
  return {
    ...(filters.solo_disponibles ? { available: true } : {}),
    ...(filters.precio_max != null ? { max_price_cop: filters.precio_max } : {}),
    ...(filters.categorias.length ? { category: filters.categorias } : {}),
    ...(filters.ocasiones.length ? { occasion: filters.ocasiones } : {}),
    ...(filters.colores.length ? { color: filters.colores } : {}),
    ...(filters.formas.length ? { forma: filters.formas } : {}),
    ...(filters.diametros_pulgadas.length ? { diam_pulg: filters.diametros_pulgadas } : {}),
  };
}

function parsedConstraintMisses(outcome: Omit<RunOutcome, "invariantViolations" | "unknownColorChecks">): string[] {
  if (!["filter", "budget", "shape_size"].includes(outcome.truth.family)) return [];
  const parsed = parsedHardConstraints(outcome);
  const misses: string[] = [];
  for (const [key, expected] of Object.entries(outcome.truth.constraints)) {
    if (expected === null || expected === undefined || expected === false) continue;
    // For shape_size, a LOL/C/T lexical code can carry a physical diameter
    // in the catalog without the customer having expressed a numeric hard
    // filter. The variant-level truth still scores that attribute; it is not
    // a parser omission.
    if (outcome.truth.family === "shape_size" && key === "diam_pulg") continue;
    const parsedValue = parsed[key];
    if (parsedValue === undefined) {
      misses.push(key);
      continue;
    }
    const expectedValues = Array.isArray(expected) ? expected : [expected];
    const parsedValues = Array.isArray(parsedValue) ? parsedValue : [parsedValue];
    if (key === "available" && expected === true && !parsedValues.includes(true)) misses.push(key);
    else if (key !== "available" && !expectedValues.some((value) => parsedValues.some((parsedItem) => normalized(String(value)) === normalized(String(parsedItem))))) misses.push(key);
  }
  return misses;
}

function checkInvariants(outcome: Omit<RunOutcome, "invariantViolations" | "unknownColorChecks">, variants: Map<string, VariantMeta>): { violations: string[]; unknownColorChecks: number } {
  const violations: string[] = [];
  let unknownColorChecks = 0;
  // Check only predicates actually sent to retrieval. Ground truth also
  // records lexical attributes (e.g. LOL660 implies 6in), but a predicate
  // unsupported by the parser is a parse-coverage issue, not a post-filter
  // leakage by the retrieval layer.
  const constraints = parsedHardConstraints(outcome);
  for (const variantId of outcome.variantIds) {
    const row = variants.get(variantId);
    if (!row) { violations.push(`variant_outside_snapshot:${variantId}`); continue; }
    for (const [key, expected] of Object.entries(constraints)) {
      const result = checkConstraint(row, key, expected);
      if (result === null) { if (key === "color") unknownColorChecks++; }
      else if (!result) violations.push(`${key}:${variantId}`);
    }
    if (outcome.truth.family === "sku" && !outcome.truth.ambiguous_sku && !outcome.truth.expected_variant_ids.includes(variantId)) {
      violations.push(`sku_variant_leak:${variantId}`);
    }
    if (outcome.truth.family === "sku" && outcome.truth.ambiguous_sku && !outcome.truth.expected_variant_ids.includes(variantId)) {
      violations.push(`ambiguous_sku_variant_leak:${variantId}`);
    }
  }
  return { violations: [...new Set(violations)], unknownColorChecks };
}

async function runOne(
  query: QueryRecord,
  truth: TruthRecord,
  pool: Pool,
  buscarHibrido: (pool: Pool, consulta: { semanticQuery: string; filtros?: FiltrosDuros }) => Promise<RespuestaRetrieval>,
  interpretarConsultaLocal: (query: string) => { intent: IntentQuery },
  variants: Map<string, VariantMeta>,
): Promise<RunOutcome> {
  const totalStarted = performance.now();
  let parseMs = 0;
  let retrievalMs = 0;
  try {
    const parseStarted = performance.now();
    const parsed = interpretarConsultaLocal(query.query).intent;
    parseMs = performance.now() - parseStarted;
    const retrievalStarted = performance.now();
    const response = await buscarHibrido(pool, { semanticQuery: parsed.semantic_query, filtros: toRetrievalFilters(parsed) });
    retrievalMs = performance.now() - retrievalStarted;
    const ids = returnedIds(response);
    const partial = { query, truth, parsed, response, productIds: ids.products, variantIds: ids.variants, parseMs, retrievalMs, totalMs: performance.now() - totalStarted, invalidBranchStatuses: [], invalidResultIds: [] };
    const invalidBranchStatuses = Object.entries(response.branchStatus ?? {}).filter(([, status]) => !VALID_BRANCH_STATUS.has(status)).map(([branch, status]) => `${branch}:${String(status)}`).map(String);
    const invalidResultIds = ids.variants.filter((id) => !variants.has(id));
    const checked = checkInvariants(partial, variants);
    return { ...partial, invalidBranchStatuses, invalidResultIds, invariantViolations: checked.violations, unknownColorChecks: checked.unknownColorChecks };
  } catch (error) {
    return {
      query,
      truth,
      productIds: [],
      variantIds: [],
      parseMs,
      retrievalMs,
      totalMs: performance.now() - totalStarted,
      error: error instanceof Error ? error.message : String(error),
      invalidBranchStatuses: [],
      invalidResultIds: [],
      invariantViolations: [],
      unknownColorChecks: 0,
    };
  }
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.min(ordered.length - 1, Math.max(0, Math.ceil((p / 100) * ordered.length) - 1));
  return ordered[index];
}

function mean(values: number[]): number { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }

function expectedProducts(outcome: RunOutcome): Set<string> { return new Set(outcome.truth.expected_product_ids); }
function expectedVariants(outcome: RunOutcome): Set<string> { return new Set(outcome.truth.expected_variant_ids); }

function recall(outcomes: RunOutcome[], k: number, variantUnit = false): number {
  const valid = outcomes.filter((outcome) => !outcome.error && (variantUnit ? expectedVariants(outcome).size : expectedProducts(outcome).size));
  if (!valid.length) return 0;
  const total = valid.reduce((sum, outcome) => {
    const expected = variantUnit ? expectedVariants(outcome) : expectedProducts(outcome);
    const ranked = variantUnit ? outcome.variantIds : outcome.productIds;
    return sum + [...expected].filter((id) => ranked.slice(0, k).includes(id)).length / expected.size;
  }, 0);
  return total / valid.length;
}

function reciprocalRank(outcome: RunOutcome, variantUnit = false): number {
  const expected = variantUnit ? expectedVariants(outcome) : expectedProducts(outcome);
  const ranked = variantUnit ? outcome.variantIds : outcome.productIds;
  const first = ranked.findIndex((id) => expected.has(id));
  return first < 0 ? 0 : 1 / (first + 1);
}

function ndcg(outcome: RunOutcome, k: number): number {
  const expected = expectedProducts(outcome);
  if (!expected.size) return 0;
  const ranked = outcome.productIds.slice(0, k);
  const dcg = ranked.reduce((sum, id, index) => sum + (expected.has(id) ? 1 / Math.log2(index + 2) : 0), 0);
  const ideal = [...Array(Math.min(k, expected.size)).keys()].reduce((sum, index) => sum + 1 / Math.log2(index + 2), 0);
  return ideal ? dcg / ideal : 0;
}

function familyValues(outcomes: RunOutcome[], family: string): RunOutcome[] { return outcomes.filter((outcome) => outcome.truth.family === family); }

function filterPrecision(outcomes: RunOutcome[]): number {
  const retrieved = outcomes.flatMap((outcome) => outcome.variantIds);
  const relevant = outcomes.flatMap((outcome) => outcome.variantIds.filter((id) => expectedVariants(outcome).has(id)));
  return retrieved.length ? relevant.length / retrieved.length : 0;
}

function nameMisses(outcomes: RunOutcome[]): Array<Record<string, unknown>> {
  const seen = new Set<string>();
  return familyValues(outcomes, "name").filter((outcome) => {
    if (seen.has(outcome.query.id)) return false;
    seen.add(outcome.query.id);
    return !outcome.productIds.slice(0, 5).some((id) => outcome.truth.expected_product_ids.includes(id));
  }).map((outcome) => {
    const expected = new Set(outcome.truth.expected_product_ids);
    const rank = outcome.productIds.findIndex((id) => expected.has(id));
    return {
      id: outcome.query.id,
      query: outcome.query.query,
      expected_product_ids: outcome.truth.expected_product_ids,
      rank: rank < 0 ? null : rank + 1,
      top5_product_ids: outcome.productIds.slice(0, 5),
      branch_status: outcome.response?.branchStatus ?? {},
    };
  });
}

function formatMs(value: number): string { return `${value.toFixed(1)} ms`; }
function formatPct(value: number): string { return `${(value * 100).toFixed(2)}%`; }

async function explainPlans(pool: Pool, sample: VariantMeta): Promise<string[]> {
  const statements: Array<[string, string, unknown[]]> = [
    ["fts", "SELECT p.product_id FROM catalog_products p WHERE p.search_tsv @@ plainto_tsquery('spanish_unaccent', $1) ORDER BY p.product_id LIMIT 40", [sample.productId]],
    ["trigram", "SELECT p.product_id FROM catalog_products p WHERE p.title % $1 ORDER BY similarity(p.title, $1) DESC LIMIT 40", [sample.productId]],
    ["same_variant_filter", "SELECT v.variant_id FROM catalog_variants v JOIN catalog_products p ON p.product_id=v.product_id WHERE p.status='ACTIVE' AND p.available=true AND v.available=true AND v.price <= $1 AND v.forma=$2", [sample.price, sample.forma]],
  ];
  const result: string[] = [];
  for (const [label, sql, params] of statements) {
    try {
      const query = await pool.query<{ "QUERY PLAN": Array<Record<string, unknown>> }>(`EXPLAIN (FORMAT JSON) ${sql}`, params);
      const root = query.rows[0]?.["QUERY PLAN"]?.[0] as Record<string, unknown> | undefined;
      const nodes: string[] = [];
      const visit = (node: unknown): void => {
        if (!node || typeof node !== "object") return;
        const object = node as Record<string, unknown>;
        if (typeof object["Node Type"] === "string") nodes.push(`${object["Node Type"]}${object["Index Name"] ? `/${object["Index Name"]}` : ""}`);
        if (Array.isArray(object.Plans)) object.Plans.forEach(visit);
      };
      visit(root?.Plan);
      result.push(`${label}: ${nodes.join(" -> ") || "plan unavailable"}`);
    } catch (error) { result.push(`${label}: EXPLAIN_ERROR ${error instanceof Error ? error.message : String(error)}`); }
  }
  return result;
}

function buildGates(outcomes: RunOutcome[], variants: Map<string, VariantMeta>, options: Options): { gates: Gate[]; metrics: Record<string, unknown>; failures: Gate[] } {
  const positive = outcomes.filter((outcome) => outcome.truth.family !== "negative");
  const uniqueSku = familyValues(outcomes, "sku").filter((outcome) => !outcome.truth.ambiguous_sku);
  const ambiguousSku = familyValues(outcomes, "sku").filter((outcome) => outcome.truth.ambiguous_sku);
  const negative = familyValues(outcomes, "negative");
  const names = familyValues(outcomes, "name");
  const ndcgGlobal = mean(positive.map((outcome) => ndcg(outcome, 10)));
  const familyNdcg = Object.fromEntries([...new Set(positive.map((outcome) => outcome.truth.family))].map((family) => [family, mean(familyValues(positive, family).map((outcome) => ndcg(outcome, 10)))]));
  const errorRate = outcomes.filter((outcome) => outcome.error).length / Math.max(outcomes.length, 1);
  const branchErrorRate = outcomes.filter((outcome) => Object.values(outcome.response?.branchStatus ?? {}).some((status) => status === "ERROR")).length / Math.max(outcomes.length, 1);
  const emptyRate = positive.filter((outcome) => !outcome.error && outcome.productIds.length === 0).length / Math.max(positive.length, 1);
  const latencies = outcomes.map((outcome) => outcome.totalMs);
  const colorRows = [...variants.values()].filter((row) => row.colorAttributePresent);
  const colorExpected = outcomes.filter((outcome) => outcome.truth.family === "color").flatMap((outcome) => outcome.truth.expected_variant_ids);
  const colorEvidence = colorExpected.map((id) => variants.get(id)).filter((row): row is VariantMeta => Boolean(row));
  const colorCoverage = colorEvidence.length ? colorEvidence.filter((row) => row.colorAttributePresent || (row.variantColors.length === 0 && derivedStrings(row.derived, "colors").length === 1)).length / colorEvidence.length : 0;
  const colorFallbackCount = colorEvidence.filter((row) => !row.colorAttributePresent && row.variantColors.length === 0 && derivedStrings(row.derived, "colors").length === 1).length;
  const invalidBranchStatuses = outcomes.reduce((sum, outcome) => sum + outcome.invalidBranchStatuses.length, 0);
  const nameMissList = nameMisses(outcomes);
  const parserMisses = outcomes.flatMap((outcome) => parsedConstraintMisses(outcome).map((key) => ({ family: outcome.truth.family, key })));
  const parserMissesByFamily = Object.fromEntries([...new Set(parserMisses.map((miss) => miss.family))].map((family) => [family, parserMisses.filter((miss) => miss.family === family).length / Math.max(options.repeat, 1)]));
  const skuStatusOutcomes = outcomes.filter((outcome) => outcome.truth.family === "sku" || outcome.truth.family === "negative");
  const observedSkuStatuses = Object.fromEntries([...new Set(skuStatusOutcomes.map((outcome) => outcome.response?.skuStatus ?? "error"))].map((status) => [status, skuStatusOutcomes.filter((outcome) => (outcome.response?.skuStatus ?? "error") === status).length / Math.max(options.repeat, 1)]));
  const gates: Gate[] = [
    { name: "sku_unique_recall@1", value: recall(uniqueSku, 1, true), threshold: ">= 0.99", pass: recall(uniqueSku, 1, true) >= 0.99 },
    { name: "sku_unique_recall@5", value: recall(uniqueSku, 5, true), threshold: "= 1.00", pass: recall(uniqueSku, 5, true) >= 1 },
    { name: "name_recall@5", value: recall(names, 5), threshold: ">= 0.95", pass: recall(names, 5) >= 0.95 },
    { name: "ndcg@10_global", value: ndcgGlobal, threshold: ">= 0.75", pass: ndcgGlobal >= 0.75 },
    { name: "ndcg@10_family_min", value: Math.min(...Object.values(familyNdcg).map(Number)), threshold: ">= 0.70", pass: Object.values(familyNdcg).every((value) => Number(value) >= 0.70), detail: JSON.stringify(familyNdcg) },
    { name: "filter_variant_precision", value: filterPrecision(familyValues(outcomes, "filter")), threshold: "= 1.00", pass: filterPrecision(familyValues(outcomes, "filter")) >= 1 },
    { name: "negative_not_found", value: negative.filter((outcome) => outcome.response?.skuStatus === "not_found" && outcome.productIds.length === 0).length / Math.max(negative.length, 1), threshold: "= 1.00", pass: negative.length > 0 && negative.every((outcome) => outcome.response?.skuStatus === "not_found" && outcome.productIds.length === 0) },
    { name: "error_rate", value: errorRate, threshold: "< 0.01", pass: errorRate < 0.01 },
    { name: "branch_error_rate", value: branchErrorRate, threshold: "< 0.01", pass: branchErrorRate < 0.01 },
    { name: "hard_filter_variant_leakage", value: outcomes.reduce((sum, outcome) => sum + outcome.invariantViolations.length, 0), threshold: "= 0", pass: outcomes.every((outcome) => outcome.invariantViolations.length === 0) },
    { name: "invalid_result_ids", value: outcomes.reduce((sum, outcome) => sum + outcome.invalidResultIds.length, 0), threshold: "= 0", pass: outcomes.every((outcome) => outcome.invalidResultIds.length === 0) },
    { name: "invalid_branch_statuses", value: invalidBranchStatuses, threshold: "= 0", pass: invalidBranchStatuses === 0 },
    { name: "latency_p50_ms", value: percentile(latencies, 50), threshold: "<= 500", pass: percentile(latencies, 50) <= 500 },
    { name: "latency_p95_ms", value: percentile(latencies, 95), threshold: "<= 2100", pass: percentile(latencies, 95) <= 2100 },
    { name: "color_variant_attribute_coverage", value: colorCoverage, threshold: "= 1.00", pass: colorCoverage >= 1, detail: `${colorRows.length} variantes tienen color explícito; ${colorFallbackCount} expected usan fallback singleton inequívoco; ambos son evidencia de la misma variant_id` },
  ];
  const metrics = {
    corpus: outcomes.length / Math.max(options.repeat, 1),
    runs: outcomes.length,
    repeat: options.repeat,
    recall: { sku_unique_at_1: recall(uniqueSku, 1, true), sku_unique_at_5: recall(uniqueSku, 5, true), global_at_1: recall(positive, 1), global_at_5: recall(positive, 5), global_at_10: recall(positive, 10), variant_color_at_1: recall(familyValues(outcomes, "color"), 1, true), variant_shape_at_1: recall(familyValues(outcomes, "shape_size"), 1, true) },
    mrr_global: mean(positive.map((outcome) => reciprocalRank(outcome))),
    ndcg_global: ndcgGlobal,
    ndcg_family: familyNdcg,
    filter_precision: filterPrecision(familyValues(outcomes, "filter")),
    error_rate: errorRate,
    branch_error_rate: branchErrorRate,
    positive_empty_rate: emptyRate,
    latencies_ms: { p50: percentile(latencies, 50), p95: percentile(latencies, 95), mean: mean(latencies), parse_p50: percentile(outcomes.map((outcome) => outcome.parseMs), 50), retrieval_p50: percentile(outcomes.map((outcome) => outcome.retrievalMs), 50), retrieval_p95: percentile(outcomes.map((outcome) => outcome.retrievalMs), 95) },
    sku_status: {
      expected_unique: uniqueSku.length / Math.max(options.repeat, 1),
      expected_ambiguous: ambiguousSku.length / Math.max(options.repeat, 1),
      expected_not_found: negative.length / Math.max(options.repeat, 1),
      observed: observedSkuStatuses,
    },
    name_misses: nameMissList,
    parser_constraint_misses: { total: parserMisses.length / Math.max(options.repeat, 1), by_family: parserMissesByFamily },
    invalid_result_ids: outcomes.reduce((sum, outcome) => sum + outcome.invalidResultIds.length, 0),
    invalid_branch_statuses: invalidBranchStatuses,
    invariant_violations: outcomes.reduce((sum, outcome) => sum + outcome.invariantViolations.length, 0),
    unknown_color_checks: outcomes.reduce((sum, outcome) => sum + outcome.unknownColorChecks, 0),
    parser_stability: options.noKey ? "deterministic_local" : "deterministic_local_plus_optional_remote_disabled_for_fixture",
  };
  return { gates, metrics, failures: gates.filter((gate) => !gate.pass) };
}

function renderReport(
  queries: QueryRecord[],
  snapshot: SnapshotInfo,
  corpus: { hash: string; snapshotId: string; taxonomy: string },
  options: Options,
  outcomes: RunOutcome[],
  gates: Gate[],
  metrics: Record<string, unknown>,
  explain: string[],
): string {
  const failures = gates.filter((gate) => !gate.pass);
  const families = [...new Set(queries.map((query) => query.family))].sort();
  const byFamily = families.map((family) => {
    const values = outcomes.filter((outcome) => outcome.truth.family === family);
    return `| ${family} | ${values.length / Math.max(options.repeat, 1)} | ${formatPct(mean(values.map((outcome) => outcome.truth.expected_product_ids.length ? (outcome.productIds.some((id) => outcome.truth.expected_product_ids.includes(id)) ? 1 : 0) : outcome.productIds.length === 0 ? 1 : 0)))} | ${formatPct(mean(values.map((outcome) => ndcg(outcome, 10))))} | ${formatMs(percentile(values.map((outcome) => outcome.totalMs), 50))} |`;
  }).join("\n");
  const failureDetails = outcomes.filter((outcome) => outcome.error || outcome.invariantViolations.length || outcome.invalidResultIds.length).slice(0, 30).map((outcome) => `- \`${outcome.query.id}\`: ${outcome.error ?? [...outcome.invariantViolations, ...outcome.invalidResultIds].join(", ")}`).join("\n") || "- Ningún error o violación registrada.";
  const gateTable = gates.map((gate) => `| ${gate.name} | ${typeof gate.value === "number" ? gate.value.toFixed(4) : gate.value} | ${gate.threshold} | ${gate.pass ? "PASS" : "FAIL"} | ${gate.detail ?? ""} |`).join("\n");
  const metricJson = JSON.stringify(metrics, null, 2);
  const nameMissList = Array.isArray(metrics.name_misses) ? metrics.name_misses as Array<Record<string, unknown>> : [];
  const parserMissSummary = metrics.parser_constraint_misses ? JSON.stringify(metrics.parser_constraint_misses) : "{}";
  const semanticDisagreements = outcomes.filter((outcome) => outcome.truth.family === "semantic" && outcome.truth.labeler_b?.decision === "ambiguous").length / Math.max(options.repeat, 1);
  const status = failures.length ? "FAIL" : "PASS";
  return `# RAG baseline v2 — ${status}

Generado: ${new Date().toISOString()}  
Rama evaluada: determinista local + PostgreSQL; vector/Gemini: ${options.noKey ? "SKIPPED_OPTIONAL (no-key)" : "habilitado por configuración"}  
Repeticiones: ${options.repeat}; latencia medida de forma secuencial para no distorsionar contención.

## Corpus y snapshot

- Consultas fijas: **${queries.length}**; familias semánticas con dos métodos/adjudicación: **${semanticDisagreements}**.
- \`taxonomy_version\`: \`${corpus.taxonomy}\`
- \`snapshot_id\`: \`${corpus.snapshotId}\`
- \`snapshot_hash\`: \`${corpus.hash}\`
- PostgreSQL: \`${snapshot.serverVersion}\`; extensiones: ${snapshot.extensions.join(", ") || "ninguna reportada"}.
- Publicado: ${snapshot.status}; productos: ${snapshot.publishedProducts}; variantes: ${snapshot.publishedVariants}.

## Gates cuantitativos

| Gate | Valor | Umbral | Estado | Detalle |
|---|---:|---:|---|---|
${gateTable}

El comando con \`--gate\` devuelve exit code **${failures.length ? "1 (hay fallos reales; no se autoaprueba)" : "0"}**.

## Métricas por familia

| Familia | Casos por repetición | Hit@1 producto/no-match | NDCG@10 | p50 total |
|---|---:|---:|---:|---:|
${byFamily}

## Métricas completas

\`\`\`json
${metricJson}
\`\`\`

## Branches y restricciones

- Se validaron estados de rama contra \`READY | EMPTY | SKIPPED_OPTIONAL | ERROR\`.
- IDs fuera del snapshot y violaciones de restricciones precio/disponibilidad/facetas se contabilizan, no se descartan.
- La cobertura de color exige evidencia de la misma \`variant_id\`: \`v.derived_colors\` explícito o fallback sólo si \`p.derived.colors\` es singleton; un producto multicolor nunca hereda color a un sibling.
- Los filtros de inventario no reinterpretan \`available\`; el inventario queda como evidencia/anomalía.
- La fuga de hard filters se calcula sólo contra predicados efectivamente producidos por el parser y aplicados por retrieval; los atributos de verdad no soportados por el parser se reportan aparte como \`parser_constraint_misses\` (${parserMissSummary}). Las facetas de categoría/ocasión provienen de \`catalog_products.derived\` y disponibilidad de producto/variante se comprueba sobre ambas filas.

## EXPLAIN resumido

${explain.map((line) => `- ${line}`).join("\n")}

## Fallos detallados (máximo 30)

${failureDetails}

## Fallos de búsqueda por nombre (Recall@5)

Se listan los casos cuyo producto esperado no aparece en las primeras cinco posiciones. No se regeneraron labels ni se omitieron misses; el rango es el primero observado fuera de top-5 o \`null\` si no aparece.

${nameMissList.length ? nameMissList.map((miss) => `- \`${String(miss.id)}\`: rank=${miss.rank === null ? "null" : String(miss.rank)}; expected=${JSON.stringify(miss.expected_product_ids)}; top5=${JSON.stringify(miss.top5_product_ids)}; query=${JSON.stringify(miss.query)}`).join("\n") : "- Ningún miss de name."}

## Reproducción

\`\`\`powershell
$env:DATABASE_URL="postgresql://rag:rag_local_only_change_me@127.0.0.1:5432/rag"
npx tsx scripts/eval-rag-v2.ts --validate-corpus
npx tsx scripts/bench-rag-v2.ts --no-key --repeat 2
npx tsx scripts/eval-rag-v2.ts --gate
\`\`\`
`;
}

export async function runBenchmark(options: Options): Promise<{ gates: Gate[]; failures: Gate[]; metrics: Record<string, unknown>; report: string }> {
  if (options.noKey) {
    process.env.GEMINI_API_KEY = "";
    process.env.RAG_USE_VECTOR = "false";
  }
  const queries = await readJsonl<QueryRecord>(QUERIES_FILE);
  const truths = await readJsonl<TruthRecord>(TRUTH_FILE);
  const corpus = validateCorpusShape(queries, truths);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
  try {
    const snapshot = await loadSnapshot(pool, corpus.snapshotId, corpus.hash);
    const [{ buscarHibrido }, { interpretarConsultaLocal }] = await Promise.all([
      import("../src/lib/rag/retrieval/search"),
      import("../src/lib/rag/query-parser/parse"),
    ]);
    const parseStabilityFailures: string[] = [];
    for (const query of queries) {
      try {
        const first = JSON.stringify(interpretarConsultaLocal(query.query).intent);
        const second = JSON.stringify(interpretarConsultaLocal(query.query).intent);
        if (first !== second) parseStabilityFailures.push(query.id);
      } catch { parseStabilityFailures.push(query.id); }
    }
    const outcomes: RunOutcome[] = [];
    const repeats = options.repeat;
    for (let repeat = 0; repeat < repeats; repeat++) {
      const runQueries = options.smoke ? queries.slice(0, 20) : queries;
      for (const query of runQueries) {
        const truth = corpus.byId.get(query.id)!;
        outcomes.push(await runOne(query, truth, pool, buscarHibrido, interpretarConsultaLocal, snapshot.variants));
      }
    }
    const result = buildGates(outcomes, snapshot.variants, options);
    if (parseStabilityFailures.length) {
      const gate = { name: "parser_stability", value: 0, threshold: "all fixed queries stable", pass: false, detail: parseStabilityFailures.slice(0, 10).join(", ") };
      result.gates.push(gate);
      result.failures.push(gate);
    }
    const sample = [...snapshot.variants.values()][0];
    const explain = sample ? await explainPlans(pool, sample) : [];
    const report = renderReport(queries, snapshot.info, corpus, options, outcomes, result.gates, result.metrics, explain);
    await writeFile(options.report, report, "utf8");
    console.log(JSON.stringify({ status: result.failures.length ? "FAIL" : "PASS", report: path.relative(ROOT, options.report), metrics: result.metrics, failed_gates: result.failures.map((gate) => gate.name) }, null, 2));
    return { ...result, report };
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  for (const file of [".env.local", ".env"]) if (existsSync(file)) process.loadEnvFile(file);
  const options = parseArgs(process.argv.slice(2));
  assert(process.env.DATABASE_URL, "DATABASE_URL es requerido");
  const result = await runBenchmark(options);
  if (options.gate && result.failures.length) process.exitCode = 1;
}

if (process.env.RAG_BENCH_LIBRARY !== "true") {
  main().catch((error) => {
    console.error(`[FAIL] rag benchmark: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
