/**
 * Arnés de entrenamiento (W4): tope de gasto por pasada, con el coste simulado (sin llamadas al proveedor):
 *   NODE_OPTIONS=--use-system-ca npx tsx --conditions=react-server scripts/test/test-entrenamiento-cupo.ts
 */
import assert from "node:assert/strict";
import { CupoGasto, TOPE_GASTO_POR_DEFECTO_USD, TopeGastoSuperado, topeDesde } from "../entrenamiento/lib-cupo-gasto";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

prueba("el tope por defecto es US$1,00 y el argumento gana a la variable de entorno", () => {
  assert.equal(TOPE_GASTO_POR_DEFECTO_USD, 1);
  assert.equal(topeDesde(undefined, undefined), 1);
  assert.equal(topeDesde("", "  "), 1);
  assert.equal(topeDesde("2.5", "0.5"), 2.5);
  assert.equal(topeDesde(undefined, "0.75"), 0.75);
  assert.throws(() => topeDesde("cero", undefined));
  assert.throws(() => topeDesde("-1", undefined));
});

prueba("un tope no positivo no arranca", () => {
  assert.throws(() => new CupoGasto(0));
  assert.throws(() => new CupoGasto(Number.NaN));
});

prueba("con costes simulados de 0,4 USD, la tercera llamada supera el tope de 1 USD y lanza", () => {
  const cupo = new CupoGasto(1);
  cupo.registrar(0.4);
  assert.equal(cupo.hayMargen(), true);
  cupo.registrar(0.4);
  assert.equal(cupo.hayMargen(), true);
  assert.throws(() => cupo.registrar(0.4), TopeGastoSuperado);
  assert.ok(Math.abs(cupo.gastado - 1.2) < 1e-9, "la llamada que pasa el tope queda contada");
  assert.equal(cupo.hayMargen(), false);
});

prueba("llegar justo al tope no aborta; pasarlo sí", () => {
  const cupo = new CupoGasto(1);
  cupo.registrar(1);
  assert.equal(cupo.hayMargen(), false);
  assert.throws(() => cupo.registrar(0.0001), TopeGastoSuperado);
});

prueba("un coste negativo o no numérico de la telemetría se rechaza", () => {
  const cupo = new CupoGasto(1);
  assert.throws(() => cupo.registrar(-0.1));
  assert.throws(() => cupo.registrar(Number.NaN));
  assert.equal(cupo.gastado, 0);
});

console.log(`\n${pruebas} pruebas del tope de gasto: OK`);
