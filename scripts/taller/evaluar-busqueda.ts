/**
 * Evalúa la búsqueda del taller contra el oro (REQ-002, paso 7). Sin red ni gasto: compara los sistemas registrados en
 * `sistemas-busqueda.ts` (hoy la búsqueda en memoria; el RAG, cuando exista), imprime la tabla comparativa y las peores
 * consultas, y escribe `data/taller/eval-<fecha>.json` (ignorado por git).
 *
 *   npx tsx scripts/taller/evaluar-busqueda.ts [--sistemas=actual,rag] [--peores=10] [--salida=data/taller/eval-2026-10-08.json]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  SistemaNoDisponible, consultasDeFoto, consultasDeTexto, desglosePorCategoria, evaluarSistema, peoresConsultas, tablaComparativa,
  type ConsultaEvaluable, type ResultadoSistema,
} from "../../src/lib/taller/evaluar";
import { idsDelOro, leerOro } from "../../src/lib/taller/evaluar-oro";
import { SISTEMAS } from "./sistemas-busqueda";

const RAIZ = path.resolve(__dirname, "../..");
const argumento = (nombre: string) => process.argv.find((a) => a.startsWith(`--${nombre}=`))?.slice(nombre.length + 3);
const ORO = path.join(RAIZ, "scripts/test/fixtures/oro-busqueda-taller.json");
const FICHAS = path.join(RAIZ, "data/taller/fichas.jsonl");
const fecha = new Date().toISOString().slice(0, 10);
const SALIDA = path.resolve(RAIZ, argumento("salida") ?? `data/taller/eval-${fecha}.json`);
const PEORES = Number(argumento("peores") ?? 10);
const NOMBRES = (argumento("sistemas") ?? Object.keys(SISTEMAS).join(",")).split(",").map((s) => s.trim()).filter(Boolean);

type Corrida = { sistema: string; resultado: ResultadoSistema | null; motivo?: string };

/** id → nombre de cada item, para mostrar qué devolvió cada sistema (si no hay fichas, se muestra el id). */
function nombresDeItems(): Map<string, string> {
  const nombres = new Map<string, string>();
  if (!existsSync(FICHAS)) return nombres;
  for (const linea of readFileSync(FICHAS, "utf8").split("\n")) {
    if (!linea.trim()) continue;
    const { id, nombre } = JSON.parse(linea) as { id: string; nombre: string };
    nombres.set(id, nombre);
  }
  return nombres;
}

async function correr(nombre: string, consultas: readonly ConsultaEvaluable[]): Promise<Corrida> {
  const sistema = SISTEMAS[nombre];
  if (!sistema) throw new Error(`Sistema desconocido «${nombre}»; los hay: ${Object.keys(SISTEMAS).join(", ")}`);
  try {
    return { sistema: sistema.nombre, resultado: await evaluarSistema(sistema, consultas) };
  } catch (e) {
    if (e instanceof SistemaNoDisponible) return { sistema: sistema.nombre, resultado: null, motivo: e.message };
    throw e;
  }
}

const corto = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

function imprimirPeores(resultado: ResultadoSistema, nombres: ReadonlyMap<string, string>) {
  console.log(`\nLas ${PEORES} peores consultas de «${resultado.sistema}» (menor nDCG@10):`);
  for (const r of peoresConsultas(resultado, PEORES)) {
    const exactos = r.relevantes.filter((x) => x.grado === 2).length;
    console.log(`\n${r.id} «${r.texto}» [${r.categoria}] nDCG@10 ${r.metricas.ndcg10.toFixed(3)}, recall@10 ${(r.metricas.recall10 * 100).toFixed(0)}% (${r.relevantes.length} relevantes, ${exactos} exactos)${r.error ? ` ERROR: ${r.error}` : ""}`);
    console.log(`  esperaba: ${r.relevantes.slice(0, 4).map((x) => `${x.grado === 2 ? "★" : "·"}${x.id}`).join(", ")}${r.relevantes.length > 4 ? ", …" : ""}`);
    const devueltos = r.devueltos.slice(0, 5);
    console.log(devueltos.length ? `  devolvió: ${devueltos.map((id) => `${r.relevantes.some((x) => x.id === id) ? "✓" : "✗"} ${id} «${corto(nombres.get(id) ?? "?", 48)}»`).join("\n            ")}` : "  devolvió: nada");
  }
}

async function main() {
  const oro = leerOro(JSON.parse(readFileSync(ORO, "utf8")));
  const nombres = nombresDeItems();
  if (nombres.size) {
    const faltan = idsDelOro(oro).filter((id) => !nombres.has(id));
    if (faltan.length) console.warn(`ATENCIÓN: ${faltan.length} ids del oro no están en las fichas: ${faltan.slice(0, 5).join(", ")}`);
  }

  const texto: Corrida[] = [];
  const fotos: Corrida[] = [];
  for (const nombre of NOMBRES) {
    texto.push(await correr(nombre, consultasDeTexto(oro)));
    fotos.push(await correr(nombre, consultasDeFoto(oro)));
  }

  console.log(`Oro: ${oro.consultas.length} consultas de texto y ${oro.fotos.length} fotos del dueño; ${nombres.size} items en las fichas.\n`);
  console.log(tablaComparativa("Consultas de texto", texto));
  console.log(`\n${tablaComparativa("Consultas por foto", fotos)}`);

  for (const c of texto) {
    if (!c.resultado) continue;
    console.log(`\nPor categoría de «${c.sistema}»:`);
    for (const g of desglosePorCategoria(c.resultado)) console.log(`  ${g.categoria.padEnd(11)} n=${String(g.n).padStart(2)}  recall@5 ${(g.metricas.recall5 * 100).toFixed(0).padStart(3)}%  MRR ${g.metricas.mrr.toFixed(2)}  nDCG@10 ${g.metricas.ndcg10.toFixed(2)}`);
    imprimirPeores(c.resultado, nombres);
  }

  mkdirSync(path.dirname(SALIDA), { recursive: true });
  writeFileSync(SALIDA, `${JSON.stringify({ fecha, texto, fotos }, null, 1)}\n`, "utf8");
  console.log(`\nEscrito ${path.relative(RAIZ, SALIDA)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
