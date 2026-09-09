import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { buscarHibrido } from "../src/lib/rag/retrieval/search";
import type { ConsultaRetrieval, FiltrosDuros } from "../src/lib/rag/retrieval/types";

for (const file of [".env.local", ".env"]) if (existsSync(file)) process.loadEnvFile(file);

/**
 * Fase 8.1 (plan §Fase 8): fixture reproducible para el arnés de pytest de
 * services/ai-api/tests/test_rag_eval_variance.py.
 *
 * NO usa eval/rag/queries-v2.jsonl + ground-truth-v2.jsonl a propósito.
 * Ese corpus depende de una fila publicada en rag_source_snapshots
 * (scripts/import-cdn-catalog.ts la escribe; scripts/import-shopify-catalog.ts,
 * el que de verdad usa `npm run rag:sync`, no lo hace). Al momento de
 * escribir esto rag_source_snapshots está vacía tanto en Neon como en local
 * -- bench-rag-v2.ts y eval-rag-v2.ts no pueden correr contra ninguna base
 * real disponible. Ese hallazgo se documenta aparte
 * (docs/migracion-python/rag/eval-python-fase8.md); arreglar el pipeline de
 * snapshots es trabajo de otra fase, no de esta.
 *
 * Este fixture evita esa dependencia por completo: construye los casos
 * directamente contra catalog_products/catalog_variants EN VIVO, con
 * selección DETERMINISTA (ORDER BY id, nunca random()) para que el mismo
 * comando produzca el mismo archivo -- a diferencia de scripts/eval-retrieval.ts
 * (Fase 3B), del que este script es un derivado reproducible.
 */

const ROOT = process.cwd();
const DEFAULT_FIXTURE = path.join(ROOT, "eval", "rag", "fixture-live-catalog.json");

type Categoria = "sku" | "nombre" | "filtro" | "sin_resultado";

type CasoFixture = {
  id: string;
  categoria: Categoria;
  consulta: ConsultaRetrieval;
  esperadoIds: string[];
};

type Fixture = {
  generado_en: string;
  nota: string;
  casos: CasoFixture[];
};

const COMBOS_FILTRO: { texto: string; categoria: string | null; color: string | null; ocasion: string | null; precioMax: number | null }[] = [
  { texto: "globo dorado", categoria: null, color: "dorado", ocasion: null, precioMax: null },
  { texto: "velas para cumpleaños", categoria: "vela", color: null, ocasion: "cumpleanos", precioMax: null },
  { texto: "globo metalizado azul", categoria: "globo_metalizado", color: "azul", ocasion: null, precioMax: null },
  { texto: "decoración económica", categoria: null, color: null, ocasion: null, precioMax: 20000 },
  { texto: "kit de fiesta rosado", categoria: "kit", color: "rosado", ocasion: null, precioMax: null },
  { texto: "guirnalda para boda", categoria: "guirnalda_arco", color: null, ocasion: "boda", precioMax: null },
];

const SIN_SENTIDO = [
  "arco iris comestible de unicornio talla XXL",
  "dron decorativo con motor a gasolina",
  "SKU-INEXISTENTE-000000",
  "alfombra voladora para quince años",
  "sofá reclinable de peluche para exteriores",
];

async function construirFixture(pool: Pool): Promise<Fixture> {
  const casos: CasoFixture[] = [];

  // Selección determinista (ORDER BY, no random()): el mismo comando
  // produce el mismo archivo mientras el catálogo no cambie.
  //
  // sku_original (no la columna legada sku) porque es lo que queryExact()
  // busca de verdad (src/lib/rag/retrieval/search.ts:263-264, columnSql =
  // "UPPER(v.sku_original)"). Hallazgo real encontrado al construir este
  // fixture, no arreglado aquí por estar fuera de alcance de la Fase 8: el
  // Postgres local sincronizado con `npm run rag:sync`
  // (scripts/import-shopify-catalog.ts, el pipeline legado) deja
  // sku_original/sku_canonical vacíos para las 3726 variantes -- Neon
  // (producción) los tiene poblados correctamente en las 3723 suyas, así
  // que la búsqueda exacta por SKU SÍ funciona en producción; es un
  // problema de qué pipeline sincronizó este Postgres local, no de
  // producción. Si esta consulta no encuentra filas, la categoría "sku"
  // queda vacía en el fixture generado -- eso es correcto y esperable
  // contra un local sin resincronizar con scripts/import-cdn-catalog.ts.
  const { rows: variantes } = await pool.query<{ product_id: string; sku_original: string }>(
    `SELECT product_id, sku_original FROM catalog_variants
     WHERE sku_original IS NOT NULL AND sku_original <> '' AND available = true
     ORDER BY variant_id ASC LIMIT 15`,
  );
  variantes.forEach((v, index) => {
    casos.push({
      id: `sku-${String(index + 1).padStart(3, "0")}`,
      categoria: "sku",
      consulta: { semanticQuery: v.sku_original, filtros: { disponible: false } },
      esperadoIds: [v.product_id],
    });
  });

  const { rows: productos } = await pool.query<{ product_id: string; title: string }>(
    `SELECT product_id, title FROM catalog_products WHERE status = 'ACTIVE' ORDER BY product_id ASC LIMIT 15`,
  );
  productos.forEach((p, index) => {
    casos.push({
      id: `nombre-${String(index + 1).padStart(3, "0")}`,
      categoria: "nombre",
      consulta: { semanticQuery: p.title, filtros: { disponible: false } },
      esperadoIds: [p.product_id],
    });
  });

  for (const [index, c] of COMBOS_FILTRO.entries()) {
    const condiciones = ["p.available = true"];
    const params: unknown[] = [];
    if (c.categoria) { params.push(c.categoria); condiciones.push(`p.derived->>'category' = $${params.length}`); }
    if (c.color) { params.push([c.color]); condiciones.push(`p.derived->'colors' ?| $${params.length}::text[]`); }
    if (c.ocasion) { params.push([c.ocasion]); condiciones.push(`p.derived->'occasions' ?| $${params.length}::text[]`); }
    if (c.precioMax != null) {
      params.push(c.precioMax);
      condiciones.push(
        `EXISTS (SELECT 1 FROM catalog_variants ev WHERE ev.product_id = p.product_id AND ev.available = true AND ev.price <= $${params.length})`,
      );
    }
    const { rows } = await pool.query<{ product_id: string }>(
      `SELECT product_id FROM catalog_products p WHERE ${condiciones.join(" AND ")} ORDER BY product_id ASC`,
      params,
    );
    if (rows.length === 0) continue;
    const filtros: FiltrosDuros = {
      disponible: true,
      categorias: c.categoria ? [c.categoria] : undefined,
      colores: c.color ? [c.color] : undefined,
      ocasiones: c.ocasion ? [c.ocasion] : undefined,
      precioMax: c.precioMax ?? undefined,
    };
    casos.push({
      id: `filtro-${String(index + 1).padStart(3, "0")}`,
      categoria: "filtro",
      consulta: { semanticQuery: c.texto, filtros },
      esperadoIds: rows.map((r) => r.product_id),
    });
  }

  SIN_SENTIDO.forEach((texto, index) => {
    casos.push({ id: `sin-resultado-${String(index + 1).padStart(3, "0")}`, categoria: "sin_resultado", consulta: { semanticQuery: texto }, esperadoIds: [] });
  });

  return {
    generado_en: new Date().toISOString(),
    nota: "Construido en vivo contra catalog_products/catalog_variants con selección determinista (ORDER BY id, no random()). No depende de rag_source_snapshots. Regenerar con --generate si el catálogo cambia significativamente.",
    casos,
  };
}

function recallAtK(esperado: string[], obtenido: string[], k: number): number | null {
  if (esperado.length === 0) return null;
  const topK = new Set(obtenido.slice(0, k));
  return esperado.filter((id) => topK.has(id)).length / esperado.length;
}

function precisionEnConjunto(esperado: string[], obtenido: string[]): number | null {
  if (obtenido.length === 0) return null;
  const esperadoSet = new Set(esperado);
  return obtenido.filter((id) => esperadoSet.has(id)).length / obtenido.length;
}

type ResultadoCaso = { id: string; categoria: Categoria; ok: boolean; ms: number; detalle: string };

async function correrFixture(pool: Pool, fixture: Fixture): Promise<{ resultados: ResultadoCaso[]; metrics: Record<string, unknown> }> {
  const { rows: idsValidos } = await pool.query<{ product_id: string }>("SELECT product_id FROM catalog_products");
  const catalogoValido = new Set(idsValidos.map((r) => r.product_id));

  const resultados: ResultadoCaso[] = [];
  const recallsSku: number[] = [];
  const recallsNombre: number[] = [];
  const precisionesFiltro: number[] = [];
  let sinResultadoAcertados = 0;
  let sinResultadoTotal = 0;
  let idsInvalidosTotal = 0;

  for (const caso of fixture.casos) {
    const started = Date.now();
    const respuesta = await buscarHibrido(pool, caso.consulta);
    const ms = Date.now() - started;
    const obtenidoIds = respuesta.results.map((r) => r.productId);
    const invalidos = obtenidoIds.filter((id) => !catalogoValido.has(id));
    idsInvalidosTotal += invalidos.length;

    if (caso.categoria === "sin_resultado") {
      sinResultadoTotal++;
      const ok = obtenidoIds.length === 0;
      if (ok) sinResultadoAcertados++;
      resultados.push({ id: caso.id, categoria: caso.categoria, ok, ms, detalle: ok ? "" : `${obtenidoIds.length} resultado(s) inesperado(s)` });
      continue;
    }
    if (caso.categoria === "filtro") {
      const precision = precisionEnConjunto(caso.esperadoIds, obtenidoIds);
      if (precision !== null) precisionesFiltro.push(precision);
      resultados.push({ id: caso.id, categoria: caso.categoria, ok: precision === null || precision >= 0.999, ms, detalle: precision === null ? "sin resultados" : `precision=${precision.toFixed(3)}` });
      continue;
    }
    const recall = recallAtK(caso.esperadoIds, obtenidoIds, 5) ?? 0;
    if (caso.categoria === "sku") recallsSku.push(recall);
    else recallsNombre.push(recall);
    resultados.push({ id: caso.id, categoria: caso.categoria, ok: recall >= 0.999, ms, detalle: `recall@5=${recall.toFixed(3)}` });
  }

  // null cuando no hay casos de esa categoría -- 0 significaría "0% de
  // recall medido", que es una afirmación distinta y falsa de "no se midió".
  const mean = (values: number[]): number | null => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
  const errorCount = resultados.filter((r) => !r.ok).length;
  const metrics = {
    total_casos: fixture.casos.length,
    sku_recall_at_5: mean(recallsSku),
    nombre_recall_at_5: mean(recallsNombre),
    filtro_precision: mean(precisionesFiltro),
    sin_resultado_accuracy: sinResultadoTotal ? sinResultadoAcertados / sinResultadoTotal : null,
    ids_invalidos_total: idsInvalidosTotal,
    error_count: errorCount,
    error_rate: fixture.casos.length ? errorCount / fixture.casos.length : 0,
    latencia_ms: { p50: percentile(resultados.map((r) => r.ms), 50), p95: percentile(resultados.map((r) => r.ms), 95), max: Math.max(0, ...resultados.map((r) => r.ms)) },
  };
  return { resultados, metrics };
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const index = Math.min(ordered.length - 1, Math.max(0, Math.ceil((p / 100) * ordered.length) - 1));
  return ordered[index];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fixturePath = (() => {
    const index = args.indexOf("--fixture");
    return index >= 0 ? path.resolve(ROOT, args[index + 1]) : DEFAULT_FIXTURE;
  })();
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL es requerido");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    if (args.includes("--generate")) {
      const fixture = await construirFixture(pool);
      await writeFile(fixturePath, JSON.stringify(fixture, null, 2), "utf8");
      console.log(JSON.stringify({ status: "GENERATED", fixture: path.relative(ROOT, fixturePath), casos: fixture.casos.length }));
      return;
    }
    if (args.includes("--run")) {
      // Sin proveedor real: mismo patrón que scripts/bench-rag-v2.ts --no-key.
      process.env.GEMINI_API_KEY = "";
      process.env.RAG_USE_VECTOR = "false";
      const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;
      const { resultados, metrics } = await correrFixture(pool, fixture);
      const fallos = resultados.filter((r) => !r.ok);
      console.log(JSON.stringify({ status: fallos.length ? "FAIL" : "PASS", metrics, failed_cases: fallos.map((f) => ({ id: f.id, detalle: f.detalle })) }));
      if (fallos.length) process.exitCode = 1;
      return;
    }
    throw new Error("uso: --generate [--fixture <ruta>] | --run [--fixture <ruta>]");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`[FAIL] eval-rag-fixture: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
