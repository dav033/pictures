import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { Pool } from "pg";
import type { ConsultaRetrieval } from "../src/lib/rag/retrieval/types";
import type { CuotaPlan } from "../src/lib/rag/presupuesto/plan";

for (const archivo of [".env.local", ".env"]) {
  if (existsSync(archivo)) process.loadEnvFile(archivo);
}

type Options = { noKey: boolean; smoke: boolean };

function parseArgs(argv: string[]): Options {
  return { noKey: argv.includes("--no-key"), smoke: argv.includes("--smoke") };
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.min(ordered.length - 1, Math.ceil((p / 100) * ordered.length) - 1);
  return ordered[Math.max(index, 0)];
}

async function explain(pool: Pool, label: string, sql: string, params: unknown[]): Promise<void> {
  const { rows } = await pool.query<{ "QUERY PLAN": unknown }>(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, params);
  const document = (rows[0]?.["QUERY PLAN"] as Array<Record<string, unknown>> | undefined)?.[0] ?? {};
  const nodes: string[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const value = node as Record<string, unknown>;
    if (value["Node Type"]) nodes.push(`${String(value["Node Type"])}${value["Index Name"] ? `/${String(value["Index Name"])}` : ""}`);
    if (Array.isArray(value.Plans)) for (const child of value.Plans) visit(child);
  };
  visit(document.Plan);
  console.log(`[PLAN] ${label} nodes=${nodes.join(" -> ")} actual=${String(document["Execution Time"] ?? "?")}ms`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.noKey) {
    process.env.GEMINI_API_KEY = "";
    process.env.RAG_USE_VECTOR = "false";
  }
  const [{ buscarHibrido, demandByProduct }, { buscarPorRol }, { buscarCatalogoRag }, { buscarCatalogoRagConPresupuesto, embeddingOpcional }, { FRANJAS }] = await Promise.all([
    import("../src/lib/rag/retrieval/search"),
    import("../src/lib/rag/retrieval/por-rol"),
    import("../src/lib/rag/chat/buscar"),
    import("../src/lib/rag/chat/buscar-presupuesto"),
    import("../src/lib/rag/presupuesto/franjas"),
  ]);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const iterations = options.smoke ? 3 : 10;
  const latencies: Array<{ label: string; ms: number }> = [];

  try {
    const uniqueSku = await pool.query<{ sku_original: string; variant_id: string; product_id: string }>(
      `SELECT sku_original, variant_id, product_id
       FROM catalog_variants
       WHERE sku_original IS NOT NULL AND sku_original <> '' AND sku_ambiguous = false
       ORDER BY variant_id LIMIT 1`,
    );
    assert.ok(uniqueSku.rows[0], "catalog must contain an original SKU");
    const duplicateSku = await pool.query<{ sku_original: string; sku_canonical: string; variant_ids: string[] }>(
      `SELECT min(sku_original) AS sku_original, sku_canonical, array_agg(variant_id ORDER BY variant_id) AS variant_ids
       FROM catalog_variants
       WHERE sku_canonical IS NOT NULL
       GROUP BY sku_canonical
       HAVING COUNT(*) > 1
       ORDER BY sku_canonical LIMIT 1`,
    );
    const product = await pool.query<{ product_id: string; title: string; variant_id: string; price: string; forma: string | null; diam_pulg: string | null }>(
      `SELECT p.product_id, p.title, v.variant_id, v.price::text, v.forma, v.diam_pulg::text
       FROM catalog_products p JOIN catalog_variants v ON v.product_id = p.product_id
       WHERE p.status = 'ACTIVE' AND p.available = true AND v.available = true
         AND v.forma IS NOT NULL AND v.diam_pulg IS NOT NULL
         AND EXISTS (SELECT 1 FROM catalog_variants expensive WHERE expensive.product_id=p.product_id AND expensive.available=true AND expensive.price > v.price)
       ORDER BY CASE WHEN v.forma='redondo' AND v.diam_pulg=12 THEN 0 WHEN v.forma='corazon' THEN 1 ELSE 2 END, p.product_id, v.variant_id LIMIT 1`,
    );
    assert.ok(product.rows[0], "catalog must contain an available variant");
    const sample = product.rows[0];
    const heartSample = await pool.query<{ title: string; variant_id: string }>(
      `SELECT p.title, v.variant_id FROM catalog_products p JOIN catalog_variants v ON v.product_id=p.product_id
       WHERE p.status='ACTIVE' AND v.available=true AND v.forma='corazon' ORDER BY p.product_id, v.variant_id LIMIT 1`,
    );
    const unavailableSku = await pool.query<{ sku_original: string }>(
      `SELECT sku_original FROM catalog_variants WHERE sku_original IS NOT NULL AND available=false ORDER BY variant_id LIMIT 1`,
    );
    const budgetSample = await pool.query<{ title: string; price: string }>(
      `SELECT p.title, v.price::text FROM catalog_products p JOIN catalog_variants v ON v.product_id=p.product_id
       WHERE p.status='ACTIVE' AND p.available=true AND v.available=true AND p.derived->>'category'='globo_latex'
       ORDER BY p.product_id, v.variant_id LIMIT 1`,
    );
    const filters: ConsultaRetrieval = {
      semanticQuery: sample.title,
      filtros: {
        disponible: true,
        precioMax: Number(sample.price),
        ...(sample.forma ? { formas: [sample.forma] } : {}),
        ...(sample.diam_pulg ? { diametrosPulgadas: [Number(sample.diam_pulg)] } : {}),
      },
    };
    const diameterOnly: ConsultaRetrieval | null = sample.diam_pulg
      ? { semanticQuery: sample.title, filtros: { disponible: true, diametrosPulgadas: [Number(sample.diam_pulg)] } }
      : null;

    const cases: Array<{ label: string; query: ConsultaRetrieval }> = [
      { label: "fts-name", query: { semanticQuery: sample.title, filtros: { disponible: true } } },
      { label: "trigram-typo", query: { semanticQuery: `${sample.title.slice(0, Math.max(3, Math.floor(sample.title.length / 2)))} xyz`, filtros: { disponible: true } } },
      { label: "same-variant-filters", query: filters },
      ...(diameterOnly ? [{ label: "diameter-implies-round", query: diameterOnly }] : []),
      { label: "price-only-browse", query: { semanticQuery: "", filtros: { disponible: true, precioMax: Number(sample.price) } } },
      { label: "missing-sku", query: { semanticQuery: "SKU-INEXISTENTE-000000", filtros: { disponible: true } } },
    ];
    for (const run of Array.from({ length: iterations }, () => cases).flat()) {
      const started = performance.now();
      const response = await buscarHibrido(pool, run.query);
      latencies.push({ label: run.label, ms: performance.now() - started });
      assert.ok(response.results.every((result) => result.productId.length > 0 && result.variantIds.length > 0), `${run.label} returned an empty whitelist`);
      if (run.label === "missing-sku") {
        assert.equal(response.results.length, 0, "missing SKU must not fall back to semantic retrieval");
        assert.equal(response.skuStatus, "not_found");
      }
      if (run.label === "price-only-browse") {
        assert.ok(response.results.length > 0, "price-only hard filter must browse real variants");
        const ids = response.results.flatMap((result) => result.variantIds);
        const rows = await pool.query<{ price: string }>("SELECT price::text FROM catalog_variants WHERE variant_id = ANY($1::text[])", [ids]);
        assert.ok(rows.rows.every((row) => Number(row.price) <= Number(sample.price)), "price-only browse leaked an over-budget variant");
      }
      if (options.noKey && run.label !== "missing-sku") assert.equal(response.branchStatus?.vector, "SKIPPED_OPTIONAL");
    }

    const exact = await buscarHibrido(pool, { semanticQuery: uniqueSku.rows[0].sku_original, filtros: { disponible: false } });
    assert.equal(exact.skuStatus, "unique", "source SKU should resolve uniquely");
    assert.deepEqual(exact.results[0]?.variantIds, [uniqueSku.rows[0].variant_id], "exact SKU must whitelist only its variant");
    const conversationalExact = await buscarHibrido(pool, { semanticQuery: `Necesito el SKU ${uniqueSku.rows[0].sku_original}`, filtros: { disponible: false } });
    assert.equal(conversationalExact.skuStatus, "unique", "SKU embedded in a sentence must remain exact");
    const canonicalExact = await pool.query<{ sku_canonical: string }>("SELECT sku_canonical FROM catalog_variants WHERE variant_id=$1", [uniqueSku.rows[0].variant_id]);
    const canonicalResult = await buscarHibrido(pool, { semanticQuery: canonicalExact.rows[0].sku_canonical, filtros: { disponible: false } });
    assert.equal(canonicalResult.skuStatus, "unique", "canonical SKU must resolve its original variant");
    if (unavailableSku.rows[0]) {
      const filteredOut = await buscarHibrido(pool, { semanticQuery: unavailableSku.rows[0].sku_original, filtros: { disponible: true } });
      assert.equal(filteredOut.skuStatus, "filtered_out", "unavailable exact SKU must not become semantic search");
      assert.equal(filteredOut.results.length, 0);
    }

    if (duplicateSku.rows[0]) {
      const ambiguous = await buscarHibrido(pool, { semanticQuery: duplicateSku.rows[0].sku_original, filtros: { disponible: false } });
      assert.equal(ambiguous.skuStatus, "ambiguous", "duplicate canonical SKU must be explicit");
      assert.deepEqual(ambiguous.results.flatMap((result) => result.variantIds).sort(), duplicateSku.rows[0].variant_ids.sort(), "ambiguous SKU must return all and only exact variants");
      const ambiguousChat = await buscarCatalogoRag(pool, `Necesito el SKU ${duplicateSku.rows[0].sku_original}`);
      assert.equal(ambiguousChat.status, "AMBIGUOUS_SKU", "chat caller must not expose an ambiguous SKU as OK");
      assert.equal(ambiguousChat.skuStatus, "ambiguous");
      assert.deepEqual(ambiguousChat.candidatos, [], "ambiguous SKU chat result must have no selectable candidates");
    }
    const requiredAmbiguous = await pool.query<{ variant_id: string }>(
      "SELECT variant_id FROM catalog_variants WHERE UPPER(sku_original)='B2B-20008459' ORDER BY variant_id",
    );
    if (requiredAmbiguous.rows.length > 1) {
      const explicitAmbiguous = await buscarHibrido(pool, { semanticQuery: "B2B-20008459", filtros: { disponible: false } });
      assert.equal(explicitAmbiguous.skuStatus, "ambiguous", "B2B-20008459 must remain explicitly ambiguous");
      assert.deepEqual(explicitAmbiguous.results.flatMap((result) => result.variantIds).sort(), requiredAmbiguous.rows.map((row) => row.variant_id).sort());
      const explicitChat = await buscarCatalogoRag(pool, "B2B-20008459");
      assert.equal(explicitChat.status, "AMBIGUOUS_SKU");
      assert.equal(explicitChat.skuStatus, "ambiguous");
      assert.equal(explicitChat.candidatos.length, 0);
      const explicitBudget = await buscarCatalogoRagConPresupuesto(pool, "B2B-20008459", FRANJAS.detalle, undefined);
      assert.equal(explicitBudget.status, "AMBIGUOUS_SKU", "budget caller must stop on an ambiguous SKU");
      assert.equal(explicitBudget.skuStatus, "ambiguous");
      assert.deepEqual(explicitBudget.poolPorRol, {});
    }
    const shortB2b = await pool.query<{ variant_id: string }>("SELECT variant_id FROM catalog_variants WHERE UPPER(sku_original)='B2B-AMOR1'");
    if (shortB2b.rows.length === 1) {
      const shortExact = await buscarHibrido(pool, { semanticQuery: "B2B-AMOR1", filtros: { disponible: false } });
      assert.equal(shortExact.skuStatus, "unique", "five-character B2B suffix must remain an exact SKU");
      assert.deepEqual(shortExact.results.flatMap((result) => result.variantIds), [shortB2b.rows[0].variant_id]);
    }

    const budgetQuota: CuotaPlan = {
      rol: "relleno",
      min: 1,
      max: 2,
      topeCop: 100_000,
      categorias: ["globo_latex"],
      categoriasRelajacion: [],
    };
    const budgetStarted = performance.now();
    const budget = await buscarPorRol(pool, budgetSample.rows[0]?.title ?? sample.title, undefined, budgetQuota, { disponible: true });
    console.log(`[CALLER] presupuesto/rol candidates=${budget.candidatos.length} latency=${(performance.now() - budgetStarted).toFixed(1)}ms`);
    assert.ok(budget.candidatos.length > 0, "budget role caller must return a real catalog candidate without Gemini");
    const previousVector = process.env.RAG_USE_VECTOR;
    const previousKey = process.env.GEMINI_API_KEY;
    process.env.RAG_USE_VECTOR = "true";
    process.env.GEMINI_API_KEY = "invalid-key-for-rag-smoke";
    assert.equal(await embeddingOpcional("prueba de embedding inválido"), undefined, "invalid Gemini key must fall back to lexical retrieval");
    const invalidKeyBudget = await buscarCatalogoRagConPresupuesto(pool, budgetSample.rows[0]?.title ?? sample.title, FRANJAS.detalle, undefined);
    assert.ok(["OK", "NO_MATCH", "AMBIGUOUS_SKU"].includes(invalidKeyBudget.status), "invalid embedding key must not throw from budget caller");
    if (previousVector === undefined) delete process.env.RAG_USE_VECTOR; else process.env.RAG_USE_VECTOR = previousVector;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousKey;
    const catalogCaller = await buscarCatalogoRag(pool, sample.title);
    assert.equal(catalogCaller.status, "OK", "catalog chat caller must remain available without Gemini");
    const proseSku = await buscarHibrido(pool, {
      semanticQuery: "Busco B2b Bouquet Globo Latex R12",
      filtros: { disponible: true },
    });
    assert.notEqual(proseSku.skuStatus, "not_found", "natural B2b Bouquet prose must not be treated as an SKU");
    assert.notEqual(proseSku.branchStatus?.exact, "EMPTY", "natural B2b Bouquet prose must use lexical retrieval");
    assert.ok(proseSku.results.length > 0, "B2b Bouquet prose must retain lexical recall");

    if (heartSample.rows[0]) {
      const heart = await buscarHibrido(pool, { semanticQuery: heartSample.rows[0].title, filtros: { disponible: true, formas: ["corazon"] } });
      assert.ok(heart.results.some((result) => result.variantIds.length > 0), "heart taxonomy should be retrievable");
    }

    const filteredResponse = await buscarHibrido(pool, filters);
    for (const result of filteredResponse.results) {
      for (const variantId of result.variantIds) {
        const row = await pool.query<{ available: boolean; price: string; forma: string | null; diam_pulg: string | null }>(
          "SELECT v.available, v.price::text, v.forma, v.diam_pulg::text FROM catalog_variants v JOIN catalog_products p ON p.product_id=v.product_id WHERE v.variant_id=$1 AND p.status='ACTIVE'",
          [variantId],
        );
        const variant = row.rows[0];
        assert.ok(variant && variant.available, "final whitelist leaked unavailable variant");
        assert.ok(Number(variant.price) <= Number(sample.price), "final whitelist leaked over-budget variant");
        if (sample.forma) assert.equal(variant.forma, sample.forma, "final whitelist leaked another shape");
        if (sample.diam_pulg) {
          assert.equal(Number(variant.diam_pulg), Number(sample.diam_pulg), "final whitelist leaked another diameter");
        }
      }
    }
    if (diameterOnly) {
      const diameterResponse = await buscarHibrido(pool, diameterOnly);
      for (const result of diameterResponse.results) {
        const rows = await pool.query<{ forma: string | null }>("SELECT forma FROM catalog_variants WHERE variant_id = ANY($1::text[])", [result.variantIds]);
        assert.ok(rows.rows.every((row) => row.forma === "redondo"), "diameter-only filter must imply round shape");
      }
    }

    const diameter40 = await pool.query<{ title: string; variant_id: string }>(
      `SELECT p.title, v.variant_id
       FROM catalog_products p JOIN catalog_variants v ON v.product_id=p.product_id
       WHERE p.status='ACTIVE' AND v.diam_pulg=40
       ORDER BY p.product_id, v.variant_id LIMIT 1`,
    );
    assert.ok(diameter40.rows[0], "source catalog must contain a real 40-inch variant");
    const forty = await buscarHibrido(pool, { semanticQuery: diameter40.rows[0].title, filtros: { disponible: false, diametrosPulgadas: [40] } });
    assert.ok(forty.results.length > 0, "40-inch hard filter must retrieve a source variant");
    const fortyVariants = await pool.query<{ forma: string | null; diam_pulg: string | null }>("SELECT forma, diam_pulg::text FROM catalog_variants WHERE variant_id = ANY($1::text[])", [forty.results.flatMap((result) => result.variantIds)]);
    assert.ok(fortyVariants.rows.every((row) => row.forma === "redondo" && Number(row.diam_pulg) === 40), "40-inch filter leaked another variant shape/diameter");

    const cucharaSource = await pool.query<{ title: string; variant_id: string }>(
      "SELECT p.title, v.variant_id FROM catalog_products p JOIN catalog_variants v ON v.product_id=p.product_id WHERE p.product_id='8634207076647' AND v.title LIKE 'ESCARCHADA%' LIMIT 1",
    );
    assert.ok(cucharaSource.rows[0], "Cuchara Deluxe ground-truth product must be present");
    const cuchara = await buscarHibrido(pool, {
      semanticQuery: cucharaSource.rows[0].title,
      filtros: { disponible: true, colores: ["rojo"], precioMax: 10_000 },
    });
    const cucharaVariantIds = cuchara.results.flatMap((result) => result.variantIds);
    const cucharaRows = await pool.query<{ title: string; available: boolean; derived_colors: string[] }>("SELECT title, available, derived_colors FROM catalog_variants WHERE variant_id = ANY($1::text[])", [cucharaVariantIds]);
    assert.ok(cucharaRows.rows.every((row) => row.available && row.derived_colors.includes("rojo") && !row.title.includes("ESCARCHADA")), "variant color filter leaked ESCARCHADA or another color");
    assert.ok(!cucharaVariantIds.includes(cucharaSource.rows[0].variant_id), "unavailable ESCARCHADA sibling must never enter a red color whitelist");

    const latestDemand = await pool.query<{ source_snapshot_id: string; weighted_units: string }>(
      `WITH latest AS (
         SELECT source_snapshot_id FROM rag_source_snapshots
         WHERE source_kind='order_data' AND status='published'
         ORDER BY published_at DESC NULLS LAST, fetched_at DESC, source_snapshot_id DESC LIMIT 1)
       SELECT d.source_snapshot_id, COALESCE(SUM(d.weighted_units),0)::text AS weighted_units
       FROM rag_order_demand_aggregates d JOIN latest l ON l.source_snapshot_id=d.source_snapshot_id
       JOIN catalog_variants v ON v.variant_id=d.variant_id
       WHERE v.available=true AND d.demand_class='observed_demand'
       GROUP BY d.source_snapshot_id`,
    );
    const eligibleDemandVariants = filteredResponse.results.flatMap((result) => result.variantIds);
    const latestDemandAll = await pool.query<{ product_id: string; weighted_units: string }>(
      `WITH latest AS (
         SELECT source_snapshot_id FROM rag_source_snapshots
         WHERE source_kind='order_data' AND status='published'
         ORDER BY published_at DESC NULLS LAST, fetched_at DESC, source_snapshot_id DESC LIMIT 1)
       SELECT d.product_id, COALESCE(SUM(d.weighted_units),0)::text AS weighted_units
       FROM rag_order_demand_aggregates d JOIN latest l ON l.source_snapshot_id=d.source_snapshot_id
       JOIN catalog_variants v ON v.variant_id=d.variant_id
       WHERE d.variant_id = ANY($1::text[]) AND v.available=true AND d.demand_class='observed_demand'
       GROUP BY d.product_id`,
      [eligibleDemandVariants],
    );
    const productionDemand = await demandByProduct(
      pool,
      filteredResponse.results.map((result) => result.productId),
      eligibleDemandVariants,
    );
    assert.ok(latestDemand.rows.length <= 1, "demand smoke must use one latest published order snapshot");
    assert.ok(latestDemandAll.rows.every((row) => Number(row.weighted_units) >= 0), "demand fixture must remain non-negative");
    assert.deepEqual(
      [...productionDemand.entries()].sort(),
      latestDemandAll.rows.map((row) => [row.product_id, Number(row.weighted_units)] as [string, number]).sort(),
      "production demand must equal latest snapshot and eligible variant whitelist only",
    );

    await explain(pool, "fts", "SELECT p.product_id FROM catalog_products p WHERE p.search_tsv @@ plainto_tsquery('spanish_unaccent', $1) ORDER BY p.product_id LIMIT 40", [sample.title]);
    await explain(pool, "trigram-production-title", `WITH title_candidates AS (
      SELECT p.product_id, v.variant_id, similarity(COALESCE(p.title, ''), $1) AS score
      FROM catalog_products p JOIN catalog_variants v ON v.product_id=p.product_id
      WHERE p.title % $1 AND similarity(COALESCE(p.title, ''), $1) >= $2::real
        AND p.status='ACTIVE' AND p.available=true AND v.available=true
      ORDER BY p.title <-> $1, p.product_id, v.variant_id LIMIT 80
    ), handle_candidates AS (
      SELECT p.product_id, v.variant_id, similarity(COALESCE(p.handle, ''), $1) AS score
      FROM catalog_products p JOIN catalog_variants v ON v.product_id=p.product_id
      WHERE p.handle % $1 AND similarity(COALESCE(p.handle, ''), $1) >= $2::real
        AND p.status='ACTIVE' AND p.available=true AND v.available=true
      ORDER BY p.handle <-> $1, p.product_id, v.variant_id LIMIT 80
    ), candidates AS (
      SELECT DISTINCT ON (product_id) product_id, variant_id, score
      FROM (SELECT * FROM title_candidates UNION ALL SELECT * FROM handle_candidates) c
      ORDER BY product_id, score DESC, variant_id
    ) SELECT product_id, variant_id, score FROM candidates ORDER BY score DESC, product_id, variant_id LIMIT 40`, [sample.title, 0.3]);
    await explain(pool, "exact-sku", "SELECT variant_id FROM catalog_variants WHERE UPPER(sku_original)=UPPER($1)", [uniqueSku.rows[0].sku_original]);
    await explain(pool, "same-variant-filter", "SELECT v.variant_id FROM catalog_variants v JOIN catalog_products p ON p.product_id=v.product_id WHERE p.status='ACTIVE' AND p.available=true AND v.available=true AND v.price <= $1 AND v.forma=$2", [Number(sample.price), sample.forma]);

    const byLabel = new Map<string, number[]>();
    for (const latency of latencies) byLabel.set(latency.label, [...(byLabel.get(latency.label) ?? []), latency.ms]);
    for (const [label, values] of byLabel) {
      const p50 = percentile(values, 50);
      const p95 = percentile(values, 95);
      console.log(`[LATENCY] ${label} n=${values.length} p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms`);
      assert.ok(p50 <= 500, `${label} p50 exceeded 500ms`);
      assert.ok(p95 <= 2100, `${label} p95 exceeded 2100ms`);
      console.log(`[GATE] ${label} p50<=500ms=PASS p95<=2100ms=PASS`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`[FAIL] retrieval benchmark: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
