/**
 * Evalúa el RAG de la biblioteca sin base remota (REQ-002, paso 7): levanta PGlite (Postgres en memoria con pgvector,
 * pg_trgm y unaccent), aplica la migración 028, indexa data/taller/fichas.jsonl con los vectores de
 * data/taller/embeddings y compara con el oro: búsqueda de hoy, RAG léxico, RAG híbrido y fotos del dueño → vistas 3D.
 * Los embeddings de las 40 consultas se cachean en data/taller/eval-vectores-consulta.json (la primera vez pagan
 * ~US/usr/bin/bash,0001 con GEMINI_API_KEY).
 *
 *   npx tsx --conditions=react-server scripts/taller/evaluar-rag-local.ts --pglite=<carpeta>
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { construirUpsertItem, construirBorrarPartes, construirInsertPartes, construirUpsertEmbedding, leerFichasJsonl, MODELO_EMBEDDING_TALLER } from "../../src/lib/taller/indice";
import { buscarEnTaller } from "../../src/lib/taller/buscar";
import { leerVectoresCacheados } from "../../src/lib/taller/vectores-cache";
import { consultasDeFoto, consultasDeTexto, desglosePorCategoria, evaluarSistema, peoresConsultas, tablaComparativa, type SistemaBusqueda } from "../../src/lib/taller/evaluar";
import { leerOro } from "../../src/lib/taller/evaluar-oro";
import { sistemaActual } from "./sistemas-busqueda";
import { embeberTexto } from "../../src/lib/rag/embeddings";
// PGlite no es dependencia del repo: se instala aparte (npm i @electric-sql/pglite @electric-sql/pglite-pgvector) y se pasa su carpeta.
const DIR_PGLITE = process.argv.find((a) => a.startsWith("--pglite="))?.slice(9) ?? process.env.PGLITE_DIR;
if (!DIR_PGLITE) { console.error("Falta --pglite=<carpeta con node_modules/@electric-sql/pglite>"); process.exit(2); }
const req = createRequire(DIR_PGLITE.replace(/[\/]$/, "") + "/package.json");
const CACHE_Q = "data/taller/eval-vectores-consulta.json";
async function main() {
  const { PGlite } = await import(pathToFileURL(req.resolve("@electric-sql/pglite")).href);
  const { vector } = await import(pathToFileURL(req.resolve("@electric-sql/pglite-pgvector")).href);
  const { pg_trgm } = await import(pathToFileURL(req.resolve("@electric-sql/pglite/contrib/pg_trgm")).href);
  const { unaccent } = await import(pathToFileURL(req.resolve("@electric-sql/pglite/contrib/unaccent")).href);
  const db = await PGlite.create({ extensions: { vector, pg_trgm, unaccent } });
  await db.exec("CREATE EXTENSION IF NOT EXISTS unaccent; CREATE TEXT SEARCH CONFIGURATION spanish_unaccent (COPY = spanish); ALTER TEXT SEARCH CONFIGURATION spanish_unaccent ALTER MAPPING FOR hword, hword_part, word WITH unaccent, spanish_stem;");
  await db.exec(readFileSync("scripts/migrations/028_taller_biblioteca.sql", "utf8"));
  const { registros } = leerFichasJsonl(readFileSync("data/taller/fichas.jsonl", "utf8"));
  const fichaPorId = new Map(registros.map((r) => [r.id, r]));
  for (const r of registros) {
    const u = construirUpsertItem(r); await db.query(u.texto, u.valores);
    for (const q of [construirBorrarPartes(r.id), ...construirInsertPartes(r)]) await db.query(q.texto, q.valores);
  }
  const vecs = leerVectoresCacheados("data/taller/embeddings");
  let nt = 0, nr = 0;
  const fotosDueno = new Map<string, number[]>();
  for (const v of vecs) {
    if (v.modalidad === "imagen_foto") { fotosDueno.set(v.id, Array.from(v.vector)); continue; }
    const e = construirUpsertEmbedding({ itemId: v.id, modalidad: v.modalidad, modelo: MODELO_EMBEDDING_TALLER, vector: Array.from(v.vector), hashEntrada: v.hashEntrada });
    if (!fichaPorId.has(v.id)) continue;
    await db.query(e.texto, e.valores); if (v.modalidad === "texto") nt++; else nr++;
  }
  console.log("items", registros.length, "vectores texto", nt, "render", nr, "fotos dueño", fotosDueno.size);
  const pool = { query: (t: string, v: unknown[]) => db.query(t, v) };
  const cacheQ: Record<string, number[]> = existsSync(CACHE_Q) ? JSON.parse(readFileSync(CACHE_Q, "utf8")) : {};
  const embeber = async (t: string) => { if (!cacheQ[t]) { cacheQ[t] = await embeberTexto(t, "RETRIEVAL_QUERY"); writeFileSync(CACHE_Q, JSON.stringify(cacheQ)); } return cacheQ[t]; };
  const oro = leerOro(JSON.parse(readFileSync("scripts/test/fixtures/oro-busqueda-taller.json", "utf8")));
  const ragLex: SistemaBusqueda = { nombre: "RAG léxico", buscarTexto: async (texto, limite) => (await buscarEnTaller({ texto, limite }, { habilitado: true, obtenerPool: () => pool as never, embeberConsulta: async () => undefined })).ids };
  const ragHib: SistemaBusqueda = {
    nombre: "RAG híbrido",
    buscarTexto: async (texto, limite) => (await buscarEnTaller({ texto, limite }, { habilitado: true, obtenerPool: () => pool as never, embeberConsulta: embeber })).ids,
    buscarFoto: async (archivo, limite) => {
      const f = oro.fotos.find((x) => x.archivo === archivo)!;
      const v = fotosDueno.get(f.esperado); if (!v) throw new Error("sin vector de foto " + f.esperado);
      return (await buscarEnTaller({ vectorImagen: v, limite }, { habilitado: true, obtenerPool: () => pool as never, embeberConsulta: async () => undefined })).ids;
    },
  };
  const texto = consultasDeTexto(oro);
  const corridas = [];
  for (const s of [sistemaActual, ragLex, ragHib]) corridas.push({ sistema: s.nombre, resultado: await evaluarSistema(s, texto) });
  console.log(tablaComparativa("Texto (40 consultas)", corridas));
  const fotos = await evaluarSistema(ragHib, consultasDeFoto(oro));
  console.log(tablaComparativa("Fotos del dueño → vistas 3D (13)", [{ sistema: "RAG híbrido (imagen)", resultado: fotos }]));
  const hib = corridas[2]!.resultado;
  for (const c of desglosePorCategoria(hib)) console.log("  cat", c.categoria, c.n, "nDCG", c.metricas.ndcg10.toFixed(2));
  for (const p of peoresConsultas(hib, 8)) console.log("  peor", p.id, p.texto, "→", p.devueltos.slice(0, 3).join(" | "));
  for (const c of fotos.consultas) console.log("  foto", c.texto, "acierto@5", c.metricas.acierto5, "top3", c.devueltos.slice(0, 3).join(" | "));
}
main().catch((e) => { console.error("FALLO:", e?.stack ?? e); process.exit(1); });
