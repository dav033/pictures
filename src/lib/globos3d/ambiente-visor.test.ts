import assert from "node:assert/strict";
import test from "node:test";
import {
  AJUSTE_VISOR_DEFECTO, LENTES_VISOR, OPTICO_NEUTRO, ajusteOpticoDe, guardarAmbienteVisor, leerAmbienteVisor, type AmbienteVisor,
} from "./ambiente-visor";

const rojo = (hex: string) => parseInt(hex.slice(1, 3), 16);
const azul = (hex: string) => parseInt(hex.slice(5, 7), 16);

test("el ambiente por defecto no reemplaza la luz de la sala ni la cámara: es el visor de siempre", () => {
  assert.deepEqual(ajusteOpticoDe(AJUSTE_VISOR_DEFECTO), OPTICO_NEUTRO);
  assert.equal(OPTICO_NEUTRO.luz, null);
  assert.equal(OPTICO_NEUTRO.fovGrados, 35);
  assert.equal(OPTICO_NEUTRO.intensidadEntorno, 0.55);
});

test("elegir la luz neutra no pisa la luz cálida de una sala con ambiente", () => {
  assert.equal(ajusteOpticoDe({ luz: "neutra", lente: "tele" }).luz, null);
});

test("la luz cálida tiene el sol más rojo que la fría, y la UV es oscura y violeta", () => {
  const calida = ajusteOpticoDe({ luz: "calida", lente: "normal" }).luz!;
  const fria = ajusteOpticoDe({ luz: "fria", lente: "normal" }).luz!;
  const uv = ajusteOpticoDe({ luz: "uv", lente: "normal" });
  assert.ok(rojo(calida.colorSol) > rojo(fria.colorSol));
  assert.ok(azul(fria.colorSol) > azul(calida.colorSol));
  assert.ok(uv.luz!.intensidadAmbiente < calida.intensidadAmbiente);
  assert.ok(uv.intensidadEntorno < ajusteOpticoDe({ luz: "calida", lente: "normal" }).intensidadEntorno);
  assert.ok(azul(uv.luz!.colorSol) > rojo(uv.luz!.colorSol));
});

test("la lente gran angular ve más ancho que la normal, y la tele, menos", () => {
  const f = (lente: AmbienteVisor["lente"]) => ajusteOpticoDe({ luz: "neutra", lente }).fovGrados;
  assert.ok(f("gran_angular") > f("normal"));
  assert.ok(f("tele") < f("normal"));
  assert.equal(LENTES_VISOR.normal.fovGrados, 35);
});

test("la lectura guardada se valida: si falta, está rota o el navegador no deja leer, sale el defecto", () => {
  assert.deepEqual(leerAmbienteVisor(undefined), AJUSTE_VISOR_DEFECTO);
  assert.deepEqual(leerAmbienteVisor({ getItem: () => { throw new Error("privado"); } }), AJUSTE_VISOR_DEFECTO);
  assert.deepEqual(leerAmbienteVisor({ getItem: () => "{roto" }), AJUSTE_VISOR_DEFECTO);
  assert.deepEqual(leerAmbienteVisor({ getItem: () => JSON.stringify({ luz: "marte", lente: "tele" }) }), { luz: "neutra", lente: "tele" });
  assert.deepEqual(leerAmbienteVisor({ getItem: () => JSON.stringify({ luz: "uv", lente: "tele" }) }), { luz: "uv", lente: "tele" });
});

test("guardar el ambiente se devuelve como éxito o fracaso sin lanzar", () => {
  const guardados: Record<string, string> = {};
  assert.equal(guardarAmbienteVisor({ setItem: (k, v) => { guardados[k] = v; } }, { luz: "fria", lente: "tele" }), true);
  assert.deepEqual(leerAmbienteVisor({ getItem: (k) => guardados[k] ?? null }), { luz: "fria", lente: "tele" });
  assert.equal(guardarAmbienteVisor({ setItem: () => { throw new Error("cuota"); } }, AJUSTE_VISOR_DEFECTO), false);
  assert.equal(guardarAmbienteVisor(undefined, AJUSTE_VISOR_DEFECTO), false);
});
