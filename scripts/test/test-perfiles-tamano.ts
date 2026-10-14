/**
 * T42: perfiles de tamaño de columna. Prueba el código real de `perfiles-tamano.ts` con una columna orgánica real.
 * Run: npx tsx --conditions=react-server scripts/test/test-perfiles-tamano.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { formaColumna, type OpcionesOrganico } from "../../src/lib/globos3d/organico";
import {
  PERFILES_FABRICA, aplicarPerfilTamano, guardarPerfilesPropios, leerPerfilesPropios, mezclaDeOpciones, nuevoPerfilPropio, perfilActivo, quitarPerfilPropio,
} from "../../src/lib/globos3d/perfiles-tamano";

const GRANDES = ["R-18", "R-24"];
const CHICOS = ["R-5", "R-9"];
const peso = (id: string, t: number, formatos: string[]): number => {
  const p = PERFILES_FABRICA.find((x) => x.id === id)?.mezcla.find((m) => m.t === t);
  assert.ok(p, `${id} no tiene punto t=${t}`);
  return formatos.reduce((s, f) => s + (p.pesos[f] ?? 0), 0);
};
const columnaOrganica = (): OpcionesOrganico => ({
  semilla: 3, tramos: [formaColumna({ altoCm: 230, radioBaseCm: 42, radioMedioCm: 36, radioPuntaCm: 27 })], variacionInflado: 0.07, relleno: [],
  colores: [{ codigo: "640", peso: 1 }], suelo: true, huecosFlores: 0,
});

test("los cuatro perfiles pedidos existen (champaña, botella, bolo, taper) con pesos que suman 1 en cada punto", () => {
  for (const id of ["champana", "botella", "bolo", "cono"]) assert.ok(PERFILES_FABRICA.some((p) => p.id === id), id);
  for (const p of PERFILES_FABRICA) for (const m of p.mezcla) assert.ok(Math.abs(Object.values(m.pesos).reduce((s, v) => s + v, 0) - 1) < 1e-9, `${p.id} t=${m.t}`);
});

test("las siluetas son las del nombre: taper grande abajo, bolo grande arriba, botella con cuerpo en medio", () => {
  assert.ok(peso("cono", 0, GRANDES) > peso("cono", 1, GRANDES));
  assert.ok(peso("bolo", 1, GRANDES) > peso("bolo", 0, GRANDES));
  assert.ok(peso("botella", 0.6, GRANDES) > peso("botella", 0, GRANDES));
  assert.ok(peso("botella", 0.6, GRANDES) > peso("botella", 1, GRANDES));
  assert.ok(peso("cono", 1, CHICOS) > 0.5);
});

test("aplicar un perfil reemplaza solo la mezcla de la columna, es determinista y no muta el origen", () => {
  const antes = columnaOrganica();
  const copia = structuredClone(antes);
  const a = aplicarPerfilTamano(antes, PERFILES_FABRICA.find((p) => p.id === "bolo")!);
  assert.deepEqual(a, aplicarPerfilTamano(antes, PERFILES_FABRICA.find((p) => p.id === "bolo")!));
  assert.deepEqual(antes, copia);
  assert.notDeepEqual(mezclaDeOpciones(a), mezclaDeOpciones(antes));
  assert.equal(perfilActivo(a, [])?.id, "bolo");
  assert.equal(a.semilla, antes.semilla);
});

test("«guardar el tuyo»: ciclo guardar, leer y quitar en un almacén, con id único y sin lanzar si falla", () => {
  const almacen: Record<string, string> = {};
  const lectura = { getItem: (k: string) => almacen[k] ?? null };
  const mezcla = PERFILES_FABRICA[0]!.mezcla;
  const a = nuevoPerfilPropio("Mi copa", mezcla, []);
  assert.ok(a);
  const b = nuevoPerfilPropio("Mi copa", mezcla, [a]);
  assert.ok(b);
  assert.notEqual(a.id, b.id);
  assert.equal(guardarPerfilesPropios({ setItem: (k, v) => { almacen[k] = v; } }, [a, b]), true);
  assert.deepEqual(leerPerfilesPropios(lectura).map((p) => p.id), [a.id, b.id]);
  assert.deepEqual(quitarPerfilPropio(leerPerfilesPropios(lectura), a.id).map((p) => p.id), [b.id]);
  assert.equal(guardarPerfilesPropios({ setItem: () => { throw new Error("cuota"); } }, [a]), false);
  assert.deepEqual(leerPerfilesPropios({ getItem: () => { throw new Error("bloqueado"); } }), []);
  assert.deepEqual(leerPerfilesPropios({ getItem: () => "{roto" }), []);
});

test("un perfil guardado que pisa el id de uno de fábrica o sin mezcla se descarta al leer", () => {
  const malos = [{ id: "bolo", nombre: "X", mezcla: [{ t: 0, pesos: { "R-9": 1 } }] }, { id: "propio-v", nombre: "V", mezcla: [] }];
  assert.deepEqual(leerPerfilesPropios({ getItem: () => JSON.stringify(malos) }), []);
});
