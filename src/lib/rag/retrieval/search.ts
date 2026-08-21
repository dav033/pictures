import type { Pool } from "pg";
import { fusionarRankings } from "@sempertex/agente-core/rag";
import { embeberTexto } from "../embeddings";
import type { ConsultaRetrieval, FiltrosDuros, RespuestaRetrieval, ResultadoRetrieval } from "./types";

const VECTOR_LIMIT = Number(process.env.RAG_VECTOR_LIMIT ?? 30);
const FINAL_LIMIT = Number(process.env.RAG_FINAL_LIMIT ?? 15);
const MIN_SIMILARITY = Number(process.env.RAG_MIN_SIMILARITY ?? 0.56);
const USE_VECTOR = (process.env.RAG_USE_VECTOR ?? "true") !== "false";
const USE_FULLTEXT = (process.env.RAG_USE_FULLTEXT ?? "true") !== "false";

// Constante estándar de Reciprocal Rank Fusion (valor usual en la literatura,
// ver Cormack et al. 2009). Pesos de rama, no de score — un match #1 en
// full-text (ej. SKU exacto) nunca queda enterrado bajo ruido semántico de
// la otra rama, que es justo lo que pasaba normalizando y sumando scores de
// escalas distintas (ts_rank vs. cosine similarity no son comparables).
const RRF_K = 60;
const PESO_VECTOR = 0.6;
const PESO_TEXTO = 0.4;

function pareceSku(value: string): boolean {
  const text = value.trim();
  return /^SKU[-_]/i.test(text) || (/^[A-Z0-9._/-]{8,}$/i.test(text) && /\d/.test(text));
}

/** WHERE reutilizable entre la rama vectorial y la de texto: los filtros duros
 * nunca deben depender de qué rama encontró el candidato. */
function construirFiltroDuro(filtros: FiltrosDuros | undefined, params: unknown[]): string {
  const condiciones: string[] = [];
  const disponible = filtros?.disponible ?? true;
  if (disponible) condiciones.push("p.available = true");

  // Precio, forma y diámetro son restricciones DE VARIANTE (plan de tamaños
  // F2), y deben cumplirse TODAS en la MISMA variante — nunca en un EXISTS
  // separado por condición. Un EXISTS por condición dejaría pasar un
  // producto por una variante barata Y aparte por una variante R-12,
  // aunque ninguna variante individual cumpla precio+tamaño a la vez (el
  // mismo bug de "fuga" ya documentado y corregido para precio solo).
  const condicionesVariante: string[] = ["ev.available = true"];
  if (filtros?.precioMax != null) {
    // NO se filtra con p.price_min: es el mínimo entre TODAS las variantes
    // (normalize.ts línea 96), incluidas las agotadas, así que un producto
    // podía pasar este filtro por una variante que ni siquiera se puede
    // comprar. Se exige que exista al menos una variante DISPONIBLE y
    // dentro del tope — la misma variante que después se le puede proponer
    // al cliente (bug real medido: 149 productos con variantes disponibles
    // por encima del tope entraban igual con la condición anterior).
    params.push(filtros.precioMax);
    condicionesVariante.push(`ev.price <= $${params.length}`);
  }
  if (filtros?.formas?.length) {
    params.push(filtros.formas);
    condicionesVariante.push(`ev.forma = ANY($${params.length}::text[])`);
  }
  if (filtros?.diametrosPulgadas?.length) {
    params.push(filtros.diametrosPulgadas);
    condicionesVariante.push(`ev.diam_pulg = ANY($${params.length}::numeric[])`);
  }
  if (condicionesVariante.length > 1) {
    condiciones.push(`EXISTS (SELECT 1 FROM catalog_variants ev WHERE ev.product_id = p.product_id AND ${condicionesVariante.join(" AND ")})`);
  }
  if (filtros?.categorias?.length) {
    params.push(filtros.categorias);
    condiciones.push(`p.derived->>'category' = ANY($${params.length}::text[])`);
  }
  if (filtros?.ocasiones?.length) {
    params.push(filtros.ocasiones);
    condiciones.push(`p.derived->'occasions' ?| $${params.length}::text[]`);
  }
  if (filtros?.colores?.length) {
    params.push(filtros.colores);
    condiciones.push(`p.derived->'colors' ?| $${params.length}::text[]`);
  }

  return condiciones.length ? `AND ${condiciones.join(" AND ")}` : "";
}

/**
 * Retrieval híbrido (plan §3.8): vector + full-text, filtros duros aplicados
 * ANTES del ranking en ambas ramas, fusión por posición (RRF) en vez de por
 * score normalizado. No genera lenguaje para el usuario — solo productos
 * candidatos (plan §3.13).
 */
export async function buscarHibrido(pool: Pool, consulta: ConsultaRetrieval): Promise<RespuestaRetrieval> {
  const vectorScores = new Map<string, number>();
  const textScores = new Map<string, number>();
  const vectorRanked: string[] = [];
  const textRanked: string[] = [];

  // Match exacto de SKU: NO es una búsqueda semántica, es un lookup
  // determinístico (plan §3.7). No debe competir por ranking contra ruido
  // vectorial — un cliente que pega un SKU quiere ESE producto, no "algo
  // parecido". Se resuelve aparte y se antepone, sin pasar por RRF.
  const exactosParams: unknown[] = [consulta.semanticQuery.trim()];
  const exactosFiltro = construirFiltroDuro(consulta.filtros, exactosParams);
  const { rows: exactos } = await pool.query<{ product_id: string }>(
    `SELECT DISTINCT v.product_id FROM catalog_variants v
     JOIN catalog_products p ON p.product_id = v.product_id
     WHERE v.sku = $1 ${exactosFiltro}`,
    exactosParams,
  );
  const idsExactos = exactos.map((r) => r.product_id);
  const idsExactosSet = new Set(idsExactos);

  // Un código con forma de SKU que no existe no debe convertirse en una
  // consulta semántica: "SKU-INEXISTENTE" no significa "algo parecido".
  if (idsExactos.length === 0 && pareceSku(consulta.semanticQuery)) {
    return { query: consulta, results: [] };
  }

  if (USE_VECTOR && consulta.semanticQuery.trim().length > 0) {
    const embedding = consulta.embeddingPrecalculado ?? (await embeberTexto(consulta.semanticQuery, "RETRIEVAL_QUERY"));
    const params: unknown[] = [`[${embedding.join(",")}]`];
    const filtroDuro = construirFiltroDuro(consulta.filtros, params);
    params.push(VECTOR_LIMIT);

    const { rows } = await pool.query<{ product_id: string; vector_score: number }>(
      `SELECT e.product_id, 1 - (e.embedding <=> $1::vector) AS vector_score
       FROM catalog_embeddings e
       JOIN catalog_products p ON p.product_id = e.product_id
       WHERE true ${filtroDuro}
       ORDER BY e.embedding <=> $1::vector
       LIMIT $${params.length}`,
      params,
    );
    for (const r of rows) {
      vectorScores.set(r.product_id, Number(r.vector_score));
      vectorRanked.push(r.product_id);
    }
  }

  if (USE_FULLTEXT && consulta.semanticQuery.trim().length > 0) {
    const params: unknown[] = [consulta.semanticQuery];
    const filtroDuro = construirFiltroDuro(consulta.filtros, params);
    params.push(VECTOR_LIMIT);

    const { rows } = await pool.query<{ product_id: string; text_score: number }>(
      `SELECT p.product_id, ts_rank(p.search_tsv, q) AS text_score
       FROM catalog_products p, plainto_tsquery('spanish_unaccent', $1) q
       WHERE p.search_tsv @@ q ${filtroDuro}
       ORDER BY text_score DESC
       LIMIT $${params.length}`,
      params,
    );
    for (const r of rows) {
      textScores.set(r.product_id, Number(r.text_score));
      textRanked.push(r.product_id);
    }
  }

  const rrf = fusionarRankings(
    [
      { ids: vectorRanked, peso: PESO_VECTOR },
      { ids: textRanked, peso: PESO_TEXTO },
    ],
    { k: RRF_K },
  );

  let fusionados: ResultadoRetrieval[] = [...rrf.entries()]
    .filter(([productId]) => !idsExactosSet.has(productId)) // no duplicar: van primero, aparte
    .map(([productId, finalScore]) => ({
      productId,
      variantIds: [],
      vectorScore: vectorScores.get(productId) ?? 0,
      textScore: textScores.get(productId) ?? 0,
      finalScore,
    }));

  // Piso de similitud calibrado con el dataset de evaluación — solo descarta ruido
  // semántico puro; un match de texto exacto (SKU, nombre) nunca se descarta así.
  fusionados = fusionados.filter((r) => r.textScore > 0 || r.vectorScore >= MIN_SIMILARITY);
  fusionados.sort((a, b) => b.finalScore - a.finalScore);

  const exactosResultado: ResultadoRetrieval[] = idsExactos.map((productId) => ({
    productId,
    variantIds: [],
    vectorScore: vectorScores.get(productId) ?? 0,
    textScore: textScores.get(productId) ?? 0,
    finalScore: Number.POSITIVE_INFINITY,
  }));

  fusionados = [...exactosResultado, ...fusionados].slice(0, FINAL_LIMIT);

  if (fusionados.length > 0) {
    const ids = fusionados.map((r) => r.productId);
    const params: unknown[] = [ids];
    let filtroVariante = "v.product_id = ANY($1::text[])";
    if (consulta.filtros?.disponible ?? true) filtroVariante += " AND v.available = true";
    if (consulta.filtros?.precioMax != null) {
      params.push(consulta.filtros.precioMax);
      filtroVariante += ` AND v.price <= $${params.length}`;
    }
    // Mismo filtro de forma/diámetro que construirFiltroDuro, aplicado aquí
    // a nivel de VARIANTE: sin esto, un producto podía pasar el filtro
    // duro por tener alguna variante R-5 disponible, pero la whitelist que
    // ve el LLM seguía incluyendo sus otras 8 variantes (R-9, R-12…) — el
    // filtro entraba al ranking sin restringir lo que el modelo puede elegir.
    if (consulta.filtros?.formas?.length) {
      params.push(consulta.filtros.formas);
      filtroVariante += ` AND v.forma = ANY($${params.length}::text[])`;
    }
    if (consulta.filtros?.diametrosPulgadas?.length) {
      params.push(consulta.filtros.diametrosPulgadas);
      filtroVariante += ` AND v.diam_pulg = ANY($${params.length}::numeric[])`;
    }
    const { rows: variantes } = await pool.query<{ product_id: string; variant_id: string }>(
      `SELECT v.product_id, v.variant_id FROM catalog_variants v WHERE ${filtroVariante}`,
      params,
    );
    const porProducto = new Map<string, string[]>();
    for (const v of variantes) {
      porProducto.set(v.product_id, [...(porProducto.get(v.product_id) ?? []), v.variant_id]);
    }
    for (const r of fusionados) r.variantIds = porProducto.get(r.productId) ?? [];
  }

  return { query: consulta, results: fusionados };
}
