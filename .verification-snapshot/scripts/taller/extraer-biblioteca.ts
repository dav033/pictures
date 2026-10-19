/**
 * Extractor de fichas de la biblioteca del taller (REQ-002, paso 2): arma TODOS los items de fábrica (con los derivados de
 * indexar cada escena) y escribe un registro buscable por item en `data/taller/fichas.jsonl` (ignorado por git: es un dato
 * generado). Sin red ni gasto. Un item que falla no detiene la corrida: se anota y se sigue.
 *
 * Por repositorio de catálogo (REQ-013 fase 3): `--repositorio=mobiliario|escenografia` escribe las fichas de ese repositorio en
 * su carpeta de datos (`data/catalogos/<id>/fichas.jsonl`, del manifiesto); sin la opción, o con `sempertex`, la biblioteca de siempre.
 *
 *   npx tsx scripts/taller/extraer-biblioteca.ts [--repositorio=<id>] [--salida=<archivo.jsonl>] [--sin-escribir]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fichasDeRepositorio } from "../../src/lib/catalogo/fichas-fondos";
import { MANIFIESTOS } from "../../src/lib/catalogo/manifiestos";
import { BIBLIOTECA_FABRICA, indexarEscena, unirBiblioteca, type ItemBiblioteca } from "../../src/lib/globos3d/biblioteca";
import type { PiezaArmada } from "../../src/lib/globos3d/piezas";
import { clasificacionDe } from "../../src/lib/taller/clasificacion-biblioteca";
import { contarPalabras, fichaDeItem, type RegistroTaller } from "../../src/lib/taller/fichas";

const RAIZ = path.resolve(__dirname, "../..");
const argumento = (nombre: string) => process.argv.find((a) => a.startsWith(`--${nombre}=`))?.slice(nombre.length + 3);
const REPOSITORIO = argumento("repositorio") ?? "sempertex";
const ESCRIBIR = !process.argv.includes("--sin-escribir");

/** Un token de embedding de texto en español son ~3,5 caracteres (estimación para presupuestar). */
const tokensEstimados = (texto: string) => Math.ceil(texto.length / 3.5);
const mensaje = (e: unknown) => (e instanceof Error ? e.message : String(e));
const segundos = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const suma = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const resumen = (xs: number[]) => (xs.length ? `media ${Math.round(suma(xs) / xs.length)}, mín ${Math.min(...xs)}, máx ${Math.max(...xs)}` : "sin datos");

type Fallo = { id: string; fase: "indexar" | "ficha"; error: string };
type Registro = { id: string; tipo: string; ficha: string };

function escribir(salida: string, registros: readonly Registro[]): void {
  if (!ESCRIBIR) return;
  mkdirSync(path.dirname(salida), { recursive: true });
  writeFileSync(salida, registros.map((r) => JSON.stringify(r)).join("\n") + (registros.length ? "\n" : ""), "utf8");
  console.log(`Escrito: ${path.relative(RAIZ, salida)}`);
}

function imprimirTextos(registros: readonly Registro[]): void {
  const porTipo = new Map<string, number>();
  for (const r of registros) porTipo.set(r.tipo, (porTipo.get(r.tipo) ?? 0) + 1);
  const palabras = registros.map((r) => contarPalabras(r.ficha));
  const tokens = registros.map((r) => tokensEstimados(r.ficha));
  console.log(`Por tipo: ${[...porTipo.entries()].map(([t, n]) => `${t} ${n}`).join(", ")}`);
  console.log(`Palabras por ficha: ${resumen(palabras)}`);
  console.log(`Tokens estimados por ficha: ${resumen(tokens)} (total ${suma(tokens)})`);
  console.log(`Fuera de 80–250 palabras: ${palabras.filter((p) => p < 80).length} cortas, ${palabras.filter((p) => p > 250).length} largas`);
}

function extraerSempertex(): void {
  const salida = path.resolve(RAIZ, argumento("salida") ?? "data/taller/fichas.jsonl");
  const inicio = Date.now();
  const cache = new Map<string, PiezaArmada>();
  const fallos: Fallo[] = [];

  const indices = new Map<string, ItemBiblioteca[]>();
  for (const item of BIBLIOTECA_FABRICA) {
    if (item.tipo !== "escena") continue;
    try { indices.set(item.id, indexarEscena(item, undefined, cache)); } catch (e) { fallos.push({ id: item.id, fase: "indexar", error: mensaje(e) }); }
  }
  const items = unirBiblioteca(BIBLIOTECA_FABRICA, indices);
  const msIndexar = Date.now() - inicio;

  const registros: RegistroTaller[] = [];
  const lentos: Array<{ id: string; ms: number }> = [];
  for (const item of items) {
    const t0 = Date.now();
    try { const clasificacion = clasificacionDe(item.id); registros.push(fichaDeItem(item, { cache, ...(clasificacion ? { clasificacion } : {}) })); } catch (e) { fallos.push({ id: item.id, fase: "ficha", error: mensaje(e) }); }
    lentos.push({ id: item.id, ms: Date.now() - t0 });
  }
  const msTotal = Date.now() - inicio;

  console.log(`Items de fábrica: ${BIBLIOTECA_FABRICA.length}; con derivados: ${items.length}; fichas: ${registros.length}`);
  imprimirTextos(registros);
  console.log(`Fallos: ${fallos.length}`);
  for (const f of fallos) console.log(`  - [${f.fase}] ${f.id}: ${f.error}`);
  console.log(`Tiempo: ${segundos(msTotal)} (indexar escenas ${segundos(msIndexar)}, fichas ${segundos(msTotal - msIndexar)})`);
  console.log(`Los 5 más lentos: ${lentos.sort((a, b) => b.ms - a.ms).slice(0, 5).map((l) => `${l.id} ${l.ms} ms`).join("; ")}`);
  console.log("Las 10 fichas más largas:");
  [...registros].sort((a, b) => contarPalabras(b.ficha) - contarPalabras(a.ficha)).slice(0, 10).forEach((r) => console.log(`  ${contarPalabras(r.ficha)} palabras · ${r.id}`));
  escribir(salida, registros);
  if (fallos.length) process.exitCode = 1;
}

/** Mobiliario o escenografía: una ficha por entrada del repositorio, en su orden (un fallo detiene todo: son pocas y todas cuentan). */
function extraerFondos(repositorio: "mobiliario" | "escenografia"): void {
  const salida = path.resolve(RAIZ, argumento("salida") ?? path.join(MANIFIESTOS[repositorio].datos, "fichas.jsonl"));
  const registros = fichasDeRepositorio(repositorio);
  console.log(`Repositorio ${repositorio}: ${registros.length} fichas`);
  imprimirTextos(registros);
  escribir(salida, registros);
}

if (REPOSITORIO === "mobiliario" || REPOSITORIO === "escenografia") extraerFondos(REPOSITORIO);
else if (REPOSITORIO === "sempertex") extraerSempertex();
else {
  console.error(`--repositorio=${REPOSITORIO}: solo sempertex, mobiliario o escenografia tienen fichas.`);
  process.exitCode = 2;
}
