/**
 * Barrido de escenarios del tamaño de CI (REQ-014 T64): 300 escenarios con la semilla fija 1 por `barrer` (la misma
 * agregación que `scripts/escenarios/correr.ts`) y la tasa de aciertos global >= 97 %. Medido el 2026-10-14 con el motor y las
 * bandas de ese día: 2000 escenarios daban 98,0-98,5 % en dos semillas; el umbral deja ~1 punto de margen. Sin red, IA ni BD.
 * La duración se registra; el presupuesto de 45 s solo se exige con ESCENARIOS_PRESUPUESTO=1. Cualquier clase de fallo fuera de
 * `CLASES_PERMITIDAS` falla aunque la tasa llegue al 97 %. Sin reproducción mínima de fallos (`conRepro: false`): cuesta una fachada por intento y aquí solo importa la tasa.
 *
 *   npx tsx --conditions=react-server scripts/test/test-escenarios-barrido-ci.ts
 */
import assert from "node:assert/strict";
import { CLASES_PERMITIDAS } from "../escenarios/clases-permitidas";
import { barrer } from "../escenarios/informe";
import { correr } from "../escenarios/matriz";

const N = 300;
const SEMILLA = 1;
const TASA_MINIMA = 0.97;
/** El presupuesto de tiempo depende de la carga de la máquina: solo se exige con `ESCENARIOS_PRESUPUESTO=1`, como el tiempo en las demás pruebas (solo el CLI lo juzga). */
const PRESUPUESTO_S = 45;
const CON_PRESUPUESTO = process.env.ESCENARIOS_PRESUPUESTO === "1";

const informe = barrer({ n: N, semilla: SEMILLA, ejecutar: (e) => correr(e, { conTiempo: false }), conRepro: false });
const tasa = informe.pasan / N;

console.log(`  ${informe.pasan}/${N} escenarios pasan (${informe.tasaGlobal}) en ${informe.duracionS} s; semilla ${SEMILLA}`);
const clases = Object.entries(informe.clases).map(([clase, v]) => `${v.escenarios} ${clase}`);
if (clases.length) console.log(`  clases de fallo: ${clases.join("; ")}`);

assert.equal(informe.rechazadosPorEsquema, 0, "el esquema rechazó escenarios del generador");
const noPermitidas = Object.keys(informe.clases).filter((clase) => !CLASES_PERMITIDAS.has(clase));
assert.deepEqual(noPermitidas, [], "clases de fallo fuera de CLASES_PERMITIDAS");
assert.ok(tasa >= TASA_MINIMA, `tasa ${informe.tasaGlobal} por debajo del ${TASA_MINIMA * 100} %: ${clases.join("; ")}`);
if (CON_PRESUPUESTO) assert.ok(informe.duracionS <= PRESUPUESTO_S, `el barrido tardó ${informe.duracionS} s (presupuesto ${PRESUPUESTO_S} s)`);
console.log("test-escenarios-barrido-ci: ok");
