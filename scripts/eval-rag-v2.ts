import { readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";

const ROOT = process.cwd();
const DEFAULT_QUERIES = path.join(ROOT, "eval", "rag", "queries-v2.jsonl");
const DEFAULT_TRUTH = path.join(ROOT, "eval", "rag", "ground-truth-v2.jsonl");
const HASH_RE = /^[0-9a-f]{64}$/;
const TAXONOMY_VERSION = "catalog-taxonomy-v2";
const FAMILY_MINIMUMS: Record<string, number> = {
  sku: 50,
  name: 50,
  semantic: 100,
  color: 50,
  shape_size: 50,
  filter: 50,
  budget: 25,
  negative: 25,
};
const PII_KEY_RE = /(customer|order|lineitem|email|phone|address|first[_-]?name|last[_-]?name|access[_-]?token|refresh[_-]?token|password|secret)/i;
const PII_VALUE_RE = /(?:gid:\/\/shopify\/(?:Order|Customer)|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/i;
const LEAK_MARKER_RE = /\breferencia\s+\S+|\bvariante\s+\d{6,}|\b(?:product|variant)[-_ ]?id\b/i;

type QueryRecord = {
  id: string;
  family: string;
  label: string;
  query: string;
  snapshot_hash: string;
  snapshot_id: string;
  taxonomy_version: string;
};

type LabelRecord = {
  method: string;
  decision: string;
  relevant_product_ids: string[];
  alternative_product_ids?: string[];
  candidate_product_ids?: string[];
  evidence: Record<string, unknown>;
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
  relevance: string;
  evidence: Record<string, unknown>;
  ambiguous_sku?: boolean;
  exclude_recall_at_1?: boolean;
  no_match_expected?: boolean;
  labeler_a?: LabelRecord;
  labeler_b?: LabelRecord;
  adjudication?: {
    decision: string;
    relevant_product_ids: string[];
    rejected_alternative_product_ids?: string[];
    rule: string;
    evidence: Record<string, unknown>;
  };
};

type ProductRow = { product_id: string; handle: string; category: string | null; colors: string[]; occasions: string[]; available: boolean; status: string };
type VariantRow = {
  variant_id: string;
  product_id: string;
  sku: string | null;
  sku_canonical: string | null;
  sku_ambiguous: boolean;
  price: number;
  available: boolean;
  inventory_quantity: number | null;
  forma: string | null;
  codigo_tamano: string | null;
  diam_pulg: number | null;
  largo_pulg: number | null;
  ancho_cm: number | null;
  alto_cm: number | null;
  category: string | null;
  colors: string[];
  occasions: string[];
  derived_colors: string[];
  product_colors?: string[];
  product_available?: boolean;
  product_status?: string;
};

function parseArgs(argv: string[]): { queries: string; truth: string; gate: boolean } {
  let queries = DEFAULT_QUERIES;
  let truth = DEFAULT_TRUTH;
  let validate = false;
  let gate = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--validate-corpus") validate = true;
    else if (arg === "--gate") gate = true;
    else if (arg === "--queries") {
      const next = argv[++index];
      if (!next || next.startsWith("--")) throw new Error("--queries requiere una ruta");
      queries = path.resolve(ROOT, next);
    } else if (arg === "--ground-truth") {
      const next = argv[++index];
      if (!next || next.startsWith("--")) throw new Error("--ground-truth requiere una ruta");
      truth = path.resolve(ROOT, next);
    } else {
      throw new Error("argumento no reconocido: " + arg);
    }
  }
  if (!validate && !gate) throw new Error("use --validate-corpus o --gate");
  return { queries, truth, gate };
}

async function readJsonl<T>(file: string): Promise<T[]> {
  const text = await readFile(file, "utf8");
  const records: T[] = [];
  for (const [lineIndex, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line) as T);
    } catch (error) {
      throw new Error(path.relative(ROOT, file) + ":" + (lineIndex + 1) + " no es JSON válido: " + (error instanceof Error ? error.message : "unknown error"));
    }
  }
  return records;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertNoPii(value: unknown, location = "$"): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertNoPii(child, location + "[" + index + "]"));
    return;
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string") assert(!PII_VALUE_RE.test(value), "PII-like value at " + location);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    assert(!PII_KEY_RE.test(key), "PII-like key " + location + "." + key);
    assertNoPii(child, location + "." + key);
  }
}

function stringArray(value: unknown, location: string): string[] {
  assert(Array.isArray(value), location + " must be an array");
  for (const item of value) assert(typeof item === "string" && item.length > 0, location + " must contain non-empty strings");
  return value as string[];
}

function normalized(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-CO").replace(/\s+/g, " ").trim();
}

function sameIds(left: string[], right: string[]): boolean {
  return JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort());
}

function sameValue(left: string | number | null, right: unknown): boolean {
  if (left === null || right === null || right === undefined) return left === right;
  if (typeof left === "string" && typeof right === "string") return normalized(left) === normalized(right);
  return Number(left) === Number(right);
}

async function loadSnapshot(snapshotHash: string, snapshotId: string): Promise<{
  products: Set<string>;
  handles: string[];
  variants: Map<string, VariantRow>;
  skuValues: Set<string>;
}> {
  const databaseUrl = process.env.DATABASE_URL;
  assert(databaseUrl, "DATABASE_URL is required for live snapshot validation");
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const snapshot = await pool.query<{ source_sha256: string; status: string }>(
      "SELECT source_sha256, status FROM rag_source_snapshots WHERE source_snapshot_id = $1 AND source_kind = 'products_catalog'",
      [snapshotId],
    );
    assert(snapshot.rows.length === 1, "snapshot " + snapshotId + " is not published");
    assert(snapshot.rows[0].source_sha256 === snapshotHash, "corpus hash differs from published source hash");
    assert(snapshot.rows[0].status === "published", "corpus snapshot is not published");

    const products = await pool.query<ProductRow>(
      `SELECT product_id, handle, derived->>'category' AS category, available, status,
        COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(derived->'colors', '[]'::jsonb))), ARRAY[]::text[]) AS colors,
        COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(derived->'occasions', '[]'::jsonb))), ARRAY[]::text[]) AS occasions
       FROM catalog_products WHERE source_snapshot_id = $1`,
      [snapshotId],
    );
    const variants = await pool.query<Omit<VariantRow, "category" | "colors" | "occasions">>(
      "SELECT variant_id, product_id, sku, sku_canonical, sku_ambiguous, price::float8 AS price, available, inventory_quantity, forma, codigo_tamano, diam_pulg::float8 AS diam_pulg, largo_pulg::float8 AS largo_pulg, ancho_cm::float8 AS ancho_cm, alto_cm::float8 AS alto_cm, COALESCE(derived_colors, ARRAY[]::text[]) AS derived_colors FROM catalog_variants WHERE source_snapshot_id = $1",
      [snapshotId],
    );
    const productIds = new Set(products.rows.map((row) => row.product_id));
    const productMap = new Map(products.rows.map((row) => [row.product_id, row]));
    const variantMap = new Map(variants.rows.map((row) => {
      const product = productMap.get(row.product_id);
      assert(product, "variant " + row.variant_id + " references a product outside the snapshot");
      return [row.variant_id, { ...row, category: product.category, colors: row.derived_colors, occasions: product.occasions, product_colors: product.colors, product_available: product.available, product_status: product.status }];
    }));
    assert(productIds.size > 0 && variantMap.size > 0, "published snapshot has no catalog rows");
    return {
      products: productIds,
      handles: products.rows.map((row) => row.handle),
      variants: variantMap,
      skuValues: new Set(variants.rows.flatMap((row) => [row.sku, row.sku_canonical].filter((value): value is string => Boolean(value)).map(normalized))),
    };
  } finally {
    await pool.end();
  }
}

function assertNoQueryLeaks(query: QueryRecord, handles: string[], products: Set<string>, variants: Map<string, VariantRow>, skuValues: Set<string>): void {
  const text = normalized(query.query);
  assert(!LEAK_MARKER_RE.test(query.query), query.id + " contains an identifier leak marker");
  for (const productId of products) assert(!text.includes(normalized(productId)), query.id + " contains product_id " + productId);
  for (const variantId of variants.keys()) assert(!text.includes(normalized(variantId)), query.id + " contains variant_id " + variantId);
  for (const handle of handles) assert(!text.includes(normalized(handle)), query.id + " contains product handle " + handle);
  if (query.family === "sku") {
    const hasKnownSku = [...skuValues].some((sku) => text.includes(sku));
    assert(hasKnownSku, query.id + " SKU case does not contain a real catalog SKU");
  }
}

function expectedForBudget(variants: Map<string, VariantRow>, maxPrice: number): string[] {
  return [...variants.values()].filter((row) => row.available && row.price <= maxPrice).map((row) => row.variant_id).sort();
}

function expectedForFilter(variants: Map<string, VariantRow>, constraints: Record<string, unknown>): string[] {
  const supported = new Set(["available", "color", "category", "occasion", "forma", "diam_pulg", "max_price_cop"]);
  for (const key of Object.keys(constraints)) assert(supported.has(key), "filter contains unsupported constraint " + key);
  return [...variants.values()].filter((row) => {
    if (constraints.available === true && (!row.available || row.product_available === false || row.product_status === "DRAFT")) return false;
    if (typeof constraints.color === "string") {
      const explicit = row.derived_colors.some((value) => normalized(value) === normalized(constraints.color as string));
      const singletonFallback = row.derived_colors.length === 0 && (row.product_colors?.length ?? 0) === 1 && row.product_colors?.some((value) => normalized(value) === normalized(constraints.color as string));
      if (!explicit && !singletonFallback) return false;
    }
    if (typeof constraints.category === "string" && normalized(row.category ?? "") !== normalized(constraints.category as string)) return false;
    if (typeof constraints.occasion === "string" && !row.occasions.some((value) => normalized(value) === normalized(constraints.occasion as string))) return false;
    if (typeof constraints.forma === "string" && normalized(row.forma ?? "") !== normalized(constraints.forma as string)) return false;
    if (typeof constraints.diam_pulg === "number" && row.diam_pulg !== constraints.diam_pulg) return false;
    if (typeof constraints.max_price_cop === "number" && row.price > constraints.max_price_cop) return false;
    return true;
  }).map((row) => row.variant_id).sort();
}

async function validateCorpus(queryFile: string, truthFile: string): Promise<void> {
  const queries = await readJsonl<QueryRecord>(queryFile);
  const truths = await readJsonl<TruthRecord>(truthFile);
  assert(queries.length >= 400, "corpus has " + queries.length + " queries; minimum is 400");
  assert(queries.length === truths.length, "query and ground-truth counts differ");

  const queryIds = new Set<string>();
  const truthIds = new Set<string>();
  const queryTexts = new Set<string>();
  const queryById = new Map<string, QueryRecord>();
  let snapshotHash: string | null = null;
  let snapshotId: string | null = null;
  let taxonomyVersion: string | null = null;

  for (const query of queries) {
    assert(typeof query.id === "string" && query.id.length > 0, "query id is required");
    assert(!queryIds.has(query.id), "duplicate query id " + query.id);
    queryIds.add(query.id);
    queryById.set(query.id, query);
    assert(typeof query.family === "string" && query.family.length > 0, query.id + " family is required");
    assert(typeof query.query === "string" && query.query.trim().length > 0, query.id + " query is empty");
    const queryKey = normalized(query.query);
    assert(!queryTexts.has(queryKey), "duplicate query text across corpus: " + query.query);
    queryTexts.add(queryKey);
    assert(HASH_RE.test(query.snapshot_hash), query.id + " snapshot_hash must be lowercase SHA-256");
    if (snapshotHash === null) snapshotHash = query.snapshot_hash;
    if (snapshotId === null) snapshotId = query.snapshot_id;
    if (taxonomyVersion === null) taxonomyVersion = query.taxonomy_version;
    assert(query.snapshot_hash === snapshotHash, query.id + " mixes snapshots");
    assert(query.snapshot_id === snapshotId, query.id + " mixes snapshot IDs");
    assert(query.taxonomy_version === taxonomyVersion, query.id + " mixes taxonomy versions");
    assertNoPii(query, "query:" + query.id);
  }
  assert(taxonomyVersion === TAXONOMY_VERSION, "taxonomy_version must be " + TAXONOMY_VERSION);

  for (const truth of truths) {
    assert(typeof truth.id === "string" && queryIds.has(truth.id), "ground truth " + truth.id + " has no query");
    assert(!truthIds.has(truth.id), "duplicate ground-truth id " + truth.id);
    truthIds.add(truth.id);
    const query = queryById.get(truth.id)!;
    assert(truth.family === query.family, truth.id + " family differs between query and ground truth");
    assert(truth.snapshot_hash === snapshotHash && truth.snapshot_id === snapshotId, truth.id + " mixes snapshots");
    assert(truth.taxonomy_version === TAXONOMY_VERSION, truth.id + " has false taxonomy metadata");
    stringArray(truth.expected_product_ids, truth.id + ".expected_product_ids");
    stringArray(truth.expected_variant_ids, truth.id + ".expected_variant_ids");
    assert(new Set(truth.expected_product_ids).size === truth.expected_product_ids.length, truth.id + " has duplicate expected products");
    assert(new Set(truth.expected_variant_ids).size === truth.expected_variant_ids.length, truth.id + " has duplicate expected variants");

    if (truth.family === "negative") {
      assert(truth.no_match_expected === true, truth.id + " negative must declare no_match_expected");
      assert(truth.expected_product_ids.length === 0 && truth.expected_variant_ids.length === 0, truth.id + " negative cannot have expected IDs");
    } else {
      assert(truth.expected_product_ids.length > 0, truth.id + " needs an expected product");
    }
    if (truth.family === "sku") {
      if (truth.ambiguous_sku) {
        assert(truth.expected_variant_ids.length >= 2, truth.id + " ambiguous SKU must be a set");
        assert(truth.exclude_recall_at_1 === true, truth.id + " ambiguous SKU must exclude Recall@1");
      } else {
        assert(truth.expected_variant_ids.length === 1, truth.id + " exact SKU must have one variant");
      }
    }
    if (truth.family === "shape_size") {
      assert(truth.expected_variant_ids.length >= 1, truth.id + " shape/size must identify at least one same-variant result");
      const hasAttribute = truth.constraints.forma !== null || truth.constraints.codigo_tamano !== null ||
        truth.constraints.diam_pulg !== null || truth.constraints.largo_pulg !== null ||
        truth.constraints.ancho_cm !== null || truth.constraints.alto_cm !== null;
      assert(hasAttribute, truth.id + " shape/size case lacks same-variant source evidence");
    }
    if (truth.family === "filter") {
      assert(truth.constraints.available === true, truth.id + " filter must require available=true");
      assert(Object.keys(truth.constraints).some((key) => ["color", "category", "occasion", "forma", "diam_pulg", "max_price_cop"].includes(key)), truth.id + " filter lacks a supported hard attribute");
      assert(/disponible/i.test(query.query), truth.id + " filter must express commercial availability");
      assert(!/inventario\s+(?:exactamente|igual|=|-?\d+)/i.test(query.query), truth.id + " filter must not expose internal inventory counts");
      assert(truth.constraints.min_inventory === undefined && truth.constraints.inventory_quantity_exact === undefined, truth.id + " filter must keep inventory anomalies out of relevance constraints");
    }
    if (truth.family === "budget") {
      assert(typeof truth.constraints.max_price_cop === "number" && truth.constraints.max_price_cop > 0, truth.id + " budget must use max_price_cop");
      assert(truth.constraints.price_exact_cop === undefined, truth.id + " budget cannot use exact-price singleton");
      assert(truth.constraints.available === true, truth.id + " budget must use commercial availability");
      assert(truth.constraints.min_inventory === undefined, truth.id + " budget must not turn inventory anomalies into hard relevance filters");
      assert(truth.expected_variant_ids.length > 1, truth.id + " budget must not be a trivial exact-price singleton");
      assert(/hasta|máximo|tope/i.test(query.query), truth.id + " budget must express a maximum");
      assert(!/exact[oa]|igual/i.test(query.query), truth.id + " budget contains exact-price wording");
    }
    if (truth.family === "semantic") {
      const a = truth.labeler_a;
      const b = truth.labeler_b;
      assert(a && b && truth.adjudication, truth.id + " semantic case lacks two labels/adjudication");
      assert(a.method !== b.method && a.method !== "human_review" && b.method !== "human_review", truth.id + " labels are not independent documented methods");
      assert(a.decision === "relevant" && sameIds(a.relevant_product_ids, truth.expected_product_ids), truth.id + " labeler_a does not support expected product");
      if (b.decision === "ambiguous") {
        assert((b.candidate_product_ids ?? []).length >= 2, truth.id + " ambiguous labeler_b lacks alternatives");
        assert((b.alternative_product_ids ?? []).length > 0, truth.id + " ambiguous labeler_b lacks alternative_product_ids");
      } else {
        assert(b.decision === "relevant" && sameIds(b.relevant_product_ids, truth.expected_product_ids), truth.id + " labeler_b does not support expected product");
      }
      assert(truth.adjudication.decision === "relevant", truth.id + " adjudication is missing");
      assert(sameIds(truth.adjudication.relevant_product_ids, truth.expected_product_ids), truth.id + " adjudication differs from expected");
      assertNoPii(a, truth.id + ".labeler_a");
      assertNoPii(b, truth.id + ".labeler_b");
    }
    assertNoPii(truth, "truth:" + truth.id);
  }
  assert(queryIds.size === truthIds.size, "ground truth contains extra or missing IDs");
  for (const [family, minimum] of Object.entries(FAMILY_MINIMUMS)) {
    const count = queries.filter((query) => query.family === family).length;
    assert(count >= minimum, family + " has " + count + "; minimum is " + minimum);
  }
  assert(snapshotHash !== null && snapshotId !== null, "corpus metadata is missing");

  const snapshot = await loadSnapshot(snapshotHash, snapshotId);
  let semanticDisagreements = 0;
  for (const query of queries) {
    assertNoQueryLeaks(query, snapshot.handles, snapshot.products, snapshot.variants, snapshot.skuValues);
    const truth = truths.find((item) => item.id === query.id)!;
    for (const productId of truth.expected_product_ids) assert(snapshot.products.has(productId), truth.id + " expected product outside snapshot: " + productId);
    for (const variantId of truth.expected_variant_ids) {
      const variant = snapshot.variants.get(variantId);
      assert(variant, truth.id + " expected variant outside snapshot: " + variantId);
      assert(truth.expected_product_ids.includes(variant.product_id), truth.id + " expected variant parent missing");
    }
    if (truth.family === "sku") {
      for (const variantId of truth.expected_variant_ids) {
        const variant = snapshot.variants.get(variantId)!;
        assert(variant.sku_ambiguous === Boolean(truth.ambiguous_sku), truth.id + " SKU ambiguity disagrees with Postgres");
        if (!truth.ambiguous_sku) assert(variant.available, truth.id + " exact SKU is not commercially available");
      }
    }
    if (truth.family === "shape_size") {
      const attributes: Array<[keyof VariantRow, unknown]> = [
        ["forma", truth.constraints.forma],
        ["diam_pulg", truth.constraints.diam_pulg],
      ];
      for (const variantId of truth.expected_variant_ids) {
        const variant = snapshot.variants.get(variantId);
        assert(variant, truth.id + " shape/size expected variant is missing");
        for (const [field, expected] of attributes) {
          if (expected !== null && expected !== undefined) {
            assert(sameValue(variant[field] as string | number | null, expected), truth.id + " attribute " + field + " does not belong to the expected same-variant set");
          }
        }
      }
    }
    if (truth.family === "filter") {
      const expected = expectedForFilter(snapshot.variants, truth.constraints);
      assert(sameIds(expected, truth.expected_variant_ids), truth.id + " filter expected set is not complete");
    }
    if (truth.family === "budget") {
      const expected = expectedForBudget(snapshot.variants, Number(truth.constraints.max_price_cop));
      assert(sameIds(expected, truth.expected_variant_ids), truth.id + " budget expected set is not complete");
    }
    if (truth.family === "semantic" && truth.labeler_b?.decision === "ambiguous") semanticDisagreements++;
  }
  assert(semanticDisagreements >= 10, "semantic corpus lacks disagreement/alternative coverage");
  const counts = Object.fromEntries(Object.keys(FAMILY_MINIMUMS).map((family) => [family, queries.filter((query) => query.family === family).length]));
  console.log(JSON.stringify({
    status: "PASS",
    corpus: queries.length,
    snapshot_id: snapshotId,
    snapshot_hash: snapshotHash,
    taxonomy_version: TAXONOMY_VERSION,
    families: counts,
    semantic_disagreements: semanticDisagreements,
  }));
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  await validateCorpus(options.queries, options.truth);
  if (options.gate) {
    process.env.RAG_BENCH_LIBRARY = "true";
    const { runBenchmark } = await import("./bench-rag-v2");
    const result = await runBenchmark({ repeat: 1, noKey: true, gate: true, report: path.join(ROOT, "reports", "rag-baseline-v2.md"), smoke: false });
    if (result.failures.length) process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[FAIL] rag corpus validation: " + (error instanceof Error ? error.message : "unknown error"));
  process.exitCode = 1;
});
