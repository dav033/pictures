import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generarLote, type Escenario } from "./generador";
import { clasesDe, correr, minimizar, type Resultado } from "./matriz";
import { INVARIANTES, PRESUPUESTO_MS, type Invariante } from "./invariantes";

/**
 * **CLI de la matriz de escenarios del motor 3D.** Genera `--n` escenarios con la semilla `--semilla`, los pasa por los
 * invariantes en flujo (sin guardarlos en memoria), imprime la tasa de acierto por invariante y por estructura, las piezas sin
 * banda (huecos de cobertura) y escribe un informe JSON con las clases de fallo y un repro mínimo por clase.
 *
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/escenarios/correr.ts --n 2000 --semilla 1
 *
 * Sin coste: ninguna IA ni red. El informe va a `scripts/escenarios/salidas/` (ignorado por git). Aquí sí se mide el tiempo.
 */

function leerArgumentos(): { n: number; semilla: number; salida: string } {
  const valor = (nombre: string, defecto: number): number => {
    const i = process.argv.indexOf(nombre);
    return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : defecto;
  };
  const i = process.argv.indexOf("--salida");
  return {
    n: valor("--n", 2000),
    semilla: valor("--semilla", 1),
    salida: i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : join(import.meta.dirname, "salidas"),
  };
}

const pct = (parte: number, total: number): string => (total ? `${((100 * parte) / total).toFixed(1)}%` : "-");

function percentil(valores: number[], p: number): number {
  if (!valores.length) return 0;
  const ordenados = [...valores].sort((a, b) => a - b);
  return ordenados[Math.min(ordenados.length - 1, Math.ceil((p / 100) * ordenados.length) - 1)]!;
}

/** Cuenta por clave: una entrada por cada aparición. */
const sumar = (mapa: Map<string, number>, clave: string): void => void mapa.set(clave, (mapa.get(clave) ?? 0) + 1);

type Clase = { escenarios: number; ejemplo: string; primero?: Escenario };

function main(): void {
  const { n, semilla, salida } = leerArgumentos();
  const porInvariante = Object.fromEntries(INVARIANTES.map((i) => [i, { pasa: 0, falla: 0 }])) as Record<Invariante, { pasa: number; falla: number }>;
  const porEstructura = new Map<string, { n: number; pasan: number }>();
  const porSala = new Map<string, { n: number; pasan: number }>();
  const celdas = new Map<string, number>();
  const sinBanda = new Map<string, number>();
  const clases = new Map<string, Clase>();
  const tiempos: number[] = [];
  let rechazados = 0, pasan = 0, piezasSinBanda = 0;
  const fallidos: string[] = [];
  const inicio = Date.now();

  for (const escenario of generarLote(semilla, n)) {
    const r: Resultado = correr(escenario);
    if (r.rechazoEsquema) rechazados++;
    piezasSinBanda += r.sinBanda.length;
    r.sinBanda.forEach((etiqueta) => sumar(sinBanda, etiqueta));
    r.celdasComprobadas.forEach((celda) => sumar(celdas, celda));
    tiempos.push(r.tiempoMs);
    const principal = escenario.espec.piezas[0]!.oficial;
    const bucket = porEstructura.get(principal) ?? { n: 0, pasan: 0 };
    bucket.n++;
    const ok = r.chequeos.every((c) => c.clases.length === 0);
    for (const c of r.chequeos) porInvariante[c.invariante][c.clases.length ? "falla" : "pasa"]++;
    if (ok) { pasan++; bucket.pasan++; } else fallidos.push(escenario.id);
    porEstructura.set(principal, bucket);
    const sala = r.anchoSalaCm === null ? "?" : r.anchoSalaCm <= 600 ? "ancho<=600" : r.anchoSalaCm <= 900 ? "ancho 601-900" : "ancho>900";
    const deSala = porSala.get(sala) ?? { n: 0, pasan: 0 };
    deSala.n++;
    if (ok) deSala.pasan++;
    porSala.set(sala, deSala);
    for (const clase of new Set(clasesDe(r))) {
      const actual = clases.get(clase) ?? { escenarios: 0, ejemplo: escenario.id };
      actual.escenarios++;
      actual.primero ??= escenario;
      clases.set(clase, actual);
    }
  }

  // El repro mínimo de cada clase se reduce una vez, desde el primer escenario que la produjo.
  const informeClases = Object.fromEntries([...clases.entries()].sort((a, b) => b[1].escenarios - a[1].escenarios).map(([clase, v]) => [
    clase,
    { escenarios: v.escenarios, ejemplo: v.ejemplo, repro: v.primero ? minimizar(v.primero, clase) : null },
  ]));

  const p95 = Math.round(percentil(tiempos, 95));
  const informe = {
    version: "matriz-escenarios.v2", generado: new Date().toISOString(), semilla, n,
    validos: n, rechazadosPorEsquema: rechazados, pasan, tasaGlobal: pct(pasan, n),
    presupuestoTiempoMs: PRESUPUESTO_MS,
    tiempoFachadaMs: { p50: Math.round(percentil(tiempos, 50)), p95, max: Math.round(Math.max(0, ...tiempos)) },
    piezasSinBanda, sinBandaPorEstructura: Object.fromEntries([...sinBanda.entries()].sort((a, b) => b[1] - a[1])),
    celdasComprobadas: Object.fromEntries([...celdas.entries()].sort()),
    duracionS: Math.round((Date.now() - inicio) / 1000),
    porInvariante: Object.fromEntries(Object.entries(porInvariante).map(([k, v]) => [k, { ...v, tasa: pct(v.pasa, n) }])),
    porEstructura: Object.fromEntries([...porEstructura.entries()].map(([k, v]) => [k, { ...v, tasa: pct(v.pasan, v.n) }])),
    porSala: Object.fromEntries([...porSala.entries()].map(([k, v]) => [k, { ...v, tasa: pct(v.pasan, v.n) }])),
    clases: informeClases,
    escenariosFallidos: fallidos.slice(0, 500),
  };
  mkdirSync(salida, { recursive: true });
  const ruta = join(salida, `informe-s${semilla}-n${n}.json`);
  writeFileSync(ruta, JSON.stringify(informe, null, 2));

  console.log(`escenarios: ${n}; semilla ${semilla}; ${informe.duracionS} s; rechazados por el esquema: ${rechazados} (deben ser 0)`);
  console.log(`pasan todos los invariantes: ${pasan}/${n} (${informe.tasaGlobal})`);
  console.log("por invariante:");
  for (const [k, v] of Object.entries(porInvariante)) console.log(`  ${k.padEnd(16)} ${v.pasa}/${n} (${pct(v.pasa, n)})`);
  console.log("por estructura (primera pieza):");
  for (const [k, v] of [...porEstructura.entries()].sort()) console.log(`  ${k.padEnd(22)} ${v.pasan}/${v.n} (${pct(v.pasan, v.n)})`);
  console.log("por tamaño de sala que decide el motor:");
  for (const [k, v] of [...porSala.entries()].sort()) console.log(`  ${k.padEnd(16)} ${v.pasan}/${v.n} (${pct(v.pasan, v.n)})`);
  console.log(`piezas sin banda de conteo (huecos de cobertura): ${piezasSinBanda}`);
  for (const [k, v] of Object.entries(informe.sinBandaPorEstructura).slice(0, 20)) console.log(`  ${String(v).padStart(5)}  ${k}`);
  console.log(`celdas de banda comprobadas: ${celdas.size}`);
  for (const [k, v] of [...celdas.entries()].sort()) console.log(`  ${String(v).padStart(5)}  ${k}`);
  console.log(`tiempo de la fachada: p50 ${informe.tiempoFachadaMs.p50} ms, p95 ${p95} ms, max ${informe.tiempoFachadaMs.max} ms (presupuesto ${PRESUPUESTO_MS} ms)`);
  console.log("clases de fallo (mas frecuentes primero):");
  for (const [clase, v] of Object.entries(informeClases).slice(0, 25)) console.log(`  ${String(v.escenarios).padStart(5)}  ${clase}`);
  console.log(`informe: ${ruta}`);
}

main();
