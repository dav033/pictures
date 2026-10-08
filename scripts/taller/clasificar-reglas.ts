/**
 * Clasifica por reglas toda la biblioteca de fábrica (celebraciones y temáticas, REQ-002 paso 1) y muestra la
 * cobertura. Sin IA, sin red y sin armar contenido: lee solo nombre, descripción, fuente y ocasiones de cada item.
 *   npx tsx scripts/taller/clasificar-reglas.ts
 * Escribe data/taller/clasificacion-reglas.json (data/ no se versiona).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { BIBLIOTECA_FABRICA } from "../../src/lib/globos3d/biblioteca";
import { clasificarPorReglas, type ResultadoClasificacion } from "../../src/lib/taller/clasificar-items";
import { celebracionPorId, tematicaPorId } from "../../src/lib/taller/taxonomia-celebraciones";

const SALIDA = resolve(process.cwd(), "data/taller/clasificacion-reglas.json");

type Fila = { id: string; tipo: string; nombre: string; fuente: string; resultado: ResultadoClasificacion };

const t0 = Date.now();
const filas: Fila[] = BIBLIOTECA_FABRICA.map((item) => ({ id: item.id, tipo: item.tipo, nombre: item.nombre, fuente: item.fuente?.tipo ?? "-", resultado: clasificarPorReglas(item) }));
const ms = Date.now() - t0;

const total = filas.length;
const conCelebracion = filas.filter((f) => f.resultado.celebraciones.length > 0).length;
const conTematica = filas.filter((f) => f.resultado.tematicas.length > 0).length;
const generales = filas.filter((f) => f.resultado.general).length;
const pct = (n: number) => `${((100 * n) / total).toFixed(1)} %`;

console.log(`Biblioteca de fábrica: ${total} items clasificados en ${ms} ms`);
console.log(`  con >= 1 celebración: ${conCelebracion} (${pct(conCelebracion)})`);
console.log(`  con >= 1 temática:    ${conTematica} (${pct(conTematica)})`);
console.log(`  general (sin etiqueta confiable): ${generales} (${pct(generales)})`);

const cuenta = (ids: string[]) => {
  const m = new Map<string, number>();
  for (const id of ids) m.set(id, (m.get(id) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};
const top = (titulo: string, lista: Array<[string, number]>, nombre: (id: string) => string) => {
  console.log(`\nTop 20 ${titulo}:`);
  for (const [id, n] of lista.slice(0, 20)) console.log(`  ${String(n).padStart(4)}  ${id}  (${nombre(id)})`);
};
top("celebraciones", cuenta(filas.flatMap((f) => f.resultado.celebraciones.map((c) => c.id))), (id) => celebracionPorId(id)?.nombre ?? "?");
top("temáticas", cuenta(filas.flatMap((f) => f.resultado.tematicas.map((c) => c.id))), (id) => tematicaPorId(id)?.nombre ?? "?");

// Muestra repetible (semilla fija).
let semilla = 20261008;
const azar = () => { semilla = (Math.imul(semilla, 1664525) + 1013904223) >>> 0; return semilla / 2 ** 32; };
const muestra = [...filas].sort(() => azar() - 0.5).slice(0, 15);
console.log("\n15 ejemplos al azar:");
for (const f of muestra) {
  const c = f.resultado.celebraciones.map((x) => `${x.id} ${x.confianza}`).join(", ") || "-";
  const t = f.resultado.tematicas.map((x) => `${x.id} ${x.confianza}`).join(", ") || "-";
  console.log(`  ${f.id} · «${f.nombre}»\n      celebraciones: ${c}\n      temáticas: ${t}${f.resultado.general ? "   [general]" : ""}`);
}

mkdirSync(dirname(SALIDA), { recursive: true });
writeFileSync(SALIDA, JSON.stringify({
  generado: new Date().toISOString(), total, conCelebracion, conTematica, generales,
  items: filas.map((f) => ({ id: f.id, tipo: f.tipo, nombre: f.nombre, fuente: f.fuente, ...f.resultado })),
}, null, 1));
console.log(`\nResultado completo: ${SALIDA}`);
