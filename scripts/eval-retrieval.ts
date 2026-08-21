import { existsSync } from "node:fs";
import { Pool } from "pg";
import { buscarHibrido } from "../src/lib/rag/retrieval/search";
import type { ConsultaRetrieval } from "../src/lib/rag/retrieval/types";

for (const archivo of [".env.local", ".env"]) {
  if (existsSync(archivo)) process.loadEnvFile(archivo);
}

/**
 * Fase 3B: evaluación del retrieval ANTES de integrarlo al chatbot.
 *
 * El "expected_product_ids" de cada caso no es una relevancia semántica que
 * yo inventé a ojo — es SIEMPRE algo verificable de forma independiente:
 * o es el mismo producto real que generó la consulta (lookup por SKU/nombre),
 * o es el resultado de la MISMA condición aplicada directamente en SQL
 * (ground truth de filtros), o es una consulta que a propósito no matchea
 * nada real. Así la evaluación no depende de mi juicio subjetivo de qué es
 * "relevante" — eso sería exactamente el tipo de autoridad que el plan le
 * quita al LLM (G-05), y no tiene sentido dársela al evaluador.
 */
type CasoEval = {
  categoria: "sku" | "nombre" | "filtro" | "sin_resultado";
  consulta: ConsultaRetrieval;
  esperadoIds: string[];
};

async function construirDataset(pool: Pool): Promise<CasoEval[]> {
  const casos: CasoEval[] = [];

  const { rows: variantesMuestra } = await pool.query<{ product_id: string; sku: string }>(
    `SELECT product_id, sku FROM catalog_variants
     WHERE sku IS NOT NULL AND sku <> ''
     ORDER BY random() LIMIT 15`,
  );
  for (const v of variantesMuestra) {
    casos.push({
      categoria: "sku",
      consulta: { semanticQuery: v.sku, filtros: { disponible: false } },
      esperadoIds: [v.product_id],
    });
  }

  const { rows: productosMuestra } = await pool.query<{ product_id: string; title: string }>(
    `SELECT product_id, title FROM catalog_products ORDER BY random() LIMIT 15`,
  );
  for (const p of productosMuestra) {
    casos.push({
      categoria: "nombre",
      consulta: { semanticQuery: p.title, filtros: { disponible: false } },
      esperadoIds: [p.product_id],
    });
  }

  // Ground truth de filtros: la MISMA condición, calculada aparte con SQL
  // directo — no reutiliza la función de retrieval para no evaluarse contra
  // sí misma.
  const combosFiltro: { texto: string; categoria: string | null; color: string | null; ocasion: string | null; precioMax: number | null }[] = [
    { texto: "globo dorado", categoria: null, color: "dorado", ocasion: null, precioMax: null },
    { texto: "velas para cumpleaños", categoria: "vela", color: null, ocasion: "cumpleanos", precioMax: null },
    { texto: "globo metalizado azul", categoria: "globo_metalizado", color: "azul", ocasion: null, precioMax: null },
    { texto: "decoración económica", categoria: null, color: null, ocasion: null, precioMax: 20000 },
    { texto: "kit de fiesta rosado", categoria: "kit", color: "rosado", ocasion: null, precioMax: null },
    { texto: "guirnalda para boda", categoria: "guirnalda_arco", color: null, ocasion: "boda", precioMax: null },
  ];

  for (const c of combosFiltro) {
    const condiciones = ["p.available = true"];
    const params: unknown[] = [];
    if (c.categoria) { params.push(c.categoria); condiciones.push(`p.derived->>'category' = $${params.length}`); }
    if (c.color) { params.push([c.color]); condiciones.push(`p.derived->'colors' ?| $${params.length}::text[]`); }
    if (c.ocasion) { params.push([c.ocasion]); condiciones.push(`p.derived->'occasions' ?| $${params.length}::text[]`); }
    if (c.precioMax != null) {
      // Ground truth alineado con el fix de retrieval/search.ts: "cabe en el
      // presupuesto" significa que existe una variante DISPONIBLE dentro del
      // tope, no que la variante más barata del producto (aunque esté
      // agotada) esté por debajo — ver PLAN_RAG_FRANJAS_PRESUPUESTO.md §1.2.
      params.push(c.precioMax);
      condiciones.push(
        `EXISTS (SELECT 1 FROM catalog_variants ev WHERE ev.product_id = p.product_id AND ev.available = true AND ev.price <= $${params.length})`,
      );
    }

    const { rows } = await pool.query<{ product_id: string }>(
      `SELECT product_id FROM catalog_products p WHERE ${condiciones.join(" AND ")}`,
      params,
    );
    if (rows.length === 0) continue; // combo sin ground truth real en este catálogo, se descarta

    casos.push({
      categoria: "filtro",
      consulta: {
        semanticQuery: c.texto,
        filtros: {
          disponible: true,
          categorias: c.categoria ? [c.categoria] : undefined,
          colores: c.color ? [c.color] : undefined,
          ocasiones: c.ocasion ? [c.ocasion] : undefined,
          precioMax: c.precioMax ?? undefined,
        },
      },
      esperadoIds: rows.map((r) => r.product_id),
    });
  }

  const sinSentido = [
    "arco iris comestible de unicornio talla XXL",
    "dron decorativo con motor a gasolina",
    "SKU-INEXISTENTE-000000",
    "alfombra voladora para quince años",
    "sofá reclinable de peluche para exteriores",
  ];
  for (const texto of sinSentido) {
    casos.push({ categoria: "sin_resultado", consulta: { semanticQuery: texto }, esperadoIds: [] });
  }

  return casos;
}

function recallAtK(esperado: string[], obtenido: string[], k: number): number | null {
  if (esperado.length === 0) return null; // no aplica a casos sin_resultado
  const topK = new Set(obtenido.slice(0, k));
  const encontrados = esperado.filter((id) => topK.has(id)).length;
  return encontrados / esperado.length;
}

/**
 * Precisión (no recall) para "filtro": el ground truth de estos casos puede
 * tener cientos/miles de productos (ej. "decoración económica" = todo lo
 * <=20000), y ningún ranking puede meter más de 5-20 de esos en el top-K —
 * recall@5 ahí sería un artefacto matemático, no una señal de calidad. Lo
 * que sí es una señal real: si el filtro DURO se aplicó bien, todo lo que
 * vuelve en el top-K tiene que estar dentro del conjunto esperado.
 */
function precisionEnConjunto(esperado: string[], obtenido: string[]): number | null {
  if (obtenido.length === 0) return null;
  const esperadoSet = new Set(esperado);
  const dentro = obtenido.filter((id) => esperadoSet.has(id)).length;
  return dentro / obtenido.length;
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const dataset = await construirDataset(pool);
    console.log(`Dataset de evaluación: ${dataset.length} consultas.\n`);

    const { rows: idsValidos } = await pool.query<{ product_id: string }>("SELECT product_id FROM catalog_products");
    const catalogoValido = new Set(idsValidos.map((r) => r.product_id));

    const recalls: Record<5 | 10 | 20, number[]> = { 5: [], 10: [], 20: [] }; // solo sku+nombre
    const recallsPorCategoria = new Map<CasoEval["categoria"], number[]>();
    const topVectorPorCategoria = new Map<CasoEval["categoria"], number[]>();
    const precisionesFiltro: number[] = [];
    let sinResultadoTotal = 0;
    let sinResultadoAcertados = 0;
    let idsInvalidosTotal = 0;
    let resultadosTotal = 0;
    const detalle: string[] = [];

    for (const caso of dataset) {
      const respuesta = await buscarHibrido(pool, caso.consulta);
      const obtenidoIds = respuesta.results.map((r) => r.productId);
      const topVector = Math.max(0, ...respuesta.results.map((result) => result.vectorScore));
      topVectorPorCategoria.set(caso.categoria, [...(topVectorPorCategoria.get(caso.categoria) ?? []), topVector]);

      resultadosTotal += obtenidoIds.length;
      idsInvalidosTotal += obtenidoIds.filter((id) => !catalogoValido.has(id)).length;

      if (caso.categoria === "sin_resultado") {
        sinResultadoTotal++;
        if (obtenidoIds.length === 0) sinResultadoAcertados++;
        else detalle.push(`[sin_resultado FALLÓ] "${caso.consulta.semanticQuery}" → ${obtenidoIds.length} resultado(s), top_vector=${topVector.toFixed(3)}`);
        continue;
      }

      if (caso.categoria === "filtro") {
        const precision = precisionEnConjunto(caso.esperadoIds, obtenidoIds);
        if (precision !== null) {
          precisionesFiltro.push(precision);
          if (precision < 1) {
            detalle.push(
              `[filtro precision=${precision.toFixed(2)}] "${caso.consulta.semanticQuery}" — ${obtenidoIds.length} obtenidos, ${obtenidoIds.filter((id) => !caso.esperadoIds.includes(id)).length} fuera del conjunto esperado (${caso.esperadoIds.length} productos)`,
            );
          }
        }
        continue;
      }

      // sku / nombre: expected = 1 producto, recall@K sí es una métrica interpretable aquí.
      for (const k of [5, 10, 20] as const) {
        const r = recallAtK(caso.esperadoIds, obtenidoIds, k);
        if (r !== null) recalls[k].push(r);
      }
      const r5 = recallAtK(caso.esperadoIds, obtenidoIds, 5);
      if (r5 !== null) {
        recallsPorCategoria.set(caso.categoria, [...(recallsPorCategoria.get(caso.categoria) ?? []), r5]);
      }
      if (r5 !== null && r5 < 1) {
        detalle.push(
          `[${caso.categoria} recall@5=${r5.toFixed(2)}] "${caso.consulta.semanticQuery}" — esperados ${caso.esperadoIds.length}, top5 obtenido ${obtenidoIds.slice(0, 5).join(",")}`,
        );
      }
    }

    const promedio = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

    console.log("--- Métricas Fase 3B (sku + nombre: expected=1 producto) ---");
    console.log(`Recall@5:  ${promedio(recalls[5]).toFixed(3)} (${recalls[5].length} consultas)`);
    console.log(`Recall@10: ${promedio(recalls[10]).toFixed(3)} (${recalls[10].length} consultas)`);
    console.log(`Recall@20: ${promedio(recalls[20]).toFixed(3)} (${recalls[20].length} consultas)`);
    console.log(`\nFiltro — precisión (obtenido ⊆ esperado): ${promedio(precisionesFiltro).toFixed(3)} (${precisionesFiltro.length} consultas)`);
    console.log(
      `No-result accuracy: ${sinResultadoAcertados}/${sinResultadoTotal} (${sinResultadoTotal ? ((sinResultadoAcertados / sinResultadoTotal) * 100).toFixed(0) : "—"}%)`,
    );
    console.log(
      `Invalid result rate: ${idsInvalidosTotal}/${resultadosTotal} (${resultadosTotal ? ((idsInvalidosTotal / resultadosTotal) * 100).toFixed(2) : "0"}%)`,
    );

    if (detalle.length) {
      console.log("\n--- Casos con recall<1, precisión<1 o sin_resultado fallido ---");
      for (const d of detalle) console.log(d);
    }

    console.log("\n--- Recall@5 por categoría ---");
    for (const [categoria, rs] of recallsPorCategoria) {
      console.log(`  ${categoria}: ${promedio(rs).toFixed(3)} (${rs.length} consultas)`);
    }
    console.log("\n--- Similitud vectorial máxima por categoría ---");
    for (const [categoria, scores] of topVectorPorCategoria) {
      console.log(`  ${categoria}: min=${Math.min(...scores).toFixed(3)}, avg=${promedio(scores).toFixed(3)}, max=${Math.max(...scores).toFixed(3)}`);
    }

    const recallSku = promedio(recallsPorCategoria.get("sku") ?? []);
    const recallNombre = promedio(recallsPorCategoria.get("nombre") ?? []);
    const recallGlobal = promedio([...recalls[5]]);

    console.log("\n--- Criterios de aceptación Fase 3 ---");
    console.log(`[${recallSku >= 0.9 ? "PASS" : "FAIL"}] producto por SKU recuperable (recall@5 >= 0.90)`);
    console.log(`[${recallNombre >= 0.9 ? "PASS" : "FAIL"}] producto por nombre recuperable (recall@5 >= 0.90)`);
    console.log(`[${recallGlobal >= 0.7 ? "PASS" : "FAIL"}] Recall@5 (sku+nombre) >= 0.70`);
    console.log(`[${promedio(precisionesFiltro) >= 0.95 ? "PASS" : "FAIL"}] filtros duros no devuelven fuera del conjunto esperado (precisión >= 0.95)`);
    console.log(`[${idsInvalidosTotal === 0 ? "PASS" : "FAIL"}] retrieval no devuelve IDs inexistentes`);
    console.log(`[${sinResultadoTotal === 0 || sinResultadoAcertados / sinResultadoTotal >= 0.8 ? "PASS" : "FAIL"}] no-result accuracy >= 80%`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[FAIL] evaluación falló:", error);
  process.exitCode = 1;
});
