/**
 * Evalúa el RAG de la biblioteca sin base remota (REQ-002, paso 7): levanta PGlite (Postgres en memoria con pgvector,
 * pg_trgm y unaccent), aplica las migraciones 028 y 034 (partición por repositorio, REQ-013), indexa data/taller/fichas.jsonl con los vectores de
 * data/taller/embeddings y compara con el oro: búsqueda de hoy, RAG léxico, RAG híbrido y fotos del dueño → vistas 3D.
 * Dos oros por separado: el de desarrollo (40 consultas, con el que se afina) y el de reserva (15, que no se mira al
 * afinar y sirve para detectar sobreajuste). Los embeddings de las consultas se cachean en
 * data/taller/eval-vectores-consulta.json (la primera vez de cada texto paga ~US$0,000002 con GEMINI_API_KEY).
 *
 *   npx tsx --conditions=react-server scripts/taller/evaluar-rag-local.ts --pglite=<carpeta> [--db=<carpeta>] [--detalle]
 *     [--afinado='{"factorHermano":0.6}'] [--grilla=<archivo.json con [{"nombre":"…","afinado":{…}}]>]
 *
 * `--db=<carpeta>` guarda la base indexada en disco y la reutiliza (el indexado tarda ~1,5 min); bórrala si cambian las
 * fichas, los vectores o la migración. `--detalle` imprime, por consulta, el nDCG y los primeros resultados de cada oro.
 * `--consulta="texto"` muestra el top 15 de una consulta con los rangos por rama y los refuerzos (para depurar).
 * `--afinado` prueba otros pesos o bonos (ver `Afinado` en buscar-sql.ts); `--grilla` prueba varios en una corrida y
 * imprime una línea por configuración (desarrollo, reserva y peor categoría contra la búsqueda de hoy).
 * `--salida=<archivo.json>` guarda el resumen (promedios de hoy y del RAG híbrido por oro, y de las fotos) para compararlo luego.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { abrirPglite, leerMigracion, prepararEsquemaTaller } from "./pglite-taller";
import { construirUpsertItem, construirBorrarPartes, construirInsertPartes, construirUpsertEmbedding, leerFichasJsonl, MODELO_EMBEDDING_TALLER } from "../../src/lib/taller/indice";
import { buscarEnTaller } from "../../src/lib/taller/buscar";
import type { Afinado } from "../../src/lib/taller/buscar-sql";
import { leerVectoresCacheados } from "../../src/lib/taller/vectores-cache";
import { consultasDeFoto, consultasDeTexto, desglosePorCategoria, evaluarSistema, peoresConsultas, tablaComparativa, type OroBusqueda, type ResultadoSistema, type SistemaBusqueda } from "../../src/lib/taller/evaluar";
import { leerOro } from "../../src/lib/taller/evaluar-oro";
import { sistemaActual } from "./sistemas-busqueda";
import { embeberTexto } from "../../src/lib/rag/embeddings";

// PGlite no es dependencia del repo: se instala aparte (npm i @electric-sql/pglite @electric-sql/pglite-pgvector) y se pasa su carpeta.
const argumento = (clave: string): string | undefined => process.argv.find((a) => a.startsWith(`--${clave}=`))?.slice(clave.length + 3);
const DIR_PGLITE = argumento("pglite") ?? process.env.PGLITE_DIR;
const DIR_BASE = argumento("db");
const DETALLE = process.argv.includes("--detalle");
const AFINADO: Partial<Afinado> = JSON.parse(argumento("afinado") ?? "{}");
const GRILLA = argumento("grilla");
const CONSULTA = argumento("consulta");
const SALIDA = argumento("salida");
if (!DIR_PGLITE) { console.error("Falta --pglite=<carpeta con node_modules/@electric-sql/pglite>"); process.exit(2); }
const CACHE_Q = "data/taller/eval-vectores-consulta.json";
const leerOroArchivo = (ruta: string): OroBusqueda => leerOro(JSON.parse(readFileSync(ruta, "utf8")));

type Db = { query: (t: string, v?: unknown[]) => Promise<{ rows: unknown[] }>; exec: (t: string) => Promise<unknown> };

/**
 * Con estadísticas, como Neon (autovacuum): sin ellas el planificador estima mal el tamaño de `filtrados` y elige para la rama
 * vectorial el HNSW aproximado (~40 candidatos, `ef_search`) o el orden exacto según esa estimación, no según los datos.
 */
const ANALIZAR = "ANALYZE taller_items; ANALYZE taller_items_embeddings;";

async function abrirBase(): Promise<{ db: Db; fotosDueno: Map<string, number[]> }> {
  const db: Db = await abrirPglite(DIR_PGLITE!, DIR_BASE);
  const { registros } = leerFichasJsonl(readFileSync("data/taller/fichas.jsonl", "utf8"));
  const fichaPorId = new Map(registros.map((r) => [r.id, r]));
  const vecs = leerVectoresCacheados("data/taller/embeddings");
  const fotosDueno = new Map<string, number[]>();
  for (const v of vecs) if (v.modalidad === "imagen_foto") fotosDueno.set(v.id, Array.from(v.vector));

  const yaIndexada = DIR_BASE ? await db.query("SELECT count(*)::int AS n FROM taller_items").then((r) => Number((r.rows[0] as { n: number }).n) === registros.length, () => false) : false;
  if (yaIndexada) {
    // Una base guardada antes de REQ-013 no tiene la columna `repositorio`: 034 es idempotente y la deja como en Neon.
    await db.exec(leerMigracion("034_catalogo_repositorios.sql"));
    await db.exec(ANALIZAR);
    console.log("base reutilizada de", DIR_BASE, "items", registros.length);
    return { db, fotosDueno };
  }

  await prepararEsquemaTaller(db);
  for (const r of registros) {
    const u = construirUpsertItem(r); await db.query(u.texto, u.valores);
    for (const q of [construirBorrarPartes(r.id), ...construirInsertPartes(r)]) await db.query(q.texto, q.valores);
  }
  let nt = 0, nr = 0;
  for (const v of vecs) {
    if (v.modalidad === "imagen_foto" || !fichaPorId.has(v.id)) continue;
    const e = construirUpsertEmbedding({ itemId: v.id, modalidad: v.modalidad, modelo: MODELO_EMBEDDING_TALLER, vector: Array.from(v.vector), hashEntrada: v.hashEntrada });
    await db.query(e.texto, e.valores); if (v.modalidad === "texto") nt++; else nr++;
  }
  await db.exec(ANALIZAR);
  console.log("items", registros.length, "vectores texto", nt, "render", nr, "fotos dueño", fotosDueno.size);
  return { db, fotosDueno };
}

/** Compara por categoría la búsqueda de hoy con el RAG híbrido (nDCG@10) y marca lo que empeora más de 0,05. */
function tablaCategorias(titulo: string, actual: ResultadoSistema, hibrido: ResultadoSistema): void {
  const a = new Map(desglosePorCategoria(actual).map((c) => [c.categoria, c]));
  console.log(`\n${titulo}: nDCG@10 por categoría (hoy → RAG híbrido)`);
  for (const c of desglosePorCategoria(hibrido)) {
    const base = a.get(c.categoria)!;
    const delta = c.metricas.ndcg10 - base.metricas.ndcg10;
    console.log(`  ${c.categoria.padEnd(10)} n=${String(c.n).padStart(2)}  ${base.metricas.ndcg10.toFixed(2)} → ${c.metricas.ndcg10.toFixed(2)}  ${delta >= 0 ? "+" : ""}${delta.toFixed(2)}${delta < -0.05 ? "  <-- PEOR" : ""}`);
  }
}

type Deps = (conVector: boolean, afinado?: Partial<Afinado>) => Parameters<typeof buscarEnTaller>[1];

/** Una línea por configuración: nDCG, MRR y recall@10 de desarrollo y reserva, y la categoría que más cae contra la búsqueda de hoy. */
async function correrGrilla(configs: Array<{ nombre: string; afinado: Partial<Afinado> }>, dev: OroBusqueda, reserva: OroBusqueda, deps: Deps): Promise<void> {
  const base: Record<string, ResultadoSistema> = {};
  const oros: Array<[string, OroBusqueda]> = [["dev", dev], ["res", reserva]];
  for (const [nombre, oro] of oros) base[nombre] = await evaluarSistema(sistemaActual, consultasDeTexto(oro));
  const f = (n: number) => n.toFixed(3);
  for (const c of configs) {
    const sistema: SistemaBusqueda = { nombre: c.nombre, buscarTexto: async (texto, limite) => (await buscarEnTaller({ texto, limite }, deps(true, c.afinado))).ids };
    const partes: string[] = [];
    for (const [nombre, oro] of oros) {
      const r = await evaluarSistema(sistema, consultasDeTexto(oro));
      const hoy = new Map(desglosePorCategoria(base[nombre]!).map((x) => [x.categoria, x.metricas.ndcg10]));
      const peor = desglosePorCategoria(r).map((x) => ({ categoria: x.categoria, delta: x.metricas.ndcg10 - (hoy.get(x.categoria) ?? 0) })).sort((a, b) => a.delta - b.delta)[0]!;
      partes.push(`${nombre} nDCG ${f(r.promedio.ndcg10)} MRR ${f(r.promedio.mrr)} rec10 ${(r.promedio.recall10 * 100).toFixed(1)} peor ${peor.categoria} ${peor.delta.toFixed(2)}`);
    }
    console.log(`${c.nombre.padEnd(28)} | ${partes.join(" | ")}`);
  }
}

async function main() {
  const { db, fotosDueno } = await abrirBase();
  const pool = { query: (t: string, v: unknown[]) => db.query(t, v) };
  const cacheQ: Record<string, number[]> = existsSync(CACHE_Q) ? JSON.parse(readFileSync(CACHE_Q, "utf8")) : {};
  const embeber = async (t: string) => { if (!cacheQ[t]) { cacheQ[t] = await embeberTexto(t, "RETRIEVAL_QUERY"); writeFileSync(CACHE_Q, JSON.stringify(cacheQ)); } return cacheQ[t]; };
  const dev = leerOroArchivo("scripts/test/fixtures/oro-busqueda-taller.json");
  const reserva = leerOroArchivo("scripts/test/fixtures/oro-busqueda-taller-holdout.json");
  const deps = (conVector: boolean, afinado: Partial<Afinado> = AFINADO) => ({ habilitado: true, obtenerPool: () => pool as never, embeberConsulta: conVector ? embeber : async () => undefined, afinado });
  const ragLex: SistemaBusqueda = { nombre: "RAG léxico", buscarTexto: async (texto, limite) => (await buscarEnTaller({ texto, limite }, deps(false))).ids };
  const ragHib: SistemaBusqueda = {
    nombre: "RAG híbrido",
    buscarTexto: async (texto, limite) => (await buscarEnTaller({ texto, limite }, deps(true))).ids,
    buscarFoto: async (archivo, limite) => {
      const f = dev.fotos.find((x) => x.archivo === archivo)!;
      const v = fotosDueno.get(f.esperado); if (!v) throw new Error("sin vector de foto " + f.esperado);
      return (await buscarEnTaller({ vectorImagen: v, limite }, deps(false))).ids;
    },
  };

  if (CONSULTA) {
    const r = await buscarEnTaller({ texto: CONSULTA, limite: 15 }, deps(true));
    console.log("interpretación:", JSON.stringify(r.interpretacion), "ramas", r.ramas.join(","));
    for (const x of r.resultados) console.log(x.puntaje.toFixed(4), x.id, "|", x.nombre.slice(0, 50), "|", Object.entries(x.ramas).filter(([, v]) => v).map(([k, v]) => k.replace("vector_", "v") + "#" + v!.rango).join(" "), "|", x.razones.filter((z) => !/^(Las palabras|Su nombre|Su significado)/.test(z)).map((z) => z.split(" (")[0]).join("; "));
    return;
  }
  if (GRILLA) { await correrGrilla(JSON.parse(readFileSync(GRILLA, "utf8")), dev, reserva, deps); return; }

  const resultados: Record<string, { actual: ResultadoSistema; hibrido: ResultadoSistema }> = {};
  for (const [titulo, oro] of [["Desarrollo", dev], ["Reserva", reserva]] as const) {
    const consultas = consultasDeTexto(oro);
    const corridas = [];
    for (const s of [sistemaActual, ragLex, ragHib]) corridas.push({ sistema: s.nombre, resultado: await evaluarSistema(s, consultas) });
    console.log(`\n${tablaComparativa(`${titulo} (${consultas.length} consultas)`, corridas)}`);
    resultados[titulo] = { actual: corridas[0]!.resultado, hibrido: corridas[2]!.resultado };
    tablaCategorias(titulo, corridas[0]!.resultado, corridas[2]!.resultado);
    if (DETALLE) {
      for (const c of corridas[2]!.resultado.consultas) {
        const esperados = new Set(c.relevantes.map((r) => r.id));
        console.log(`  ${c.id} nDCG ${c.metricas.ndcg10.toFixed(2)} «${c.texto}» → ${c.devueltos.slice(0, 6).map((id) => (esperados.has(id) ? "+" : "-") + id).join(" | ")}`);
      }
    } else {
      for (const p of peoresConsultas(corridas[2]!.resultado, 6)) console.log("  peor", p.id, p.texto, "nDCG", p.metricas.ndcg10.toFixed(2), "→", p.devueltos.slice(0, 3).join(" | "));
    }
  }
  const fotos = await evaluarSistema(ragHib, consultasDeFoto(dev));
  console.log(`\n${tablaComparativa("Fotos del dueño → vistas 3D (13)", [{ sistema: "RAG híbrido (imagen)", resultado: fotos }])}`);
  for (const c of fotos.consultas) if (c.metricas.acierto5 < 1 || DETALLE) console.log("  foto", c.texto, "acierto@5", c.metricas.acierto5, "top3", c.devueltos.slice(0, 3).join(" | "));
  const d = resultados.Desarrollo!, r = resultados.Reserva!;
  const par = (x: { actual: ResultadoSistema; hibrido: ResultadoSistema }) => `nDCG ${x.actual.promedio.ndcg10.toFixed(3)} → ${x.hibrido.promedio.ndcg10.toFixed(3)}, MRR ${x.actual.promedio.mrr.toFixed(3)} → ${x.hibrido.promedio.mrr.toFixed(3)}, recall@10 ${(x.actual.promedio.recall10 * 100).toFixed(1)}% → ${(x.hibrido.promedio.recall10 * 100).toFixed(1)}%`;
  console.log(`\nRESUMEN (hoy → RAG híbrido)\n  desarrollo: ${par(d)}\n  reserva:    ${par(r)}\n  fotos acierto@5: ${(fotos.promedio.acierto5 * 100).toFixed(0)}%`);
  if (SALIDA) {
    const promedios = (x: { actual: ResultadoSistema; hibrido: ResultadoSistema }) => ({ actual: x.actual.promedio, hibrido: x.hibrido.promedio });
    writeFileSync(SALIDA, JSON.stringify({ fecha: new Date().toISOString(), desarrollo: promedios(d), reserva: promedios(r), fotos: fotos.promedio }, null, 2));
    console.log("resumen guardado en", SALIDA);
  }
}
main().then(() => process.exit(0), (e) => { console.error("FALLO:", e?.stack ?? e); process.exit(1); });
