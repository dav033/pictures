import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { barrer } from "./informe";
import { PRESUPUESTO_MS } from "./invariantes";

/**
 * **CLI de la matriz de escenarios del motor 3D.** Genera `--n` escenarios con la semilla `--semilla`, los pasa por los
 * invariantes en flujo (sin guardarlos en memoria), imprime la tasa de acierto por invariante y por estructura, las piezas sin
 * banda (huecos de cobertura) y escribe en `--salida` un informe JSON con las clases de fallo y un repro mínimo por clase.
 *
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/escenarios/correr.ts --n 2000 --semilla 1
 *
 * Los argumentos son estrictos: cada bandera lleva su valor (`--x valor`, no `--x=valor`) y las desconocidas fallan. `--n` es un
 * entero >= 0; `--semilla` es cualquier entero (también negativo). Sin coste: ninguna IA ni red. El informe va por defecto a `scripts/escenarios/salidas/` (ignorado por git). Aquí sí se mide
 * el tiempo. La agregación vive en `informe.ts` (importable sin efectos).
 */

const BANDERAS = ["--n", "--semilla", "--salida"];

function valoresDeBanderas(argv: string[]): Map<string, string> {
  const valores = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const bandera = argv[i]!;
    if (bandera.startsWith("--") && bandera.includes("=")) throw new Error(`usa «${bandera.split("=")[0]} valor», no la forma ${bandera}`);
    if (!BANDERAS.includes(bandera)) throw new Error(`argumento desconocido «${bandera}» (válidos: ${BANDERAS.join(", ")})`);
    const valor = argv[i + 1];
    if (valor === undefined || valor.startsWith("--")) throw new Error(`${bandera} necesita un valor`);
    valores.set(bandera, valor);
    i++;
  }
  return valores;
}

function leerArgumentos(): { n: number; semilla: number; salida: string } {
  const valores = valoresDeBanderas(process.argv.slice(2));
  const entero = (nombre: string, defecto: number, minimo: number): number => {
    const crudo = valores.get(nombre);
    if (crudo === undefined) return defecto;
    const valor = Number(crudo);
    if (crudo.trim() === "" || !Number.isInteger(valor) || valor < minimo) throw new Error(`${nombre} tiene que ser un entero${minimo > -Infinity ? ` >= ${minimo}` : ""}, no «${crudo}»`);
    return valor;
  };
  return { n: entero("--n", 2000, 0), semilla: entero("--semilla", 1, -Infinity), salida: valores.get("--salida") ?? join(import.meta.dirname, "salidas") };
}

function main(): void {
  const { n, semilla, salida } = leerArgumentos();
  const informe = barrer({ n, semilla });
  mkdirSync(salida, { recursive: true });
  const ruta = join(salida, `informe-s${semilla}-n${n}.json`);
  writeFileSync(ruta, JSON.stringify(informe, null, 2));

  console.log(`escenarios: ${n}; semilla ${semilla}; ${informe.duracionS} s; rechazados por el esquema: ${informe.rechazadosPorEsquema} (deben ser 0)`);
  console.log(`pasan todos los invariantes: ${informe.pasan}/${n} (${informe.tasaGlobal})`);
  console.log("por invariante:");
  for (const [k, v] of Object.entries(informe.porInvariante)) console.log(`  ${k.padEnd(16)} ${v.pasa}/${n} (${v.tasa})`);
  console.log("por estructura (primera pieza):");
  for (const [k, v] of Object.entries(informe.porEstructura)) console.log(`  ${k.padEnd(22)} ${v.pasan}/${v.n} (${v.tasa})`);
  console.log("por tamaño de sala que decide el motor:");
  for (const [k, v] of Object.entries(informe.porSala)) console.log(`  ${k.padEnd(16)} ${v.pasan}/${v.n} (${v.tasa})`);
  console.log(`piezas sin banda de conteo (huecos de cobertura): ${informe.piezasSinBanda}`);
  for (const [k, v] of Object.entries(informe.sinBandaPorEstructura).slice(0, 20)) console.log(`  ${String(v).padStart(5)}  ${k}`);
  console.log(`celdas de banda comprobadas: ${Object.keys(informe.celdasComprobadas).length}`);
  for (const [k, v] of Object.entries(informe.celdasComprobadas)) console.log(`  ${String(v).padStart(5)}  ${k}`);
  const t = informe.tiempoFachadaMs;
  console.log(`tiempo de la fachada: p50 ${t.p50} ms, p95 ${t.p95} ms, max ${t.max} ms (presupuesto ${PRESUPUESTO_MS} ms)`);
  console.log("clases de fallo (mas frecuentes primero):");
  for (const [clase, v] of Object.entries(informe.clases).slice(0, 25)) console.log(`  ${String(v.escenarios).padStart(5)}  ${clase}`);
  console.log(`informe: ${ruta}`);
}

main();
