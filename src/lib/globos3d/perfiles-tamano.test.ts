import assert from "node:assert/strict";
import test from "node:test";
import { formaColumna, type OpcionesOrganico } from "./organico";
import { formaGuirnalda } from "./organico-formas";
import {
  PERFILES_FABRICA, aplicarPerfilTamano, guardarPerfilesPropios, leerPerfilesPropios, mezclaDeOpciones, mezclaDePerfil, nuevoPerfilPropio,
  perfilActivo, quitarPerfilPropio, type PerfilTamano,
} from "./perfiles-tamano";

const perfil = (id: string): PerfilTamano => {
  const p = PERFILES_FABRICA.find((x) => x.id === id);
  assert.ok(p, `falta el perfil ${id}`);
  return p;
};

const pesoDe = (mezcla: PerfilTamano["mezcla"], t: number, formatos: string[]): number => {
  const punto = mezcla.find((m) => m.t === t);
  assert.ok(punto, `no hay punto en t=${t}`);
  const total = Object.values(punto.pesos).reduce((s, v) => s + v, 0);
  return formatos.reduce((s, f) => s + (punto.pesos[f] ?? 0), 0) / total;
};

const opciones = (tramos: OpcionesOrganico["tramos"]): OpcionesOrganico => ({
  semilla: 3, tramos, variacionInflado: 0.07, relleno: [], colores: [{ codigo: "640", peso: 1 }], suelo: true, huecosFlores: 0,
});

test("hay al menos cinco perfiles de fábrica con ids únicos y nombres en español", () => {
  const ids = PERFILES_FABRICA.map((p) => p.id);
  assert.ok(PERFILES_FABRICA.length >= 5);
  assert.equal(new Set(ids).size, ids.length);
  for (const p of PERFILES_FABRICA) assert.ok(p.nombre.length > 0);
});

test("en cada punto de cada perfil los pesos suman 1 y los puntos van de 0 a 1 en orden", () => {
  for (const p of PERFILES_FABRICA) {
    const ts = p.mezcla.map((m) => m.t);
    assert.equal(ts[0], 0, p.id);
    assert.equal(ts[ts.length - 1], 1, p.id);
    assert.deepEqual([...ts].sort((a, b) => a - b), ts, p.id);
    for (const m of p.mezcla) {
      const suma = Object.values(m.pesos).reduce((s, v) => s + v, 0);
      assert.ok(Math.abs(suma - 1) < 1e-9, `${p.id} en t=${m.t} suma ${suma}`);
    }
  }
});

test("el mapeo de un perfil es determinista: dos llamadas dan lo mismo", () => {
  for (const p of PERFILES_FABRICA) assert.deepEqual(mezclaDePerfil(p), mezclaDePerfil(p));
});

test("el cónico (taper) lleva los grandes abajo y los chicos arriba", () => {
  const m = perfil("cono").mezcla;
  assert.ok(pesoDe(m, 0, ["R-24", "R-18"]) > 0.5);
  assert.ok(pesoDe(m, 1, ["R-9", "R-5"]) > 0.5);
});

test("la botella tiene el cuerpo grande en medio y el cuello chico arriba y abajo", () => {
  const m = perfil("botella").mezcla;
  assert.ok(pesoDe(m, 0.6, ["R-24", "R-18"]) > pesoDe(m, 0, ["R-24", "R-18"]));
  assert.ok(pesoDe(m, 1, ["R-9", "R-5"]) > 0.5);
  assert.ok(pesoDe(m, 0, ["R-9", "R-5"]) > 0.3);
});

test("el bolo (pino de bowling) es fino abajo y ancho en la cabeza", () => {
  const m = perfil("bolo").mezcla;
  assert.ok(pesoDe(m, 0, ["R-9", "R-5"]) > 0.5);
  assert.ok(pesoDe(m, 1, ["R-24", "R-18"]) > 0.5);
});

test("la copa de champaña ensancha en la parte de arriba del cuerpo, no en la base", () => {
  const m = perfil("champana").mezcla;
  assert.ok(pesoDe(m, 0.65, ["R-24", "R-18", "R-12"]) > pesoDe(m, 0, ["R-24", "R-18", "R-12"]));
});

test("cada perfil da una mezcla distinta", () => {
  const firmas = PERFILES_FABRICA.map((p) => JSON.stringify(p.mezcla));
  assert.equal(new Set(firmas).size, firmas.length);
});

test("aplicar un perfil cambia la mezcla de la columna y deja el resto del orgánico", () => {
  const columna = formaColumna({ altoCm: 230, radioBaseCm: 42, radioMedioCm: 36, radioPuntaCm: 27 });
  const guirnalda = formaGuirnalda({ puntos: [{ x: 0, y: 0, z: 0 }, { x: 40, y: 0, z: 0 }], radioInicioCm: 15, radioFinCm: 10 });
  const antes = opciones([columna, guirnalda]);
  const despues = aplicarPerfilTamano(antes, perfil("cono"));
  assert.deepEqual(despues.tramos[0]!.mezcla, perfil("cono").mezcla);
  assert.deepEqual(despues.tramos[1], guirnalda);
  assert.notDeepEqual(antes.tramos[0]!.mezcla, despues.tramos[0]!.mezcla);
});

test("aplicar un perfil no toca las opciones de origen y es determinista", () => {
  const columna = formaColumna({ altoCm: 200, radioBaseCm: 40, radioMedioCm: 34, radioPuntaCm: 25 });
  const antes = opciones([columna]);
  const copia = structuredClone(antes);
  const a = aplicarPerfilTamano(antes, perfil("bolo"));
  assert.deepEqual(antes, copia);
  assert.deepEqual(a, aplicarPerfilTamano(antes, perfil("bolo")));
});

test("sin columna en el orgánico, aplicar un perfil no cambia nada", () => {
  const guirnalda = formaGuirnalda({ puntos: [{ x: 0, y: 0, z: 0 }, { x: 40, y: 0, z: 0 }], radioInicioCm: 15, radioFinCm: 10 });
  const antes = opciones([guirnalda]);
  assert.deepEqual(aplicarPerfilTamano(antes, perfil("cono")), antes);
});

test("la mezcla de un orgánico es la de su columna (y undefined si no hay)", () => {
  const columna = formaColumna({ altoCm: 230, radioBaseCm: 42, radioMedioCm: 36, radioPuntaCm: 27 });
  assert.deepEqual(mezclaDeOpciones(opciones([columna])), columna.mezcla);
  const guirnalda = formaGuirnalda({ puntos: [{ x: 0, y: 0, z: 0 }, { x: 40, y: 0, z: 0 }], radioInicioCm: 15, radioFinCm: 10 });
  assert.equal(mezclaDeOpciones(opciones([guirnalda])), undefined);
});

test("los perfiles propios se leen con try/catch y se descartan los que no tienen forma", () => {
  assert.deepEqual(leerPerfilesPropios(undefined), []);
  assert.deepEqual(leerPerfilesPropios({ getItem: () => { throw new Error("bloqueado"); } }), []);
  assert.deepEqual(leerPerfilesPropios({ getItem: () => "{no es json" }), []);
  const bueno = { id: "propio-mio", nombre: "Mío", mezcla: [{ t: 0, pesos: { "R-9": 1 } }, { t: 1, pesos: { "R-12": 1 } }] };
  const malo = { id: "x", nombre: "Malo", mezcla: "no" };
  assert.deepEqual(leerPerfilesPropios({ getItem: () => JSON.stringify([bueno, malo]) }), [bueno]);
});

test("guardar perfiles propios devuelve false si el navegador no deja escribir y true si sí", () => {
  const guardados: Record<string, string> = {};
  const a: PerfilTamano = { id: "propio-a", nombre: "A", mezcla: [{ t: 0, pesos: { "R-9": 1 } }] };
  const ok = guardarPerfilesPropios({ setItem: (k, v) => { guardados[k] = v; } }, [a]);
  assert.equal(ok, true);
  assert.deepEqual(leerPerfilesPropios({ getItem: (k) => guardados[k] ?? null }), [a]);
  assert.equal(guardarPerfilesPropios({ setItem: () => { throw new Error("cuota"); } }, []), false);
  assert.equal(guardarPerfilesPropios(undefined, []), false);
});

test("un perfil propio nuevo tiene nombre limpio, id estable y no repite ids", () => {
  const mezcla = perfil("cono").mezcla;
  const primero = nuevoPerfilPropio("  Mi  cono ", mezcla, []);
  assert.ok(primero);
  assert.equal(primero.nombre, "Mi cono");
  assert.equal(primero.id, "propio-mi-cono");
  const segundo = nuevoPerfilPropio("Mi cono", mezcla, [primero]);
  assert.equal(segundo?.id, "propio-mi-cono-2");
  assert.equal(nuevoPerfilPropio("   ", mezcla, []), null);
});

test("un perfil propio sin mezcla o con id de fábrica no se lee", () => {
  const sinMezcla = { id: "propio-vacio", nombre: "Vacío", mezcla: [] };
  const choca = { id: "cono", nombre: "Mi cono", mezcla: [{ t: 0, pesos: { "R-9": 1 } }] };
  const bueno = { id: "propio-ok", nombre: "Ok", mezcla: [{ t: 0, pesos: { "R-9": 1 } }] };
  assert.deepEqual(leerPerfilesPropios({ getItem: () => JSON.stringify([sinMezcla, choca, bueno]) }), [bueno]);
});

test("se puede quitar un perfil propio por su id y los demás quedan", () => {
  const a = { id: "propio-a", nombre: "A", mezcla: [{ t: 0, pesos: { "R-9": 1 } }] };
  const b = { id: "propio-b", nombre: "B", mezcla: [{ t: 0, pesos: { "R-12": 1 } }] };
  assert.deepEqual(quitarPerfilPropio([a, b], "propio-a"), [b]);
  assert.deepEqual(quitarPerfilPropio([a, b], "no-esta"), [a, b]);
});

test("el perfil activo es el cuya mezcla tiene la columna; con una mezcla a mano no hay ninguno", () => {
  const columna = formaColumna({ altoCm: 230, radioBaseCm: 42, radioMedioCm: 36, radioPuntaCm: 27 });
  const antes = opciones([columna]);
  assert.equal(perfilActivo(antes, []), null);
  assert.equal(perfilActivo(aplicarPerfilTamano(antes, perfil("bolo")), [])?.id, "bolo");
  const propio: PerfilTamano = { id: "propio-x", nombre: "X", mezcla: [{ t: 0, pesos: { "R-5": 1 } }, { t: 1, pesos: { "R-24": 1 } }] };
  assert.equal(perfilActivo(aplicarPerfilTamano(antes, propio), [propio])?.id, "propio-x");
  const aMano = opciones([{ ...columna, mezcla: [{ t: 0, pesos: { "R-5": 1 } }, { t: 1, pesos: { "R-9": 1 } }] }]);
  assert.equal(perfilActivo(aMano, [propio]), null);
});
