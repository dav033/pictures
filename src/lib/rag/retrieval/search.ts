import type { Pool } from "pg";
import { getGeminiClient } from "@/lib/gemini";
import { DIMENSIONES_EMBEDDING, MODELO_EMBEDDING, embeberTexto } from "../embeddings";
import { canonicalizeSku } from "../catalog/canonicalize";
import { fusionarRankingsLocal, type RrfBranch, type RrfContribution } from "./rrf";
import type {
  BranchStatus,
  ConsultaRetrieval,
  FiltrosDuros,
  CatalogAllowlist,
  EventMatchEvidence,
  EventSearchIntent,
  RespuestaRetrieval,
  ResultadoRetrieval,
} from "./types";
import {
  RAG_USE_VECTOR as USE_VECTOR,
  RAG_USE_FULLTEXT as USE_FULLTEXT,
  RAG_USE_TRIGRAM as USE_TRIGRAM,
  RAG_RERANK_ENABLED as USE_RERANK,
  RAG_PYTHON_QUERY_EMBEDDINGS_ENABLED,
} from "@/lib/ia/feature-flags";
import { llamarPythonRerank, seleccionarBackendPython } from "@/lib/ia/python-adapter";

const BRANCH_LIMIT = Number(process.env.RAG_BRANCH_LIMIT ?? 40);
const FINAL_LIMIT = Number(process.env.RAG_FINAL_LIMIT ?? 15);
const TRIGRAM_MIN_SIMILARITY = Math.max(0.3, Number(process.env.RAG_TRIGRAM_MIN_SIMILARITY ?? 0.3));
const RRF_WEIGHTS = { fts: 0.55, trigram: 0.3, vector: 0.15 } as const;
// Fase 8.2: reranking a fixed-size window of the already-whitelisted,
// finalScore-sorted candidates -- not the whole branch, so one cross-encoder
// call stays cheap regardless of how many candidates passed the whitelist.
const RERANK_CANDIDATE_WINDOW = Number(process.env.RAG_RERANK_CANDIDATE_WINDOW ?? 30);
export const RERANK_DEADLINE_MS = safeDeadline(Number(process.env.RAG_RERANK_DEADLINE_MS ?? 5_000));
const RERANK_OPERATION_BUDGET_BYTES = 48 * 1024;

type BranchRow = {
  product_id: string;
  variant_id: string;
  score: number;
};

type ExactRow = {
  product_id: string;
  variant_id: string;
  sku_ambiguous: boolean;
};

type FilterAliases = { product: string; variant: string };
const DEFAULT_ALIASES: FilterAliases = { product: "p", variant: "v" };

type FusedEntry = { productId: string; score: number; contributions: RrfContribution[] };

type EventSignalRow = {
  product_id: string;
  title: string | null;
  handle: string | null;
  description_text: string | null;
  tags: string[] | null;
  occasions: string[] | null;
};

type RerankTextRow = {
  product_id: string;
  search_text: string | null;
};

export type RerankStatus = "READY" | "SKIPPED_OPTIONAL" | "ERROR";

function safeLimit(value: number, fallback: number): number {
  return Number.isInteger(value) && value > 0 && value <= 500 ? value : fallback;
}

function safeDeadline(value: number, fallback = 5_000): number {
  return Number.isInteger(value) && value > 0 && value <= 75_000 ? value : fallback;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, parentSignal?: AbortSignal): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    const timeout = new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error("rerank preparation deadline exceeded")), timeoutMs);
    });
    const cancelled = parentSignal
      ? new Promise<T>((_, reject) => {
          abort = () => reject(new Error("rerank preparation cancelled"));
          if (parentSignal.aborted) abort();
          else parentSignal.addEventListener("abort", abort, { once: true });
        })
      : undefined;
    return await Promise.race([
      promise,
      timeout,
      ...(cancelled ? [cancelled] : []),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (abort && parentSignal) parentSignal.removeEventListener("abort", abort);
  }
}

function pareceSku(value: string): boolean {
  const text = value.trim();
  return /^SKU[-_]/i.test(text) || (/^[A-Z0-9._/-]{8,}$/i.test(text) && /\d/.test(text));
}

/** Extracts a SKU from a natural-language request without treating a size such as R-12 as one. */
function extraerSku(value: string): string | null {
  const text = value.trim();
  if (pareceSku(text)) return text;
  // Unlabelled B2B references in the source always carry `-` or `:`. Do not
  // mistake natural prose such as "B2b Bouquet" for a SKU; the spaced form
  // is accepted only when the customer explicitly labels it as SKU/REF.
  const b2b = text.match(/\bB2B[-:][A-Z0-9][A-Z0-9._/-]{4,}\b/i);
  if (b2b) return b2b[0];
  const labeledB2b = text.match(/\b(?:SKU|REF|COD(?:IGO|IGO)|CÓDIGO)\s*[:#-]?\s*B2B\s+([A-Z0-9][A-Z0-9._/-]{4,})\b/i);
  if (labeledB2b?.[1]) return `B2B-${labeledB2b[1]}`;
  const labeled = text.match(/\b(?:SKU|REF|COD(?:IGO|IGO)|CÓDIGO)\s*[:#-]?\s*([A-Z0-9][A-Z0-9._/-]{5,})\b/i);
  if (labeled?.[1]) return labeled[1];
  return /^\d{8,}$/.test(text) ? text : null;
}

/** Exact SKU retrieval never needs a paid semantic embedding. */
export function consultaTieneSku(value: string): boolean {
  return extraerSku(value) !== null;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toUpperCase()).filter(Boolean))];
}

function textoLexical(semanticQuery: string): string {
  // `buscarPorRol` appends a role hint after an em dash. It is useful for a
  // vector preference but its prose tokens are not catalog terms; requiring
  // every one of them in plainto_tsquery would erase valid category matches.
  return semanticQuery.split(/[—–]/, 1)[0]?.trim() || semanticQuery.trim();
}

function foldEventText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

async function eventEvidenceByProduct(
  pool: Pool,
  productIds: string[],
  event: EventSearchIntent | undefined,
): Promise<Map<string, EventMatchEvidence>> {
  if (!event || !productIds.length) return new Map();
  const { rows } = await pool.query<EventSignalRow>(
    `SELECT p.product_id, p.title, p.handle, p.description_text,
            p.tags, p.derived->'occasions' AS occasions
     FROM catalog_products p
     WHERE p.product_id = ANY($1::text[])`,
    [productIds],
  );
  const terms = [...new Set([...event.event_terms, ...event.soft_signals.motivos].map((term) => term.trim()).filter(Boolean))];
  const evidence = new Map<string, EventMatchEvidence>();
  for (const row of rows) {
    const text = foldEventText([row.title, row.handle, row.description_text, ...(row.tags ?? [])].filter(Boolean).join(" "));
    const matchedSignals = terms.filter((term) => text.includes(foldEventText(term)));
    const occasionHit = (row.occasions ?? []).some((occasion) => event.occasion_filter.includes(occasion));
    const labelHit = Boolean(event.event_label && text.includes(foldEventText(event.event_label)));
    const exact = occasionHit || labelHit;
    const thematic = matchedSignals.length > 0;
    const match_level = exact ? "exact_event" : thematic ? "thematic" : "adaptable";
    evidence.set(row.product_id, {
      match_level,
      matched_signals: [...new Set([...(occasionHit ? event.occasion_filter : []), ...(labelHit && event.event_label ? [event.event_label] : []), ...matchedSignals])],
      relaxations: match_level === "adaptable" ? ["evento sin señal verificable en título, descripción o tags"] : [],
    });
  }
  return evidence;
}

async function rerankTextByProduct(pool: Pool, productIds: string[]): Promise<Map<string, string>> {
  if (!productIds.length) return new Map();
  const { rows } = await pool.query<RerankTextRow>(
    `SELECT product_id, search_text
     FROM catalog_products
     WHERE product_id = ANY($1::text[])`,
    [productIds],
  );
  return new Map(
    rows
      .filter((row): row is RerankTextRow & { search_text: string } => typeof row.search_text === "string" && row.search_text.trim().length > 0)
      .map((row) => [row.product_id, row.search_text]),
  );
}

async function rerankResults(
  pool: Pool,
  consulta: ConsultaRetrieval,
  sortedResults: ResultadoRetrieval[],
): Promise<{ results: ResultadoRetrieval[]; status: RerankStatus }> {
  if (!USE_RERANK || seleccionarBackendPython().backend !== "python") {
    return { results: sortedResults, status: "SKIPPED_OPTIONAL" };
  }
  if (!consulta.semanticQuery.trim() || sortedResults.length < 2) {
    return { results: sortedResults, status: "SKIPPED_OPTIONAL" };
  }

  const windowSize = Math.min(100, safeLimit(RERANK_CANDIDATE_WINDOW, FINAL_LIMIT));
  const window = sortedResults.slice(0, windowSize);
  const configuredDeadlineAt = consulta.rerankDeadlineAt;
  const deadlineAt = typeof configuredDeadlineAt === "number" && Number.isFinite(configuredDeadlineAt)
    ? configuredDeadlineAt
    : Date.now() + RERANK_DEADLINE_MS;
  try {
    const preparationDeadlineMs = deadlineAt - Date.now();
    if (preparationDeadlineMs <= 0) return { results: sortedResults, status: "ERROR" };
    const textByProduct = await withTimeout(
      rerankTextByProduct(pool, window.map((result) => result.productId)),
      preparationDeadlineMs,
      consulta.rerankSignal,
    );
    const candidates = window.map((result) => ({
      id: result.productId,
      text: textByProduct.get(result.productId)?.trim().slice(0, 4_000) ?? "",
    }));
    if (candidates.some((candidate) => !candidate.text)) {
      return { results: sortedResults, status: "SKIPPED_OPTIONAL" };
    }

    const query = consulta.semanticQuery.trim().slice(0, 1_000);
    const boundedCandidates: typeof candidates = [];
    for (const candidate of candidates) {
      const nextCandidates = [...boundedCandidates, candidate];
      const operationBytes = new TextEncoder().encode(
        JSON.stringify({ query, candidates: nextCandidates }),
      ).byteLength;
      if (operationBytes > RERANK_OPERATION_BUDGET_BYTES) break;
      boundedCandidates.push(candidate);
    }
    if (boundedCandidates.length < 2) {
      return { results: sortedResults, status: "SKIPPED_OPTIONAL" };
    }

    const requestId = consulta.rerankRequestId ?? crypto.randomUUID();
    const correlationId = consulta.rerankCorrelationId ?? requestId;
    const remainingDeadlineMs = deadlineAt - Date.now();
    if (remainingDeadlineMs <= 0) return { results: sortedResults, status: "ERROR" };
    const response = await llamarPythonRerank({
      query,
      candidates: boundedCandidates,
      requestId,
      correlationId,
      deadlineMs: remainingDeadlineMs,
      parentSignal: consulta.rerankSignal,
    });
    const rerankWindow = window.slice(0, boundedCandidates.length);
    const byId = new Map(rerankWindow.map((result) => [result.productId, result]));
    const reorderedWindow = response.order.map((productId) => byId.get(productId));
    if (reorderedWindow.some((result): result is undefined => result === undefined)) {
      return { results: sortedResults, status: "ERROR" };
    }
    const orderedWindow: ResultadoRetrieval[] = reorderedWindow.map((result) => {
      if (!result) throw new Error("rerank response referenced an unknown candidate");
      return result;
    });
    return {
      results: [...orderedWindow, ...sortedResults.slice(rerankWindow.length)],
      status: "READY",
    };
  } catch {
    // Reranking is an optional quality signal. Any transport, model, or
    // validation failure falls back to the already-authorized local order.
    return { results: sortedResults, status: "ERROR" };
  }
}

/** Use component/event queries when provided; whole conversational requests
 * are only fallback for legacy callers. Every query shares the same hard SQL
 * predicates, so an AI-enriched text cannot loosen customer constraints. */
function consultasLexicales(consulta: ConsultaRetrieval): string[] {
  const focused = (consulta.focusedQueries ?? [])
    .map((query) => textoLexical(query))
    .filter(Boolean);
  return [...new Set((focused.length ? focused : [textoLexical(consulta.semanticQuery)]).map((query) => query.trim()).filter(Boolean))].slice(0, 8);
}

function tieneFiltrosNavegables(filtros: FiltrosDuros | undefined): boolean {
  return Boolean(
    filtros && (
      filtros.precioMax != null || filtros.categorias?.length || filtros.ocasiones?.length ||
      filtros.colores?.length || filtros.acabados?.length || filtros.formas?.length || filtros.diametrosPulgadas?.length
    ),
  );
}

/**
 * Builds hard predicates shared by every retrieval branch. A branch joins one
 * variant as `v`, so price, availability, shape and diameter all describe
 * that same row. Inventory is deliberately not used to reinterpret Shopify's
 * `available` source flag.
 */
function construirFiltroDuro(
  filtros: FiltrosDuros | undefined,
  params: unknown[],
  aliases: FilterAliases = DEFAULT_ALIASES,
  allowlist?: CatalogAllowlist,
): string {
  const condiciones: string[] = [`${aliases.product}.status = 'ACTIVE'`];
  const disponible = filtros?.disponible ?? true;
  if (disponible) {
    condiciones.push(`${aliases.product}.available = true`);
    condiciones.push(`${aliases.variant}.available = true`);
  }
  if (filtros?.precioMax != null) {
    params.push(filtros.precioMax);
    condiciones.push(`${aliases.variant}.price <= $${params.length}`);
  }
  if (filtros?.formas?.length) {
    params.push(filtros.formas);
    condiciones.push(`${aliases.variant}.forma = ANY($${params.length}::text[])`);
  }
  if (filtros?.diametrosPulgadas?.length) {
    params.push(filtros.diametrosPulgadas);
    condiciones.push(`${aliases.variant}.diam_pulg = ANY($${params.length}::numeric[])`);
    if (!filtros.formas?.length) condiciones.push(`${aliases.variant}.forma = 'redondo'`);
  }
  if (filtros?.categorias?.length) {
    params.push(filtros.categorias);
    condiciones.push(`${aliases.product}.derived->>'category' = ANY($${params.length}::text[])`);
  }
  if (filtros?.ocasiones?.length) {
    params.push(filtros.ocasiones);
    condiciones.push(`${aliases.product}.derived->'occasions' ?| $${params.length}::text[]`);
  }
  if (filtros?.colores?.length) {
    params.push(filtros.colores);
    // Prefer variant evidence. Unknown variants may inherit only a singleton
    // product color; a multi-color product must not let an arbitrary sibling
    // satisfy the requested color.
    condiciones.push(`(
      (cardinality(${aliases.variant}.derived_colors) > 0 AND ${aliases.variant}.derived_colors && $${params.length}::text[])
      OR (cardinality(${aliases.variant}.derived_colors) = 0
          AND jsonb_array_length(${aliases.product}.derived->'colors') = 1
          AND ${aliases.product}.derived->'colors' ?| $${params.length}::text[])
    )`);
  }
  if (filtros?.acabados?.length) {
    params.push(filtros.acabados);
    condiciones.push(`${aliases.product}.derived->'finishes' ?| $${params.length}::text[]`);
  }
  if (allowlist) {
    const productIds = [...new Set(allowlist.productIds)];
    const variantIds = [...new Set(allowlist.variantIds)];
    if (productIds.length === 0 && variantIds.length === 0) {
      condiciones.push("FALSE");
    } else if (variantIds.length) {
      // La variante manda, y no se combina con `product_id` por OR: que un
      // producto esté entrenado no implica que todos sus tamaños se hayan
      // fotografiado. Con el OR anterior, un R-24 de un producto entrenado
      // solo en R-5..R-18 pasaba la búsqueda, Gemini lo metía al plan y
      // /api/generate lo rechazaba después con LORA_DATASET_ALLOWLIST_REJECTED.
      params.push(variantIds);
      condiciones.push(`${aliases.variant}.variant_id = ANY($${params.length}::text[])`);
    } else {
      // Allowlist sin variantes: es lo más fino que puede expresar.
      params.push(productIds);
      condiciones.push(`${aliases.product}.product_id = ANY($${params.length}::text[])`);
    }
  }
  return condiciones.length ? `AND ${condiciones.join(" AND ")}` : "";
}

function addBranchRows(
  rows: BranchRow[],
  scores: Map<string, number>,
  variants: Map<string, Set<string>>,
): string[] {
  const ranked: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const score = Number(row.score);
    if (!seen.has(row.product_id)) {
      seen.add(row.product_id);
      ranked.push(row.product_id);
    }
    scores.set(row.product_id, Math.max(scores.get(row.product_id) ?? 0, Number.isFinite(score) ? score : 0));
    const productVariants = variants.get(row.product_id) ?? new Set<string>();
    productVariants.add(row.variant_id);
    variants.set(row.product_id, productVariants);
  }
  return ranked;
}

async function queryExact(
  pool: Pool,
  rawValues: string[],
  canonicalValues: string[],
  filtros: FiltrosDuros | undefined,
  allowlist?: CatalogAllowlist,
): Promise<{ rows: ExactRow[]; anyRows: ExactRow[] }> {
  // Prefer the original representation. A canonical match is a fallback for
  // a query like `20008459`, and must never add sibling variants when the
  // user supplied the unambiguous source value `B2B-20000723`.
  const lookup = async (values: string[], columnSql: string, filter: FiltrosDuros | undefined) => {
    const params: unknown[] = [values];
    const hardFilter = construirFiltroDuro(filter, params, DEFAULT_ALIASES, allowlist);
    const { rows } = await pool.query<ExactRow>(
      `
        SELECT v.product_id, v.variant_id, COALESCE(v.sku_ambiguous, false) AS sku_ambiguous
        FROM catalog_variants v
        JOIN catalog_products p ON p.product_id = v.product_id
        WHERE ${columnSql} = ANY($1::text[]) ${hardFilter}
        ORDER BY v.product_id, v.variant_id`,
      params,
    );
    return rows;
  };

  let rows = await lookup(rawValues, "UPPER(v.sku_original)", filtros);
  if (rows.length === 0 && canonicalValues.length) rows = await lookup(canonicalValues, "UPPER(v.sku_canonical)", filtros);

  // Existence is checked against ACTIVE rows without availability, price or
  // facet predicates so `filtered_out` is distinguishable from `not_found`.
  const anyRaw = await lookup(rawValues, "UPPER(v.sku_original)", { disponible: false });
  const anyRows = anyRaw.length > 0 || !canonicalValues.length
    ? anyRaw
    : await lookup(canonicalValues, "UPPER(v.sku_canonical)", { disponible: false });
  return { rows, anyRows };
}

async function queryFullTextOne(pool: Pool, query: string, filtros: FiltrosDuros | undefined, allowlist?: CatalogAllowlist): Promise<BranchRow[]> {
  const params: unknown[] = [query];
  const filtro = construirFiltroDuro(filtros, params, DEFAULT_ALIASES, allowlist);
  params.push(safeLimit(BRANCH_LIMIT, 40));
  const { rows } = await pool.query<BranchRow>(
    `
      WITH candidates AS (
        SELECT DISTINCT ON (p.product_id) p.product_id, v.variant_id, ts_rank_cd(p.search_tsv, q) AS score
        FROM catalog_products p
        JOIN catalog_variants v ON v.product_id = p.product_id
        CROSS JOIN plainto_tsquery('spanish_unaccent', $1) q
        WHERE p.search_tsv @@ q ${filtro}
        ORDER BY p.product_id, score DESC, v.variant_id
      )
      SELECT product_id, variant_id, score
      FROM candidates
      ORDER BY score DESC, product_id, variant_id
      LIMIT $${params.length}`,
    params,
  );
  return rows;
}

async function queryFullText(pool: Pool, consulta: ConsultaRetrieval): Promise<BranchRow[]> {
  const rows = (await Promise.all(consultasLexicales(consulta).map((query) => queryFullTextOne(pool, query, consulta.filtros, consulta.allowlist)))).flat();
  return mergeFocusedRows(rows);
}

function mergeFocusedRows(rows: BranchRow[]): BranchRow[] {
  const best = new Map<string, BranchRow>();
  for (const row of rows) {
    const previous = best.get(`${row.product_id}:${row.variant_id}`);
    if (!previous || Number(row.score) > Number(previous.score)) best.set(`${row.product_id}:${row.variant_id}`, row);
  }
  return [...best.values()].sort((left, right) => Number(right.score) - Number(left.score) || left.product_id.localeCompare(right.product_id) || left.variant_id.localeCompare(right.variant_id)).slice(0, safeLimit(BRANCH_LIMIT, 40));
}

async function queryTrigramOne(pool: Pool, query: string, filtros: FiltrosDuros | undefined, allowlist?: CatalogAllowlist): Promise<BranchRow[]> {
  const params: unknown[] = [query, TRIGRAM_MIN_SIMILARITY];
  const filtro = construirFiltroDuro(filtros, params, DEFAULT_ALIASES, allowlist);
  const limit = safeLimit(BRANCH_LIMIT, 40);
  const limitParam = params.length + 1;
  params.push(limit);
  const { rows } = await pool.query<BranchRow>(
    `
      WITH title_candidates AS (
        SELECT p.product_id, v.variant_id, similarity(COALESCE(p.title, ''), $1) AS score
        FROM catalog_products p
        JOIN catalog_variants v ON v.product_id = p.product_id
        WHERE p.title % $1
          AND similarity(COALESCE(p.title, ''), $1) >= $2::real ${filtro}
        ORDER BY p.title <-> $1, p.product_id, v.variant_id
        LIMIT ${limit * 2}
      ), handle_candidates AS (
        SELECT p.product_id, v.variant_id, similarity(COALESCE(p.handle, ''), $1) AS score
        FROM catalog_products p
        JOIN catalog_variants v ON v.product_id = p.product_id
        WHERE p.handle % $1
          AND similarity(COALESCE(p.handle, ''), $1) >= $2::real ${filtro}
        ORDER BY p.handle <-> $1, p.product_id, v.variant_id
        LIMIT ${limit * 2}
      ), candidates AS (
        SELECT DISTINCT ON (product_id) product_id, variant_id, score
        FROM (
          SELECT product_id, variant_id, score FROM title_candidates
          UNION ALL
          SELECT product_id, variant_id, score FROM handle_candidates
        ) lexical_candidates
        ORDER BY product_id, score DESC, variant_id
      )
      SELECT product_id, variant_id, score
      FROM candidates
      ORDER BY score DESC, product_id, variant_id
      LIMIT $${limitParam}`,
    params,
  );
  return rows;
}

async function queryTrigram(pool: Pool, consulta: ConsultaRetrieval): Promise<BranchRow[]> {
  const rows = (await Promise.all(consultasLexicales(consulta).map((query) => queryTrigramOne(pool, query, consulta.filtros, consulta.allowlist)))).flat();
  return mergeFocusedRows(rows);
}

async function queryVector(pool: Pool, consulta: ConsultaRetrieval): Promise<BranchRow[]> {
  const embedding = consulta.embeddingPrecalculado ?? (await embeberTexto(
    consulta.semanticQuery,
    "RETRIEVAL_QUERY",
    consulta.rerankRequestId
      ? { requestId: consulta.rerankRequestId, correlationId: consulta.rerankCorrelationId ?? consulta.rerankRequestId }
      : undefined,
    {
      parentSignal: consulta.rerankSignal,
      deadlineMs: consulta.rerankDeadlineAt
        ? Math.max(1, consulta.rerankDeadlineAt - Date.now())
        : RERANK_DEADLINE_MS,
    },
  ));
  const params: unknown[] = [
    `[${embedding.join(",")}]`,
    MODELO_EMBEDDING,
    DIMENSIONES_EMBEDDING,
    "RETRIEVAL_DOCUMENT",
  ];
  const filtro = construirFiltroDuro(consulta.filtros, params, DEFAULT_ALIASES, consulta.allowlist);
  params.push(safeLimit(BRANCH_LIMIT, 40));
  const { rows } = await pool.query<BranchRow>(
    `
      WITH candidates AS (
        SELECT DISTINCT ON (p.product_id) e.product_id, v.variant_id, 1 - (e.embedding <=> $1::vector) AS score
        FROM catalog_embeddings e
        JOIN catalog_products p ON p.product_id = e.product_id
        JOIN catalog_variants v ON v.product_id = p.product_id
         WHERE e.model = $2
           AND e.embedding_dimensions = $3
           AND e.embedding_task_type = $4
           ${filtro}
        ORDER BY p.product_id, e.embedding <=> $1::vector, v.variant_id
      )
      SELECT product_id, variant_id, score
      FROM candidates
      ORDER BY score DESC, product_id, variant_id
      LIMIT $${params.length}`,
    params,
  );
  return rows;
}

/** Controlled browse fallback for price/facet-only intents; never lists the catalog without a hard facet. */
async function queryFilterBrowse(pool: Pool, filtros: FiltrosDuros, allowlist?: CatalogAllowlist): Promise<BranchRow[]> {
  const params: unknown[] = [];
  const filtro = construirFiltroDuro(filtros, params, DEFAULT_ALIASES, allowlist);
  params.push(safeLimit(BRANCH_LIMIT, 40));
  const { rows } = await pool.query<BranchRow>(
    `
      WITH candidates AS (
        SELECT DISTINCT ON (p.product_id)
          p.product_id, v.variant_id, (1.0 / (1.0 + v.price)) AS score
        FROM catalog_products p
        JOIN catalog_variants v ON v.product_id = p.product_id
        WHERE true ${filtro}
        ORDER BY p.product_id, v.price ASC, v.variant_id
      )
      SELECT product_id, variant_id, score
      FROM candidates
      ORDER BY score DESC, product_id, variant_id
      LIMIT $${params.length}`,
    params,
  );
  return rows;
}

export async function demandByProduct(pool: Pool, productIds: string[], eligibleVariantIds: string[]): Promise<Map<string, number>> {
  if (!productIds.length || !eligibleVariantIds.length) return new Map();
  try {
    const { rows } = await pool.query<{ product_id: string; weighted_units: string }>(
      `
        WITH latest_order_snapshot AS (
          SELECT source_snapshot_id
          FROM rag_source_snapshots
          WHERE source_kind = 'order_data' AND status = 'published'
          ORDER BY published_at DESC NULLS LAST, fetched_at DESC, source_snapshot_id DESC
          LIMIT 1
        )
        SELECT d.product_id, COALESCE(SUM(d.weighted_units), 0)::text AS weighted_units
        FROM rag_order_demand_aggregates d
        JOIN latest_order_snapshot latest ON latest.source_snapshot_id = d.source_snapshot_id
        JOIN catalog_variants v ON v.variant_id = d.variant_id
        WHERE d.product_id = ANY($1::text[])
          AND d.variant_id = ANY($2::text[])
          AND v.available = true
          AND d.demand_class = 'observed_demand'
        GROUP BY d.product_id`,
      [productIds, eligibleVariantIds],
    );
    return new Map(rows.map((row) => [row.product_id, Number(row.weighted_units) || 0]));
  } catch {
    // Demand is optional during staged rollout; it is never a retrieval gate.
    return new Map();
  }
}

async function finalVariantWhitelist(
  pool: Pool,
  rankedProductIds: string[],
  filtros: FiltrosDuros | undefined,
  allowlist?: CatalogAllowlist,
): Promise<Map<string, string[]>> {
  if (!rankedProductIds.length) return new Map();
  const params: unknown[] = [rankedProductIds];
  const filtro = construirFiltroDuro(filtros, params, DEFAULT_ALIASES, allowlist);
  const { rows } = await pool.query<{ product_id: string; variant_id: string }>(
    `
      SELECT v.product_id, v.variant_id
      FROM catalog_variants v
      JOIN catalog_products p ON p.product_id = v.product_id
      WHERE v.product_id = ANY($1::text[])
        ${filtro}
      ORDER BY v.product_id, v.variant_id`,
    params,
  );
  const byProduct = new Map<string, string[]>();
  for (const row of rows) byProduct.set(row.product_id, [...(byProduct.get(row.product_id) ?? []), row.variant_id]);
  return byProduct;
}

function exactResults(rows: ExactRow[]): ResultadoRetrieval[] {
  const byProduct = new Map<string, string[]>();
  for (const row of rows) byProduct.set(row.product_id, [...(byProduct.get(row.product_id) ?? []), row.variant_id]);
  return [...byProduct.entries()].map(([productId, variantIds]) => ({
    productId,
    variantIds,
    vectorScore: 0,
    textScore: 1,
    trigramScore: 1,
    demandScore: 0,
    finalScore: Number.MAX_SAFE_INTEGER,
    reasons: ["sku_exact"],
  }));
}

/** Production retrieval façade used by chat and budget callers. */
export async function buscarHibrido(pool: Pool, consulta: ConsultaRetrieval): Promise<RespuestaRetrieval> {
  const queryText = consulta.semanticQuery.trim();
  const branchStatus: Record<string, BranchStatus> = {};
  const skuText = extraerSku(queryText);

  if (skuText) {
    const canonical = canonicalizeSku(skuText);
    const rawValues = uniqueStrings([skuText]);
    const canonicalValues = canonical ? uniqueStrings([canonical]) : [];
    const exact = await queryExact(pool, rawValues, canonicalValues, consulta.filtros, consulta.allowlist);
    const identityAmbiguous = exact.anyRows.some((row) => row.sku_ambiguous)
      || new Set(exact.anyRows.map((row) => row.variant_id)).size > 1;
    if (exact.rows.length > 0) {
      // Ambiguity is an identity property, not a side effect of availability
      // or price filters. Use the unfiltered ACTIVE existence check as well,
      // so one visible sibling can never make a duplicate SKU look unique.
      const ambiguous = identityAmbiguous || exact.rows.some((row) => row.sku_ambiguous);
      branchStatus.exact = "READY";
      return {
        query: consulta,
        results: exactResults(exact.rows).slice(0, FINAL_LIMIT),
        skuStatus: ambiguous ? "ambiguous" : "unique",
        branchStatus,
      };
    }
    branchStatus.exact = "EMPTY";
    return {
      query: consulta,
      results: [],
      skuStatus: identityAmbiguous ? "ambiguous" : exact.anyRows.length > 0 ? "filtered_out" : "not_found",
      branchStatus,
    };
  }

  if (!queryText && !tieneFiltrosNavegables(consulta.filtros)) {
    return { query: consulta, results: [], skuStatus: "not_sku", branchStatus };
  }

  const vectorScores = new Map<string, number>();
  const textScores = new Map<string, number>();
  const trigramScores = new Map<string, number>();
  const variantsByProduct = new Map<string, Set<string>>();
  const branches: RrfBranch[] = [];

  // Independent lexical branches can share one round-trip window. They still
  // apply exactly the same hard predicates before their own ranking.
  // allSettled (not all): a Postgres failure on one branch must not throw
  // away a result the other branch already got — same degrade-in-place
  // contract as the vector branch below, never a thrown, unhandled turn.
  const [ftsOutcome, trigramOutcome] = await Promise.allSettled([
    USE_FULLTEXT ? queryFullText(pool, consulta) : Promise.resolve(null),
    USE_TRIGRAM ? queryTrigram(pool, consulta) : Promise.resolve(null),
  ]);
  const ftsRows = ftsOutcome.status === "fulfilled" ? ftsOutcome.value : null;
  const trigramRows = trigramOutcome.status === "fulfilled" ? trigramOutcome.value : null;

  if (ftsRows) {
    const rows = ftsRows;
    const ranked = addBranchRows(rows, textScores, variantsByProduct);
    branches.push({ name: "fts", ids: ranked, weight: RRF_WEIGHTS.fts });
    branchStatus.fts = ranked.length ? "READY" : "EMPTY";
  } else branchStatus.fts = ftsOutcome.status === "rejected" ? "ERROR" : "SKIPPED_OPTIONAL";

  if (trigramRows) {
    const rows = trigramRows;
    const ranked = addBranchRows(rows, trigramScores, variantsByProduct);
    branches.push({ name: "trigram", ids: ranked, weight: RRF_WEIGHTS.trigram });
    branchStatus.trigram = ranked.length ? "READY" : "EMPTY";
  } else branchStatus.trigram = trigramOutcome.status === "rejected" ? "ERROR" : "SKIPPED_OPTIONAL";

  const hasPrecalculatedVector = Array.isArray(consulta.embeddingPrecalculado) && consulta.embeddingPrecalculado.length > 0;
  const vectorRequested = !consulta.embeddingFallido && USE_VECTOR;
  const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY?.trim()) || Boolean(getGeminiClient());
  const hasPythonQueryEmbedding =
    RAG_PYTHON_QUERY_EMBEDDINGS_ENABLED && seleccionarBackendPython().backend === "python";
  const skipVectorForExactSku = consultaTieneSku(consulta.semanticQuery);
  if (
    vectorRequested
    && !skipVectorForExactSku
    && (hasPrecalculatedVector || hasGeminiKey || hasPythonQueryEmbedding)
  ) {
    try {
      const rows = await queryVector(pool, consulta);
      const ranked = addBranchRows(rows, vectorScores, variantsByProduct);
      branches.push({ name: "vector", ids: ranked, weight: RRF_WEIGHTS.vector });
      branchStatus.vector = ranked.length ? "READY" : "EMPTY";
    } catch {
      branchStatus.vector = "ERROR";
    }
  } else branchStatus.vector = "SKIPPED_OPTIONAL";

  let fused: FusedEntry[] = fusionarRankingsLocal(branches);
  if (!fused.length && tieneFiltrosNavegables(consulta.filtros)) {
    const browseRows = await queryFilterBrowse(pool, consulta.filtros!, consulta.allowlist);
    const browseScores = new Map<string, number>();
    const browseVariants = new Map<string, Set<string>>();
    const browseRanked = addBranchRows(browseRows, browseScores, browseVariants);
    fused = browseRanked.map((productId) => ({ productId, score: browseScores.get(productId) ?? 0, contributions: [] }));
    branchStatus.filter_browse = browseRanked.length ? "READY" : "EMPTY";
  }
  if (!fused.length) return { query: consulta, results: [], skuStatus: "not_sku", branchStatus };

  const productIds = fused.map((entry) => entry.productId);
  const whitelist = await finalVariantWhitelist(pool, productIds, consulta.filtros, consulta.allowlist);
  const validFused = fused.filter((entry) => (whitelist.get(entry.productId)?.length ?? 0) > 0);
  if (!validFused.length) return { query: consulta, results: [], skuStatus: "not_sku", branchStatus };

  const eligibleProductIds = validFused.map((entry) => entry.productId);
  const eligibleVariantIds = validFused.flatMap((entry) => whitelist.get(entry.productId) ?? []);
  const demand = await demandByProduct(pool, eligibleProductIds, eligibleVariantIds);
  const eventEvidence = await eventEvidenceByProduct(pool, eligibleProductIds, consulta.eventIntent);

  const logDemand = new Map(validFused.map((entry) => [entry.productId, Math.log1p(demand.get(entry.productId) ?? 0)]));
  const maximumDemand = Math.max(...logDemand.values(), 0);
  const demandWeight = maximumDemand > 0 ? 0.0001 : 0;
  const sortedResults = validFused
    .map((entry): ResultadoRetrieval => {
      const demandScore = maximumDemand > 0 ? ((logDemand.get(entry.productId) ?? 0) / maximumDemand) * demandWeight : 0;
      const evidence = eventEvidence.get(entry.productId);
      // Tiny additive boost: exact/theme wins ties and nearby generic items can
      // still complete the composition. Evidence never gates eligibility.
      const eventScore = evidence?.match_level === "exact_event"
        ? 0.004
        : evidence?.match_level === "thematic"
          ? 0.0015
          : 0;
      return {
        productId: entry.productId,
        variantIds: whitelist.get(entry.productId) ?? [],
        vectorScore: vectorScores.get(entry.productId) ?? 0,
        textScore: textScores.get(entry.productId) ?? 0,
        trigramScore: trigramScores.get(entry.productId) ?? 0,
        demandScore,
        finalScore: entry.score + demandScore + eventScore,
        reasons: [
          ...entry.contributions.map((contribution) => contribution.branch),
          ...(evidence ? [`event_${evidence.match_level}`] : []),
        ],
        rrfContributions: entry.contributions,
        eventEvidence: evidence,
      };
    })
    .sort((left, right) => right.finalScore - left.finalScore || right.demandScore! - left.demandScore! || left.productId.localeCompare(right.productId))
  const reranked = await rerankResults(pool, consulta, sortedResults);
  branchStatus.rerank = reranked.status;
  const results = reranked.results.slice(0, FINAL_LIMIT);

  return { query: consulta, results, skuStatus: "not_sku", branchStatus };
}

export type { RrfContribution };
