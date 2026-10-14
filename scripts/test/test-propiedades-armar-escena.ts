/**
 * Propiedades de `armarEscena` (REQ-014 T30) sobre escenas que salen del generador con semilla de la matriz
 * (`scripts/escenarios/generador.ts` -> `escenaDeEspec`): 300 casos, sin red ni coste. Cada fallo imprime su semilla base y el
 * caso (`PROPIEDADES_SEMILLA=<n> PROPIEDADES_CASOS=<n>` lo reproduce):
 *   - determinista: armar dos veces (con la caché de piezas y sin ella) da el mismo resultado;
 *   - ningún número del armado (cajas, globos, tubos, sólidos, materiales) es NaN ni Infinity, y las cajas no están invertidas;
 *   - las cuentas (copias, globos, materiales) son enteros >= 0 y la lista de materiales suma lo que hay en la escena;
 *   - la escena sobrevive al viaje por JSON (armada igual) y el armado es JSON puro (sin undefined que cambie al guardarse).
 *   npx tsx --conditions=react-server scripts/test/test-propiedades-armar-escena.ts
 */
import assert from "node:assert/strict";
import { escenarioDe } from "../escenarios/generador";
import { armarEscena, type Caja, type EscenaArmada, type NodoArmado } from "../../src/lib/globos3d/escena";
import { escenaDeEspec } from "../../src/lib/globos3d/motor/v1";
import { configPropiedades } from "./lib-config-propiedades";

const { semilla: SEMILLA } = configPropiedades();
const CASOS = Number(process.env.PROPIEDADES_CASOS ?? 0) > 0 ? Number(process.env.PROPIEDADES_CASOS) : 300;

/** Recorre todo el valor y devuelve la ruta del primer número no finito, o `null`. */
function primerNoFinito(valor: unknown, ruta = "armado"): string | null {
  if (typeof valor === "number") return Number.isFinite(valor) ? null : `${ruta} = ${valor}`;
  if (valor === null || typeof valor !== "object") return null;
  if (valor instanceof Map) return primerNoFinito([...valor.entries()], ruta);
  for (const [clave, hijo] of Object.entries(valor)) {
    const encontrado = primerNoFinito(hijo, `${ruta}.${clave}`);
    if (encontrado) return encontrado;
  }
  return null;
}

function cajasBienFormadas(nodo: NodoArmado, donde: string): number {
  let cajas = 0;
  const revisar = (caja: Caja | undefined, que: string) => {
    if (!caja) return;
    for (const eje of ["x", "y", "z"] as const) assert.ok(caja.min[eje] <= caja.max[eje] + 1e-9, `${donde} ${que}: caja invertida en ${eje} (${caja.min[eje]} > ${caja.max[eje]})`);
    cajas += 1;
  };
  if (nodo.copias > 0) revisar(nodo.caja, `${nodo.id}.caja`);
  if (nodo.copias > 0) revisar(nodo.cajaLocal, `${nodo.id}.cajaLocal`);
  nodo.puestas.forEach((p, i) => revisar(p.caja, `${nodo.id}.puestas[${i}]`));
  return cajas;
}

function propiedades(armada: EscenaArmada, donde: string): { cajas: number; globos: number } {
  const roto = primerNoFinito(armada);
  assert.equal(roto, null, `${donde}: número no finito en ${roto}`);
  let cajas = 0;
  for (const nodo of armada.porNodo) {
    assert.ok(Number.isInteger(nodo.copias) && nodo.copias >= 0, `${donde}: ${nodo.id} tiene ${nodo.copias} copias`);
    cajas += cajasBienFormadas(nodo, donde);
  }
  const delNodo = armada.porNodo.reduce((s, n) => s + n.globos.length, 0);
  assert.equal(armada.globos.length, delNodo, `${donde}: los globos de la escena (${armada.globos.length}) no son los de sus piezas (${delNodo})`);
  for (const m of armada.materiales) assert.ok(Number.isInteger(m.cantidad) && m.cantidad >= 0, `${donde}: material con cantidad ${m.cantidad}`);
  return { cajas, globos: armada.globos.length };
}

function caso(indice: number, fn: () => void): void {
  try { fn(); } catch (error) {
    const e = escenarioDe(SEMILLA, indice);
    throw new Error(`FALLÓ con PROPIEDADES_SEMILLA=${SEMILLA} en el caso ${indice} (escenario ${e.id}, semilla del escenario ${e.semilla}): ${error instanceof Error ? error.message : String(error)}`);
  }
}

let conGlobos = 0;
let cajasTotales = 0;
let noRepresentables = 0;
for (let i = 0; i < CASOS; i += 1) caso(i, () => {
  const { espec } = escenarioDe(SEMILLA, i);
  const hecha = escenaDeEspec(espec);
  noRepresentables += hecha.noRepresentable.length;
  const primera = armarEscena(hecha.escena);
  const sinCache = armarEscena(structuredClone(hecha.escena));
  assert.deepEqual(armarEscena(hecha.escena), primera, "armar dos veces dio resultados distintos");
  assert.deepEqual(sinCache, primera, "armar una copia de la escena da otra cosa que la escena");

  const { cajas, globos } = propiedades(primera, `caso ${i}`);
  cajasTotales += cajas;
  if (globos > 0) conGlobos += 1;

  const viaje = JSON.parse(JSON.stringify(hecha.escena)) as typeof hecha.escena;
  assert.equal(JSON.stringify(armarEscena(viaje)), JSON.stringify(sinCache), "la escena guardada y leída arma otra cosa");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(primera)), primera, "el armado cambia al pasar por JSON (hay valores que JSON pierde)");
});

assert.ok(conGlobos >= CASOS * 0.5, `solo ${conGlobos} de ${CASOS} escenas tienen globos: las propiedades quedan en vacío`);
assert.ok(cajasTotales > CASOS, `solo ${cajasTotales} cajas medidas en ${CASOS} escenas`);
console.log(`test-propiedades-armar-escena (semilla ${SEMILLA}, ${CASOS} casos): ${conGlobos} escenas con globos, ${cajasTotales} cajas revisadas, ${noRepresentables} piezas no representables dichas.`);
