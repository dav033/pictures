import { existsSync, readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { Pool } from "pg";
import type { ConsultaRetrieval, RespuestaRetrieval } from "../src/lib/rag/retrieval/types";
import type { SeleccionSolicitada } from "../src/lib/rag/chat/validar";

for (const archivo of [".env.local", ".env"]) {
  if (existsSync(archivo)) process.loadEnvFile(archivo);
}

type Options = { noKey: boolean; withGemini: boolean; baselineMs?: number };
type VariantRow = {
  product_id: string;
  variant_id: string;
  title: string | null;
  sku_original: string | null;
  sku_canonical: string | null;
  price: string;
  available: boolean;
  forma: string | null;
  diam_pulg: string | null;
  colors: string[];
};
type ProductRow = {
  product_id: string;
  title: string;
  available: boolean;
  colors: string[];
  forma: string | null;
  diam_pulg: string | null;
  variant_id: string;
  sku_original: string | null;
  sku_canonical: string | null;
  price: string;
};
type AmbiguousRow = { sku_original: string; sku_canonical: string; variant_ids: string[] };

function parseArgs(argv: string[]): Options {
  const noKey = argv.includes("--no-key");
  const withGemini = argv.includes("--with-gemini");
  if (noKey && withGemini) throw new Error("elige solo --no-key o --with-gemini");
  const inlineBaseline = argv.find((arg) => arg.startsWith("--baseline="))?.slice("--baseline=".length);
  const baselineIndex = argv.indexOf("--baseline");
  const positionalBaseline = baselineIndex >= 0 ? argv[baselineIndex + 1] : undefined;
  const rawBaseline = inlineBaseline ?? positionalBaseline;
  if (rawBaseline == null) return { noKey, withGemini };
  const baselineMs = Number(rawBaseline);
  if (!Number.isFinite(baselineMs) || baselineMs <= 0) throw new Error("--baseline debe ser milisegundos positivos");
  return { noKey, withGemini, baselineMs };
}

function readVersionedBaseline(explicit: number | undefined): number | undefined {
  if (explicit != null) return explicit;
  const fromEnv = Number(process.env.RAG_E2E_BASELINE_P95_MS ?? "");
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  if (existsSync("release-manifest.json")) {
    try {
      const manifest = JSON.parse(readFileSync("release-manifest.json", "utf8")) as { rag?: { e2e?: { baseline_p95_ms?: unknown } } };
      const value = Number(manifest.rag?.e2e?.baseline_p95_ms);
      if (Number.isFinite(value) && value > 0) return value;
    } catch {
      // A malformed release manifest is reported by the release gate, not by
      // leaking its contents into an E2E log.
    }
  }
  if (existsSync("reports/rag-baseline-v2.md")) {
    const text = readFileSync("reports/rag-baseline-v2.md", "utf8");
    const match = text.match(/(?:e2e|end-to-end)[^\n]{0,100}?p95[^\d]{0,20}(\d+(?:\.\d+)?)\s*ms/i);
    const value = Number(match?.[1]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return undefined;
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/postgres(?:ql)?:\/\/[^\s)]+/gi, "postgresql://<redacted>")
    .replace(/(?:api[_-]?key|secret|password)\s*[:=]\s*[^\s,;]+/gi, "$1=<redacted>");
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.max(0, Math.ceil((p / 100) * ordered.length) - 1))];
}

class Gate {
  failures = 0;
  blocked = 0;
  skipped = 0;

  pass(name: string, detail: string): void {
    console.log(`[PASS] ${name} — ${detail}`);
  }

  fail(name: string, detail: string): void {
    this.failures++;
    console.log(`[FAIL] ${name} — ${detail}`);
  }

  check(condition: boolean, name: string, detail: string): void {
    if (condition) this.pass(name, detail);
    else this.fail(name, detail);
  }

  block(name: string, detail: string): void {
    this.blocked++;
    console.log(`[BLOCKED] ${name} — ${detail}`);
  }

  skip(name: string, detail: string): void {
    this.skipped++;
    console.log(`[SKIPPED_OPTIONAL] ${name} — ${detail}`);
  }
}

function idsFromResponse(response: RespuestaRetrieval): string[] {
  return response.results.flatMap((result) => result.variantIds);
}

async function loadVariants(pool: Pool, variantIds: string[]): Promise<VariantRow[]> {
  if (variantIds.length === 0) return [];
  const { rows } = await pool.query<VariantRow>(
    `SELECT v.product_id, v.variant_id, v.title, v.sku_original, v.sku_canonical,
            v.price::text, v.available, v.forma, v.diam_pulg::text,
            COALESCE(
              CASE WHEN jsonb_typeof(to_jsonb(v)->'derived_colors') = 'array'
                          AND jsonb_array_length(to_jsonb(v)->'derived_colors') > 0
                   THEN to_jsonb(v)->'derived_colors' END,
              CASE WHEN jsonb_array_length(COALESCE(p.derived->'colors','[]'::jsonb)) = 1
                   THEN p.derived->'colors' ELSE '[]'::jsonb END
            ) AS colors
       FROM catalog_variants v
       JOIN catalog_products p ON p.product_id = v.product_id
      WHERE variant_id = ANY($1::text[])`,
    [variantIds],
  );
  return rows;
}

async function assertRealWhitelist(
  pool: Pool,
  gate: Gate,
  name: string,
  response: RespuestaRetrieval,
  requireResults = true,
): Promise<VariantRow[]> {
  const variantIds = idsFromResponse(response);
  const productIds = new Set(response.results.map((result) => result.productId));
  const rows = await loadVariants(pool, variantIds);
  const rowById = new Map(rows.map((row) => [row.variant_id, row]));
  const allReal = rows.length === variantIds.length && variantIds.every((id) => rowById.has(id));
  const allBelong = rows.every((row) => productIds.has(row.product_id));
  const nonEmpty = !requireResults || response.results.length > 0;
  gate.check(nonEmpty && allReal && allBelong, name, `productos=${response.results.length}, variantes=${variantIds.length}`);
  return rows;
}

function assertSameVariantFilters(
  gate: Gate,
  name: string,
  rows: VariantRow[],
  filters: { available?: boolean; priceMax?: number; forma?: string; diameter?: number },
): void {
  const valid = rows.every((row) =>
    (filters.available == null || row.available === filters.available) &&
    (filters.priceMax == null || Number(row.price) <= filters.priceMax) &&
    (filters.forma == null || row.forma === filters.forma) &&
    (filters.diameter == null || Number(row.diam_pulg) === filters.diameter),
  );
  gate.check(valid, name, `variantes_verificadas=${rows.length}`);
}

function assertColorWhitelist(gate: Gate, name: string, rows: VariantRow[], color: string): void {
  const valid = rows.length > 0 && rows.every((row) => row.colors.includes(color));
  gate.check(valid, name, `color=${color}, variantes_verificadas=${rows.length}`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.noKey) {
    process.env.GEMINI_API_KEY = "";
    process.env.RAG_USE_VECTOR = "false";
  } else if (options.withGemini && !process.env.GEMINI_API_KEY?.trim()) {
    console.log("[SKIPPED_OPTIONAL] Gemini/vector — --with-gemini solicitado pero no hay key; se ejecutará únicamente el gate no-key");
    process.env.RAG_USE_VECTOR = "false";
  }

  const gate = new Gate();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    gate.block("DATABASE_URL", "no configurada; copia .env.example a .env.local o pásala en el entorno");
    process.exitCode = 1;
    return;
  }

  // Dynamic imports keep module-level flags (RAG_USE_VECTOR, Gemini) aligned
  // with --no-key before production retrieval code is loaded.
  const [parserModule, searchModule, browseModule, validationModule, budgetModule, budgetConstants, resolverModule] = await Promise.all([
    import("../src/lib/rag/query-parser/parse"),
    import("../src/lib/rag/retrieval/search"),
    import("../src/lib/rag/chat/buscar"),
    import("../src/lib/rag/chat/validar"),
    import("../src/lib/rag/chat/buscar-presupuesto"),
    import("../src/lib/rag/presupuesto/franjas"),
    import("../src/lib/rag/tamanos/resolver"),
  ]);
  const pool = new Pool({ connectionString: databaseUrl, max: 6, connectionTimeoutMillis: 3_000 });

  try {
    const health = await pool.query<{ one: number }>("SELECT 1 AS one");
    gate.check(health.rows[0]?.one === 1, "health/postgres", "SELECT 1 respondió");

    const tables = await pool.query<{ name: string | null }>(
      `SELECT to_regclass(name)::text AS name
         FROM unnest($1::text[]) AS names(name)`,
      [["catalog_products", "catalog_variants", "rag_source_snapshots", "rag_order_demand_aggregates"]],
    );
    const tableNames = new Set(tables.rows.map((row) => row.name).filter((name): name is string => Boolean(name)));
    gate.check(tableNames.has("catalog_products") && tableNames.has("catalog_variants"), "health/catalog-schema", "tablas activas presentes");
    gate.check(tableNames.has("rag_source_snapshots"), "health/source-audit", "auditoría de snapshots presente");
    const variantColorColumn = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'catalog_variants' AND column_name = 'derived_colors'
       ) AS exists`,
    );
    const hasVariantColors = Boolean(variantColorColumn.rows[0]?.exists);
    if (hasVariantColors) gate.pass("health/variant-colors", "evidencia por variante disponible");
    else gate.block("health/variant-colors", "falta catalog_variants.derived_colors requerido por filtros de color same-variant");
    if (!tableNames.has("rag_order_demand_aggregates")) gate.skip("health/order-demand", "agregados opcionales aún no instalados");
    else gate.pass("health/order-demand", "tabla de demanda agregada presente");

    const extensions = await pool.query<{ extname: string }>("SELECT extname FROM pg_extension WHERE extname = ANY($1::text[])", [["unaccent", "pg_trgm", "vector"]]);
    const extensionNames = new Set(extensions.rows.map((row) => row.extname));
    gate.check(extensionNames.has("unaccent"), "health/unaccent", "extensión requerida presente");
    if (process.env.RAG_USE_TRIGRAM !== "false") gate.check(extensionNames.has("pg_trgm"), "health/pg_trgm", "extensión requerida por la rama trigram presente");
    else gate.skip("health/pg_trgm", "RAG_USE_TRIGRAM=false");
    if (options.withGemini && process.env.GEMINI_API_KEY?.trim()) {
      if (extensionNames.has("vector")) gate.pass("health/vector", "extensión opcional presente");
      else gate.skip("health/vector", "Gemini disponible pero pgvector no está instalado");
    } else gate.skip("health/vector", "vector/Gemini opcional sin key");

    const snapshots = await pool.query<{ source_kind: string; status: string; count: string }>(
      `SELECT source_kind, status, COUNT(*)::text AS count
         FROM rag_source_snapshots
        WHERE source_kind = ANY($1::text[])
        GROUP BY source_kind, status`,
      [["products_catalog", "order_data"]],
    );
    gate.check(snapshots.rows.some((row) => row.source_kind === "products_catalog" && row.status === "published"), "health/products-snapshot", "snapshot de catálogo publicado");
    if (tableNames.has("rag_order_demand_aggregates")) {
      gate.check(snapshots.rows.some((row) => row.source_kind === "order_data" && row.status === "published"), "health/orders-snapshot", "snapshot de demanda publicado");
    }

    const unique = await pool.query<ProductRow>(
      `SELECT p.product_id, p.title, p.available,
              COALESCE(p.derived->'colors','[]'::jsonb)::text::jsonb AS colors,
              v.forma, v.diam_pulg::text, v.variant_id, v.sku_original,
              v.sku_canonical, v.price::text
         FROM catalog_products p
         JOIN catalog_variants v ON v.product_id = p.product_id
        WHERE p.status = 'ACTIVE'
          AND v.available = true
          AND v.sku_original IS NOT NULL
          AND BTRIM(v.sku_original) <> ''
          AND COALESCE(v.sku_ambiguous, false) = false
        ORDER BY v.variant_id
        LIMIT 1`,
    );
    const uniqueRow = unique.rows[0];
    gate.check(Boolean(uniqueRow?.sku_original && uniqueRow.sku_canonical), "fixture/unique-sku", "SKU original y canónico disponibles");

    const ambiguous = await pool.query<AmbiguousRow>(
      `SELECT MIN(sku_original) AS sku_original, sku_canonical,
              array_agg(variant_id ORDER BY variant_id) AS variant_ids
         FROM catalog_variants
        WHERE sku_canonical IS NOT NULL
        GROUP BY sku_canonical
       HAVING COUNT(*) > 1
        ORDER BY sku_canonical
        LIMIT 1`,
    );
    const ambiguousRow = ambiguous.rows[0];
    gate.check(Boolean(ambiguousRow?.sku_original && ambiguousRow.variant_ids.length > 1), "fixture/ambiguous-sku", "grupo duplicado disponible para prueba");

    const sameVariant = await pool.query<ProductRow>(
      `SELECT p.product_id, p.title, p.available,
              COALESCE(p.derived->'colors','[]'::jsonb)::text::jsonb AS colors,
              v.forma, v.diam_pulg::text, v.variant_id, v.sku_original,
              v.sku_canonical, v.price::text
         FROM catalog_products p
         JOIN catalog_variants v ON v.product_id = p.product_id
        WHERE p.status = 'ACTIVE' AND p.available = true AND v.available = true
          AND v.forma IS NOT NULL AND v.diam_pulg IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM catalog_variants sibling
             WHERE sibling.product_id = v.product_id
               AND sibling.available = true
               AND sibling.price > v.price
          )
        ORDER BY p.product_id, v.price, v.variant_id
        LIMIT 1`,
    );
    const sameVariantRow = sameVariant.rows[0];
    gate.check(Boolean(sameVariantRow), "fixture/same-variant", "variante barata con hermana más cara disponible");

    const heart = await pool.query<{ title: string }>(
      `SELECT p.title
         FROM catalog_products p JOIN catalog_variants v ON v.product_id = p.product_id
        WHERE p.status = 'ACTIVE' AND v.available = true AND v.forma = 'corazon'
        ORDER BY p.product_id, v.variant_id LIMIT 1`,
    );
    const roundSize = await pool.query<{ product_id: string; variant_id: string; title: string; diameter: string }>(
      `SELECT p.product_id, v.variant_id, p.title, v.diam_pulg::text AS diameter
         FROM catalog_products p JOIN catalog_variants v ON v.product_id = p.product_id
        WHERE p.status = 'ACTIVE' AND v.available = true AND v.forma = 'redondo' AND v.diam_pulg IS NOT NULL
        ORDER BY CASE WHEN v.diam_pulg = 12 THEN 0 ELSE 1 END, p.product_id, v.variant_id LIMIT 1`,
    );
    const color = await pool.query<{ title: string; color: string }>(
      `SELECT p.title, jsonb_array_elements_text(p.derived->'colors') AS color
         FROM catalog_products p
        WHERE p.status = 'ACTIVE' AND p.available = true
          AND jsonb_array_length(COALESCE(p.derived->'colors','[]'::jsonb)) > 0
        ORDER BY p.product_id LIMIT 1`,
    );

    // Three deterministic parser contracts: physical code, heart code and
    // soft preference. This runs locally and is independent of Gemini.
    const parserCases = [
      { text: "globos redondos R-12 rojos", ok: (x: ReturnType<typeof parserModule.interpretarConsultaLocal>) => x.intent.filtros_duros.formas.includes("redondo") && x.intent.filtros_duros.diametros_pulgadas.includes(12) && x.intent.filtros_duros.colores.includes("rojo") },
      { text: "globo corazón C-12", ok: (x: ReturnType<typeof parserModule.interpretarConsultaLocal>) => x.intent.filtros_duros.formas.includes("corazon") && x.intent.filtros_duros.diametros_pulgadas.length === 0 },
      { text: "preferiría dorado", ok: (x: ReturnType<typeof parserModule.interpretarConsultaLocal>) => x.intent.filtros_duros.colores.length === 0 && x.intent.semantic_query.includes("dorado") },
    ];
    const parserPasses = parserCases.filter((test) => test.ok(parserModule.interpretarConsultaLocal(test.text))).length;
    gate.check(parserPasses === 3, "parser/no-key", `${parserPasses}/3 casos deterministas`);

    if (!uniqueRow || !uniqueRow.sku_original || !uniqueRow.sku_canonical || !sameVariantRow) {
      gate.block("fixtures/required", "no hay suficientes filas ACTIVE para ejecutar el flujo E2E");
      return;
    }

    const exact = await searchModule.buscarHibrido(pool, { semanticQuery: uniqueRow.sku_original, filtros: { disponible: true } });
    gate.check(exact.skuStatus === "unique" && idsFromResponse(exact).length === 1 && idsFromResponse(exact)[0] === uniqueRow.variant_id, "sku/original", "SKU original resuelve una sola variante");
    await assertRealWhitelist(pool, gate, "sku/original-whitelist", exact);

    const canonical = await searchModule.buscarHibrido(pool, { semanticQuery: uniqueRow.sku_canonical, filtros: { disponible: true } });
    gate.check(canonical.skuStatus === "unique" && idsFromResponse(canonical).length === 1 && idsFromResponse(canonical)[0] === uniqueRow.variant_id, "sku/canonical", "SKU canónico conserva la variante original");
    await assertRealWhitelist(pool, gate, "sku/canonical-whitelist", canonical);

    const conversational = await searchModule.buscarHibrido(pool, { semanticQuery: `Necesito el SKU ${uniqueRow.sku_original}`, filtros: { disponible: true } });
    gate.check(conversational.skuStatus === "unique" && idsFromResponse(conversational).length === 1, "sku/conversational", "SKU embebido en lenguaje natural sigue siendo exacto");

    const missing = await searchModule.buscarHibrido(pool, { semanticQuery: "SKU-E2E-INEXISTENTE-000000", filtros: { disponible: true } });
    gate.check(missing.skuStatus === "not_found" && missing.results.length === 0, "sku/not-found", "SKU inexistente no cae a búsqueda semántica");

    if (ambiguousRow) {
      const ambiguousResponse = await searchModule.buscarHibrido(pool, { semanticQuery: ambiguousRow.sku_original, filtros: { disponible: false } });
      const returnedAmbiguous = idsFromResponse(ambiguousResponse).sort();
      gate.check(ambiguousResponse.skuStatus === "ambiguous", "sku/ambiguous-status", "duplicado canónico queda explícito como ambiguous");
      gate.check(JSON.stringify(returnedAmbiguous) === JSON.stringify([...ambiguousRow.variant_ids].sort()), "sku/ambiguous-exact-set", "solo devuelve las variantes exactas del grupo ambiguo");

      const ambiguousCaller = await browseModule.buscarCatalogoRag(pool, ambiguousRow.sku_original);
      gate.check(ambiguousCaller.status === "NO_MATCH" || ambiguousCaller.scores.length === 0, "sku/ambiguous-clarification", "caller rechaza o deja vacío un SKU ambiguo para solicitar aclaración");
    }

    const semanticQuery: ConsultaRetrieval = { semanticQuery: sameVariantRow.title, filtros: { disponible: true } };
    const semanticStarted = performance.now();
    const semantic = await searchModule.buscarHibrido(pool, semanticQuery);
    const semanticMs = performance.now() - semanticStarted;
    const semanticRows = await assertRealWhitelist(pool, gate, "retrieval/semantic-whitelist", semantic);
    gate.check(semantic.branchStatus?.vector === "SKIPPED_OPTIONAL" || options.withGemini, "retrieval/vector-optional", options.withGemini ? "modo Gemini solicitado" : "vector SKIPPED_OPTIONAL sin key");
    gate.check(semanticRows.length > 0, "retrieval/semantic-result", "búsqueda por nombre devuelve variantes reales");

    const sameVariantFilters = {
      disponible: true,
      precioMax: Number(sameVariantRow.price),
      formas: sameVariantRow.forma ? [sameVariantRow.forma] : undefined,
      diametrosPulgadas: sameVariantRow.diam_pulg ? [Number(sameVariantRow.diam_pulg)] : undefined,
    };
    const filtered = await searchModule.buscarHibrido(pool, { semanticQuery: sameVariantRow.title, filtros: sameVariantFilters });
    const filteredRows = await assertRealWhitelist(pool, gate, "filters/same-variant-whitelist", filtered);
    assertSameVariantFilters(gate, "filters/same-variant", filteredRows, {
      available: true,
      priceMax: Number(sameVariantRow.price),
      forma: sameVariantRow.forma ?? undefined,
      diameter: sameVariantRow.diam_pulg ? Number(sameVariantRow.diam_pulg) : undefined,
    });

    if (roundSize.rows[0]) {
      const diameter = Number(roundSize.rows[0].diameter);
      const diameterResponse = await searchModule.buscarHibrido(pool, { semanticQuery: roundSize.rows[0].title, filtros: { disponible: true, diametrosPulgadas: [diameter] } });
      const diameterRows = await assertRealWhitelist(pool, gate, "filters/diameter-whitelist", diameterResponse);
      assertSameVariantFilters(gate, "filters/diameter-implies-round", diameterRows, { available: true, diameter, forma: "redondo" });
    } else gate.skip("filters/diameter", "no hay variante redonda con diámetro explícito");

    if (heart.rows[0]) {
      const heartResponse = await searchModule.buscarHibrido(pool, { semanticQuery: heart.rows[0].title, filtros: { disponible: true, formas: ["corazon"] } });
      const heartRows = await assertRealWhitelist(pool, gate, "filters/heart-whitelist", heartResponse);
      assertSameVariantFilters(gate, "filters/heart", heartRows, { available: true, forma: "corazon" });
    } else gate.skip("filters/heart", "no hay variante corazón disponible");

    if (color.rows[0] && hasVariantColors) {
      const colorResponse = await searchModule.buscarHibrido(pool, { semanticQuery: color.rows[0].title, filtros: { disponible: true, colores: [color.rows[0].color] } });
      gate.check(colorResponse.results.length > 0, "filters/color", "filtro de color devuelve candidatos");
      const colorRows = await assertRealWhitelist(pool, gate, "filters/color-whitelist", colorResponse);
      assertColorWhitelist(gate, "filters/color-same-variant", colorRows, color.rows[0].color);
    } else if (!hasVariantColors) gate.skip("filters/color", "bloqueado hasta migrar derived_colors; no se ejecuta una consulta que fallaría");
    else gate.skip("filters/color", "no hay producto con color derivado");

    // Context matters for ambiguous color aliases: “vino” is a color only
    // when the client asks for a balloon/color, not when it names a wine bag.
    const wineBagIntent = parserModule.interpretarConsultaLocal("bolsa para vino").intent;
    const wineBalloonIntent = parserModule.interpretarConsultaLocal("globos color vino").intent;
    gate.check(wineBagIntent.filtros_duros.colores.length === 0, "taxonomy/wine-context-negative", "bolsa para vino no se convierte en filtro burdeos");
    gate.check(wineBalloonIntent.filtros_duros.colores.includes("burdeos"), "taxonomy/wine-context-positive", "globos color vino sí se convierte en burdeos");

    // Product 8634207076647 has a multi-color product facet and an available
    // ESCARCHADA variant. A red hard filter must not expose that variant just
    // because another sibling of the same product is red. `derived_colors`
    // is consumed when Plan06 adds it; singleton product colors are the only
    // safe fallback until then.
    if (hasVariantColors) {
      const expectedAdversarial = await pool.query<{ variant_id: string; sku_original: string }>(
        `SELECT v.variant_id
                , v.sku_original
           FROM catalog_variants v
          WHERE v.product_id = '8634207076647'
            AND v.derived_colors @> ARRAY['rojo']::text[]
          ORDER BY v.variant_id
          LIMIT 1`,
      );
      if (expectedAdversarial.rows.length !== 1) {
        gate.skip("filters/color-adversarial-fixture", "fixture opcional 8634207076647 no está presente en este snapshot");
        gate.skip("filters/color-adversarial-red", "fixture opcional ausente");
        gate.skip("filters/color-adversarial-available-whitelist", "fixture opcional ausente");
        gate.skip("filters/color-adversarial-escarchada", "fixture opcional ausente");
      } else {
        const redAdversarial = await searchModule.buscarHibrido(pool, {
          semanticQuery: expectedAdversarial.rows[0].sku_original,
          filtros: { disponible: false, colores: ["rojo"] },
        });
        const redAdversarialRows = await assertRealWhitelist(pool, gate, "filters/color-adversarial-whitelist", redAdversarial, true);
        const returnedExpected = redAdversarialRows.some((row) => row.variant_id === expectedAdversarial.rows[0].variant_id && row.colors.includes("rojo"));
        gate.check(returnedExpected, "filters/color-adversarial-red", "la variante roja esperada llega al caller con evidencia same-variant");
        const availableAdversarial = await searchModule.buscarHibrido(pool, {
          semanticQuery: expectedAdversarial.rows[0].sku_original,
          filtros: { disponible: true, colores: ["rojo"] },
        });
        const availableAdversarialRows = await assertRealWhitelist(pool, gate, "filters/color-adversarial-available-whitelist", availableAdversarial, false);
        const leakedEscarchada = availableAdversarialRows.some((row) => row.product_id === "8634207076647" && /escarchada/i.test(row.title ?? ""));
        gate.check(!leakedEscarchada, "filters/color-adversarial-escarchada", "rojo no expone la variante ESCARCHADA del producto multicolor");
      }
    } else gate.skip("filters/color-adversarial-escarchada", "bloqueado hasta migrar derived_colors");

    const caller = await browseModule.buscarCatalogoRag(pool, "productos de decoracion");
    gate.check(caller.status === "OK" && caller.candidatos.length > 0, "caller/search", "caller devuelve candidatos reales");
    const callerVariantIds = new Set(caller.candidatos.flatMap((candidate) => candidate.variantes.map((variant) => variant.variantId)));
    const callerScoreIds = new Set(caller.scores.flatMap((score) => score.variantIds));
    gate.check([...callerVariantIds].every((id) => callerScoreIds.has(id)), "caller/whitelist", "ninguna variante visible al caller queda fuera de la whitelist de retrieval");

    const selectedCandidate = caller.candidatos.find((candidate) => candidate.variantes.length > 0);
    const selectedVariant = selectedCandidate?.variantes[0];
    if (!selectedCandidate || !selectedVariant) {
      gate.fail("selection/fixture", "caller no entregó una variante seleccionable");
    } else {
      const selection: SeleccionSolicitada = { productId: selectedCandidate.productId, variantId: selectedVariant.variantId, cantidad: 2 };
      const callerWhitelist = new Map(caller.candidatos.map((candidate) => [candidate.productId, new Set(candidate.variantes.map((variant) => variant.variantId))]));
      const validated = await validationModule.validarSeleccion(pool, [selection], callerWhitelist);
      const dbSelected = (await loadVariants(pool, [selectedVariant.variantId]))[0];
      const expectedPrice = dbSelected ? Number(dbSelected.price) : NaN;
      gate.check(validated.validados.length === 1 && validated.validados[0].precioUnitario === expectedPrice, "selection/db-price", "precio unitario coincide exactamente con DB");
      gate.check(validated.validados[0]?.subtotal === expectedPrice * 2 && validated.total === expectedPrice * 2, "selection/subtotal", "subtotal y total se calculan en backend");
      const visual = validated.validados[0] ? validationModule.aProductoValidado(validated.validados[0], 2) : null;
      const validatedItem = validated.validados[0];
      gate.check(
        visual != null && validatedItem != null &&
          visual.id === validatedItem.variantId && visual.familiaId === validatedItem.productId &&
          visual.precio === validatedItem.precioUnitario && visual.paquetes === 2 &&
          visual.nombre === validatedItem.titulo && visual.descripcion === (validatedItem.descripcion ?? validatedItem.titulo) &&
          JSON.stringify(visual.colores) === JSON.stringify(validatedItem.colores) &&
          (visual.unidadesPaquete ?? null) === validatedItem.unidadesPaquete &&
          (visual.tamanoCodigo ?? null) === validatedItem.codigoTamano &&
          (visual.forma ?? null) === validatedItem.forma &&
          (visual.diamPulg ?? null) === validatedItem.diamPulg,
        "selection/pg-visual-projection",
        "la proyección visual conserva IDs, metadata, precio y unidades de la fila PG validada",
      );

      const invented = await validationModule.validarSeleccion(pool, [{ productId: "E2E-NO-EXISTE", variantId: selectedVariant.variantId, cantidad: 1 }], callerWhitelist);
      gate.check(invented.validados.length === 0, "selection/invented-product", "product_id inventado rechazado");

    }

    if (roundSize.rows[0]) {
      const resolverProductId = roundSize.rows[0].product_id;
      const resolverVariants = await pool.query<{ variant_id: string }>(
        `SELECT variant_id
           FROM catalog_variants
          WHERE product_id = $1 AND available = true AND forma = 'redondo' AND diam_pulg IS NOT NULL AND price > 0
          ORDER BY variant_id`,
        [resolverProductId],
      );
      const resolverResult = await resolverModule.resolverVariantesPorDespiece(
        pool,
        resolverProductId,
        [{ tamano: `R-${roundSize.rows[0].diameter}`, pulgadas: Number(roundSize.rows[0].diameter), cantidad: 1 }],
        new Set(resolverVariants.rows.map((row) => row.variant_id)),
      );
      gate.check(
        resolverResult.lineas.length > 0 && resolverResult.lineas.every((linea) => resolverVariants.rows.some((row) => row.variant_id === linea.variantId)),
        "selection/resolver-pg",
        "resolver async devuelve una línea no vacía usando la whitelist PG",
      );
    } else gate.skip("selection/resolver-pg", "no hay variante redonda disponible para smoke test");

    // The generic caller may whitelist every variant of a product. Use the
    // exact cheap SKU plus same-variant hard filters to force a smaller
    // whitelist, then attack validation with a different available sibling.
    const constrainedSku = sameVariantRow.sku_original ?? sameVariantRow.sku_canonical;
    if (constrainedSku) {
      const constrained = await searchModule.buscarHibrido(pool, { semanticQuery: constrainedSku, filtros: sameVariantFilters });
      const constrainedProduct = constrained.results.find((result) => result.productId === sameVariantRow.product_id);
      if (constrainedProduct) {
        const outside = await pool.query<{ variant_id: string }>(
          `SELECT v.variant_id
             FROM catalog_variants v
            WHERE v.product_id = $1 AND v.available = true
              AND NOT (v.variant_id = ANY($2::text[]))
            ORDER BY v.variant_id LIMIT 1`,
          [sameVariantRow.product_id, constrainedProduct.variantIds],
        );
        if (outside.rows[0]) {
          const outsideValidation = await validationModule.validarSeleccion(
            pool,
            [{ productId: sameVariantRow.product_id, variantId: outside.rows[0].variant_id, cantidad: 1 }],
            new Map([[sameVariantRow.product_id, new Set(constrainedProduct.variantIds)]]),
          );
          gate.check(outsideValidation.validados.length === 0, "selection/variant-whitelist", "variante real pero fuera de whitelist rechazada");
        } else gate.block("selection/variant-whitelist", "no se encontró una variante hermana fuera de la whitelist para el ataque adversarial");
      } else gate.block("selection/variant-whitelist", "SKU con filtros no conservó el producto barato de la fixture");
    } else gate.block("selection/variant-whitelist", "fixture same-variant no tiene SKU para forzar whitelist exacta");

    const budget = await budgetModule.buscarCatalogoRagConPresupuesto(pool, "globos para cumpleaños", budgetConstants.FRANJAS.detalle, undefined);
    const hasBasket = budget.status === "OK" && budget.canasta != null && budget.canasta.piezas.length > 0;
    gate.check(hasBasket, "budget/canasta", "presupuesto produce una canasta real");
    if (budget.canasta) {
      const budgetVariantIds = budget.canasta.piezas.map((piece) => piece.variantId);
      const budgetRows = await loadVariants(pool, budgetVariantIds);
      const budgetById = new Map(budgetRows.map((row) => [row.variant_id, row]));
      const fullBudgetWhitelist = new Set(budget.variantIdsRecuperados.map((item) => `${item.productId}:${item.variantId}`));
      const allBudgetSelections = [
        ...budget.canasta.piezas.map((piece) => `${piece.productId}:${piece.variantId}`),
        ...Object.values(budget.poolPorRol).flat().map((item) => `${item.productId}:${item.variantId}`),
      ];
      gate.check(allBudgetSelections.every((key) => fullBudgetWhitelist.has(key)), "budget/internal-variant-whitelist", "canasta y pool visible sólo usan IDs recuperados por retrieval");
      const pricesExact = budget.canasta.piezas.every((piece) => budgetById.get(piece.variantId)?.price === String(piece.precio) || Number(budgetById.get(piece.variantId)?.price) === piece.precio);
      const totalExact = budget.canasta.total === budget.canasta.piezas.reduce((sum, piece) => sum + piece.subtotal, 0);
      gate.check(budgetRows.length === budgetVariantIds.length && pricesExact, "budget/db-prices", "todas las piezas usan precios de DB");
      gate.check(totalExact && budget.canasta.total <= budget.canasta.techoCop, "budget/subtotal", "total suma subtotales y respeta techo");
    }

    // Warm the same deterministic query twice, then measure a fixed sequential
    // sample. Warmups and the earlier cold semantic call are excluded from p50/p95.
    for (let i = 0; i < 2; i++) await searchModule.buscarHibrido(pool, semanticQuery);
    const latencySamples: number[] = [];
    for (let i = 0; i < 20; i++) {
      const started = performance.now();
      await searchModule.buscarHibrido(pool, semanticQuery);
      latencySamples.push(performance.now() - started);
    }
    const p95 = percentile(latencySamples, 95);
    const p50 = percentile(latencySamples, 50);
    const minimum = Math.min(...latencySamples);
    const maximum = Math.max(...latencySamples);
    console.log(`[LATENCY] cold=${semanticMs.toFixed(1)}ms warmups=2 samples=${latencySamples.length} min=${minimum.toFixed(1)}ms p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms max=${maximum.toFixed(1)}ms`);
    const absoluteLimit = 2_100;
    gate.check(p95 <= absoluteLimit, "latency/e2e-p95-absolute", `p95=${p95.toFixed(1)}ms limite_absoluto=${absoluteLimit}ms`);
    const baseline = readVersionedBaseline(options.baselineMs);
    if (baseline != null && options.withGemini && process.env.GEMINI_API_KEY?.trim()) {
      gate.skip("latency/e2e-regression", "baseline versionado de no-key no es comparable con embeddings remotos; se aplicó el límite absoluto de 2.100 ms");
    } else if (baseline != null) {
      gate.check(p95 <= baseline * 1.15, "latency/e2e-regression", `p95=${p95.toFixed(1)}ms baseline_versionado=${baseline.toFixed(1)}ms limite=${(baseline * 1.15).toFixed(1)}ms`);
    } else gate.skip("latency/e2e-regression", "sin baseline versionado; se aplicó el límite absoluto de 2.100 ms");

    if (options.withGemini && process.env.GEMINI_API_KEY?.trim()) gate.pass("optional/gemini", "key presente; el resultado vector/Gemini queda reportado por branchStatus");
    else gate.skip("optional/gemini", "sin key; parser determinista, FTS y filtros SQL son la ruta obligatoria");
  } catch (error) {
    gate.fail("e2e/unhandled", safeError(error));
  } finally {
    await pool.end();
  }

  console.log(`\n[E2E] fallos=${gate.failures} bloqueos=${gate.blocked} opcionales_omitidos=${gate.skipped}`);
  process.exitCode = gate.failures === 0 && gate.blocked === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(`[FAIL] e2e-rag-v2 — ${safeError(error)}`);
  process.exitCode = 1;
});
