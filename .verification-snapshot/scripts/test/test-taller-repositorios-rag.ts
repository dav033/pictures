/**
 * REQ-013 fase 3: mobiliario y escenografía indexados en el RAG del taller, invisibles por defecto. Postgres real en memoria (PGlite
 * con pgvector, pg_trgm y unaccent), migraciones 028 + 034, las 53 fichas reales de los dos repositorios (`fichasDeRepositorio`,
 * por el mismo JSONL que lee el indexador) y un fondo de Sempertex de 400 filas; vectores de texto y de render sintéticos y deterministas
 * (sin red ni gasto).
 * - por defecto (`CATALOGO_REPOS_RAG` sin definir) la búsqueda del Taller nunca devuelve una fila de mobiliario ni de escenografía,
 *   ni por texto, ni por vector, ni en memoria; el producto guiado y el estudio ni alcanzan la búsqueda y solo ven Sempertex;
 * - con la bandera que los hace visibles, sí aparecen (y solo los que nombra);
 * - AC-8, sin hambre de candidatos: un repositorio de 28 filas recibe sus 28 candidatos de cada rama vectorial (texto e imagen) y su
 *   item relevante primero, también cuando el planificador prefiere el HNSW (`enable_sort = off`), que con la forma de Sempertex le
 *   dejaría unos pocos.
 *
 *   PGLITE_DIR=<carpeta con node_modules/@electric-sql/pglite y pglite-pgvector> \
 *     NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-taller-repositorios-rag.ts
 *
 * PGlite no es dependencia del proyecto: sin él la prueba FALLA con ese aviso (no se salta en silencio).
 */
import assert from "node:assert/strict";
import path from "node:path";
import { abrirPglite, prepararEsquemaTaller, type BasePglite } from "../taller/pglite-taller";
import { archivos, cerradura, colado, SRC } from "./lib-cerradura-imports";
import { fichasDeRepositorio } from "../../src/lib/catalogo/fichas-fondos";
import { reposVisibles } from "../../src/lib/catalogo/visibilidad";
import type { DependenciasBuscar, RespuestaBusquedaTaller } from "../../src/lib/taller/buscar";
import { buscarVisible } from "../../src/lib/taller/buscar-visible";
import { construirConsultaBusqueda, vectorExacto } from "../../src/lib/taller/buscar-sql";
import { construirUpsertEmbeddingsLote, construirUpsertItem, leerFichasJsonl, MODELO_EMBEDDING_TALLER, type RegistroParaIndice } from "../../src/lib/taller/indice";

const DIR_PGLITE = process.argv.find((a) => a.startsWith("--pglite="))?.slice("--pglite=".length) ?? process.env.PGLITE_DIR;
const FILAS_SEMPERTEX = 400;
const TODOS = "sempertex,mobiliario,escenografia";

let casos = 0;
const ok = (nombre: string) => { casos += 1; console.log(`ok ${casos} - ${nombre}`); };

/** Un vector unitario pseudoaleatorio por id (FNV + xorshift): el mismo en cada corrida. */
function vectorDe(id: string, cerca?: { de: readonly number[]; ruido: number }): number[] {
  let h = 2166136261;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const azar = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return (h >>> 0) / 4294967296 - 0.5; };
  const v = Array.from({ length: 768 }, (_, i) => (cerca ? cerca.de[i]! + azar() * cerca.ruido : azar()));
  const norma = Math.hypot(...v);
  return v.map((x) => x / norma);
}
const coseno = (a: readonly number[], b: readonly number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0);

function sempertex(i: number): RegistroParaIndice {
  return {
    id: `idea:fondo-${i}`, repositorio: "sempertex", tipo: "estructura", nombre: `Arco orgánico ${i}`, descripcion: "", fuente: { tipo: "idea-sempertex", titulo: "t" },
    ocasiones: [], tiposPieza: ["arco"], formatos: ["R-12"], colores: [], partes: [], lineasPartes: [], productos: [], medidas: {}, globos: 40, tubos: 0, hash: `h${i}`,
    ficha: `Arco orgánico de globos número ${i} para la fiesta.`,
  };
}
/** De Sempertex, con las palabras que también dicen los muebles: la consulta por defecto tiene qué devolver. */
const SEMPERTEX_PARECIDOS: RegistroParaIndice[] = [
  { ...sempertex(9001), id: "idea:sillas-con-globos", nombre: "Sillas decoradas con globos", ficha: "Sillas tiffany doradas decoradas con globos dorados para boda." },
  { ...sempertex(9002), id: "idea:panel-redondo-globos", nombre: "Panel redondo con arco orgánico", ficha: "Panel redondo con arco orgánico de globos y cortina de flecos." },
];

type Vectores = Record<"texto" | "imagen_render", Map<string, number[]>>;

async function indexar(db: BasePglite): Promise<{ fondos: RegistroParaIndice[]; vectores: Vectores }> {
  await prepararEsquemaTaller(db);
  const jsonl = [...fichasDeRepositorio("mobiliario"), ...fichasDeRepositorio("escenografia")].map((r) => JSON.stringify(r)).join("\n");
  const { registros: fondos, errores } = leerFichasJsonl(jsonl);
  assert.deepEqual(errores, []);
  const filas = [...Array.from({ length: FILAS_SEMPERTEX }, (_, i) => sempertex(i)), ...SEMPERTEX_PARECIDOS, ...fondos];
  for (const r of filas) { const u = construirUpsertItem(r); await db.query(u.texto, u.valores); }
  // Los repositorios nuevos no tienen renders (solo se embebe su texto); aquí sí, para ejercitar la rama de imagen.
  const vectores: Vectores = { texto: new Map(filas.map((r) => [r.id, vectorDe(r.id)])), imagen_render: new Map(filas.map((r) => [r.id, vectorDe(`render:${r.id}`)])) };
  const entradas = (["texto", "imagen_render"] as const).flatMap((modalidad) => [...vectores[modalidad]].map(([itemId, vector]) => ({ itemId, modalidad, modelo: MODELO_EMBEDDING_TALLER, vector, hashEntrada: itemId })));
  for (const c of construirUpsertEmbeddingsLote(entradas)) await db.query(c.texto, c.valores);
  await db.exec("ANALYZE taller_items; ANALYZE taller_items_embeddings;");
  return { fondos, vectores };
}

async function conVariable<T>(valor: string | undefined, fn: () => Promise<T>): Promise<T> {
  const antes = process.env.CATALOGO_REPOS_RAG;
  if (valor === undefined) delete process.env.CATALOGO_REPOS_RAG;
  else process.env.CATALOGO_REPOS_RAG = valor;
  try {
    return await fn();
  } finally {
    if (antes === undefined) delete process.env.CATALOGO_REPOS_RAG;
    else process.env.CATALOGO_REPOS_RAG = antes;
  }
}

const ajenos = (r: RespuestaBusquedaTaller) => r.resultados.filter((x) => x.repositorio !== "sempertex").map((x) => `${x.id}:${x.repositorio}`);

async function main(): Promise<void> {
  if (!DIR_PGLITE) throw new Error("Falta PGlite: PGLITE_DIR=<carpeta> o --pglite=<carpeta> (npm i @electric-sql/pglite @electric-sql/pglite-pgvector en una carpeta aparte).");
  const db = await abrirPglite(DIR_PGLITE);
  const { fondos, vectores } = await indexar(db);
  const repos = await db.query("SELECT repositorio, count(*)::int AS n FROM taller_items GROUP BY 1 ORDER BY 1");
  assert.deepEqual(repos.rows, [{ repositorio: "escenografia", n: 25 }, { repositorio: "mobiliario", n: 28 }, { repositorio: "sempertex", n: FILAS_SEMPERTEX + 2 }]);
  const pool = { query: (texto: string, valores?: unknown[]) => db.query(texto, valores) };
  /** La consulta se embebe cerca del vector de `cerca` (el item que debería salir). */
  const deps = (cerca: string): DependenciasBuscar => ({ habilitado: true, obtenerPool: () => pool as never, embeberConsulta: async () => vectorDe(`q:${cerca}`, { de: vectores.texto.get(cerca)!, ruido: 0.02 }) });
  const CONSULTAS: Array<[string, string]> = [["sillas tiffany doradas", "silla_tiffany"], ["panel redondo", "panel_redondo"], ["cortina de flecos", "cortina_flecos"], ["mesa imperial para 10", "mesa_imperial_sillas"], ["base para el pastel", "base_pastel"]];

  // 1. Por defecto, invisibles.
  await conVariable(undefined, async () => {
    for (const [texto, esperado] of CONSULTAS) {
      const r = await buscarVisible({ texto, limite: 50 }, deps(esperado));
      assert.equal(r.fuente, "rag");
      assert.ok(r.ramas.includes("vector_texto") && r.ramas.includes("fts"), r.ramas.join());
      assert.deepEqual(ajenos(r), [], `«${texto}»: ninguna fila de mobiliario ni de escenografía`);
    }
    const sillas = await buscarVisible({ texto: "sillas tiffany doradas", limite: 50 }, deps("silla_tiffany"));
    assert.equal(sillas.ids[0], "idea:sillas-con-globos", "lo de Sempertex que dice lo mismo sí sale");
    const porVector = await buscarVisible({ vectorTexto: vectores.texto.get("silla_tiffany")!, limite: 50 }, deps("silla_tiffany"));
    assert.equal(porVector.resultados.length, 50);
    assert.deepEqual(ajenos(porVector), [], "ni con el vector exacto de la silla");
    const porFoto = await buscarVisible({ vectorImagen: vectores.imagen_render.get("panel_redondo")!, limite: 50 }, deps("panel_redondo"));
    assert.equal(porFoto.resultados.length, 50);
    assert.deepEqual(ajenos(porFoto), [], "ni por foto con el render exacto del panel");
    const pedido = await buscarVisible({ texto: "silla", limite: 50, filtros: { repositorios: ["mobiliario"] } }, deps("silla_tiffany"));
    assert.deepEqual(pedido.ids, [], "pedir mobiliario sin verlo: nada");
    const memoria = await buscarVisible({ texto: "silla", limite: 15 }, { habilitado: false });
    assert.deepEqual(ajenos(memoria), [], "ni el respaldo en memoria");
  });
  ok("por defecto el Taller no ve mobiliario ni escenografía: ni por texto, ni por vector, ni pidiéndolo, ni en memoria");

  // 2. El producto guiado y el estudio: ni alcanzan la búsqueda, y su visibilidad sigue siendo Sempertex con la bandera del RAG abierta.
  await conVariable(TODOS, async () => {
    assert.deepEqual(reposVisibles("rag"), ["sempertex", "mobiliario", "escenografia"]);
    assert.deepEqual(reposVisibles("guiada"), ["sempertex"]);
    assert.deepEqual(reposVisibles("estudio"), ["sempertex"]);
  });
  const MOTOR = path.join(SRC, "lib", "globos3d", "motor");
  const GUIADO = [MOTOR, path.join(SRC, "app", "api", "asistente-guiado"), path.join(SRC, "app", "api", "guiada"), path.join(SRC, "lib", "guiada-motor"), path.join(SRC, "lib", "ia", "guiado"), path.join(SRC, "components", "guiado"), path.join(SRC, "app", "asistente")];
  const ESTUDIO = [path.join(SRC, "app", "3d", "modulos"), path.join(SRC, "lib", "modulos-estudio")];
  const BUSQUEDA = ["buscar.ts", "buscar-sql.ts", "buscar-visible.ts", "indice.ts"].map((f) => path.join(SRC, "lib", "taller", f));
  for (const [nombre, raices] of [["guiado", GUIADO], ["estudio", ESTUDIO]] as const) {
    const visto = cerradura(raices.flatMap((r) => archivos(r)));
    assert.ok(visto.size > 50, `${nombre}: la cerradura no es vacía`);
    assert.equal(colado(visto, BUSQUEDA), null, `${nombre} no lee taller_items`);
  }
  assert.ok(colado(cerradura([path.join(SRC, "app", "api", "taller", "buscar", "route.ts")]), BUSQUEDA), "la prueba no es vacía: la ruta del Taller sí la alcanza");
  ok("el producto guiado y el estudio no alcanzan la búsqueda del RAG y ven solo Sempertex aunque el RAG vea los tres");

  // 3. Con la bandera, aparecen (y solo los que nombra).
  await conVariable(TODOS, async () => {
    for (const [texto, esperado] of CONSULTAS) {
      const r = await buscarVisible({ texto, limite: 12 }, deps(esperado));
      assert.equal(r.fuente, "rag", `«${texto}»: respondió la base (un SQL roto caería a memoria en silencio)`);
      const i = r.ids.indexOf(esperado);
      assert.ok(i >= 0 && i < 3, `«${texto}»: ${esperado} entre los 3 primeros (${r.ids.slice(0, 5).join(", ")})`);
      assert.equal(r.resultados[i]!.repositorio, fondos.find((f) => f.id === esperado)!.repositorio);
    }
  });
  await conVariable(TODOS, async () => {
    const foto = await buscarVisible({ vectorImagen: vectores.imagen_render.get("panel_redondo")!, limite: 5 }, deps("panel_redondo"));
    assert.deepEqual([foto.fuente, foto.ramas, foto.ids[0]], ["rag", ["vector_imagen"], "panel_redondo"], "por foto, el render del panel trae el panel");
  });
  await conVariable("sempertex,mobiliario", async () => {
    const r = await buscarVisible({ texto: "panel redondo cortina de flecos silla", limite: 50 }, deps("panel_redondo"));
    assert.ok(r.resultados.some((x) => x.repositorio === "mobiliario"), "mobiliario sí");
    assert.ok(!r.resultados.some((x) => x.repositorio === "escenografia"), "escenografía no: la bandera no la nombra");
  });
  ok("con CATALOGO_REPOS_RAG que los nombra, cada mueble o fondo sale entre los 3 primeros de su consulta; el que no nombra, no");

  // 4. AC-8: un repositorio de 28 filas no se queda sin candidatos de ninguna rama vectorial.
  assert.ok(vectorExacto({ repositorios: ["mobiliario"], conColumna: true }) && !vectorExacto({ repositorios: ["sempertex"], conColumna: true }));
  const RAMAS = [
    ["texto", "vectorTexto", "vector_texto", "ix_taller_items_embeddings_texto_hnsw"],
    ["imagen_render", "vectorImagen", "vector_imagen", "ix_taller_items_embeddings_imagen_hnsw"],
  ] as const;
  const hambre: string[] = [];
  for (const [modalidad, campo, rama, indice] of RAMAS) {
    // Lejos del repositorio: cerca de un item de Sempertex, así el HNSW (los ~40 más cercanos de todo) casi no trae muebles.
    const consulta = vectorDe(`q:lejos:${modalidad}`, { de: vectores[modalidad].get("idea:fondo-7")!, ruido: 0.02 });
    const relevante = fondos.filter((f) => f.repositorio === "mobiliario").map((f) => ({ id: f.id, c: coseno(consulta, vectores[modalidad].get(f.id)!) })).sort((a, b) => b.c - a.c)[0]!.id;
    for (const preferirIndice of [false, true]) {
      if (preferirIndice) await db.exec("SET enable_sort = off;");
      const r = await conVariable(TODOS, () => buscarVisible({ [campo]: consulta, limite: 50, filtros: { repositorios: ["mobiliario"] } }, deps(relevante)));
      assert.equal(r.resultados.filter((x) => x.ramas[rama]).length, 28, `${rama}: 28 candidatos (preferir el índice: ${preferirIndice})`);
      assert.ok(r.resultados.every((x) => x.repositorio === "mobiliario"));
      assert.equal(r.ids[0], relevante, `${rama}: el relevante (el más cercano del repositorio) primero`);
    }
    // La forma de Sempertex (ORDER BY la distancia, que el HNSW sí sirve) con el mismo filtro: lo que pasaría sin el arreglo.
    const deSempertex = construirConsultaBusqueda({ [campo]: consulta, limite: 50 }, { repositorios: ["sempertex"], conColumna: true });
    const valores = deSempertex.valores.map((v) => (Array.isArray(v) && v.length === 1 && v[0] === "sempertex" ? ["mobiliario"] : v));
    const plan = (await db.query(`EXPLAIN ${deSempertex.texto}`, valores)).rows.map((f) => String((f as Record<string, unknown>)["QUERY PLAN"]));
    const quedan = (await db.query(deSempertex.texto, valores)).rows.filter((f) => (f as Record<string, unknown>)[`rango_${rama}`] !== null).length;
    assert.ok(plan.some((l) => l.includes(indice)) && quedan < 28, `la prueba no es vacía: con el HNSW la forma de Sempertex le deja ${quedan} de 28 en ${rama}`);
    hambre.push(`${rama} ${quedan}`);
    await db.exec("RESET enable_sort;");
  }
  ok(`AC-8: el repositorio de 28 filas recibe sus 28 candidatos por texto y por imagen, y su relevante primero, también prefiriendo el índice (la forma de Sempertex le dejaría ${hambre.join(", ")})`);

  console.log(`\n${casos} casos ok`);
}

main().then(() => process.exit(0), (error) => {
  console.error(error);
  process.exit(1);
});
