import assert from "node:assert/strict";
import test from "node:test";
import { LORA_SEED_MAX, parseLoraSeed, resolveLoraSeed, semillaDeEvaluacion } from "./lora-seed";

test("la semilla pedida gana sobre todo lo demas", () => {
  assert.equal(resolveLoraSeed(42, () => 7, 99), 42);
});

test("sin semilla pedida manda la de evaluacion", () => {
  assert.equal(resolveLoraSeed(undefined, () => 7, 99), 99);
});

test("sin ninguna de las dos se sortea, que es el comportamiento del cliente", () => {
  assert.equal(resolveLoraSeed(undefined, () => 7, undefined), 7);
});

test("dos llamadas con la semilla de evaluacion dan el mismo numero", () => {
  // El criterio de aceptacion de la fase 0.1: sin esto, un cambio de prompt no
  // se puede atribuir porque la semilla se mueve por debajo.
  let sorteos = 0;
  const sortear = () => {
    sorteos += 1;
    return sorteos;
  };
  assert.equal(resolveLoraSeed(undefined, sortear, 1234), resolveLoraSeed(undefined, sortear, 1234));
  assert.equal(sorteos, 0, "con semilla de evaluacion no se sortea nada");
});

test("una variable vacia o ausente no fija nada", () => {
  for (const valor of [undefined, "", "   "]) assert.equal(semillaDeEvaluacion(valor), undefined);
});

test("una variable mal escrita se ignora en vez de fingir determinismo", () => {
  // Fallar en abierto: una corrida que PARECE determinista y no lo es es peor
  // que no tener la variable.
  for (const valor of ["abc", "-1", "1.5", String(LORA_SEED_MAX + 1)]) {
    assert.equal(semillaDeEvaluacion(valor), undefined, `"${valor}" no debe fijar semilla`);
  }
});

test("una variable valida si fija la semilla", () => {
  assert.equal(semillaDeEvaluacion("0"), 0);
  assert.equal(semillaDeEvaluacion("20260917"), 20260917);
  assert.equal(semillaDeEvaluacion(String(LORA_SEED_MAX)), LORA_SEED_MAX);
});

test("el parseo de la peticion no cambio", () => {
  assert.deepEqual(parseLoraSeed(undefined), { ok: true, seed: undefined });
  assert.deepEqual(parseLoraSeed(7), { ok: true, seed: 7 });
  assert.equal(parseLoraSeed("7").ok, false, "no se coacciona una cadena");
});
