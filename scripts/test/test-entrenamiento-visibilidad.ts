/**
 * Métrica con los globos visibles (`lib-visibilidad.ts`, `lib-puntuacion.ts`). Puras, sin red.
 *   npx tsx --conditions=react-server scripts/test/test-entrenamiento-visibilidad.ts
 */
import assert from "node:assert/strict";
import { compilarLectura } from "../../src/lib/globos3d/compilar-lectura";
import { LecturaFotoSchema } from "../../src/lib/globos3d/lectura-foto";
import { CAJAS_DETECCION_SECO, LECTURA_SECO } from "../entrenamiento/fixtures/lectura-seco";
import { puntuarEscena } from "../entrenamiento/lib-puntuacion";
import { discosVisibles, fraccionVisible, type DiscoConProfundidad } from "../exp/lib-visibilidad";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

console.log("Globos visibles");
const disco = (x: number, y: number, prof: number): DiscoConProfundidad => ({ x, y, r: 0.05, prof, diametroCm: 30 });
prueba("las capas de atrás tapadas por la de delante no se cuentan; los de una misma capa sí", () => {
  const delante = Array.from({ length: 10 }, (_, i) => disco(0.1 + i * 0.05, 0.5, 300));
  const detras = [...delante.map((d) => ({ ...d, prof: 340 })), ...delante.map((d) => ({ ...d, prof: 380 }))];
  const todos = [...delante, ...detras];
  assert.equal(todos.length, 30);
  assert.equal(discosVisibles(todos).length, 10, "solo la capa de delante");
  assert.equal(discosVisibles(delante).length, 10, "una capa sola, solapada de lado, se ve entera");
  const f = fraccionVisible(todos);
  assert.ok(f.slice(0, 10).every((v) => v === 1) && f.slice(10).every((v) => v < 0.4));
});
prueba("un globo de atrás desplazado de modo que queda tapado menos del 60 % cuenta", () => {
  const delante = disco(0.5, 0.5, 300);
  const casiLibre = { ...disco(0.5 + 0.085, 0.5, 400) };
  assert.equal(discosVisibles([delante, casiLibre]).length, 2);
});

console.log("Puntuación con las dos medidas");
prueba("la puntuación da la medida con visibles y la de antes con todos, y cuenta los visibles", () => {
  const lectura = LecturaFotoSchema.parse(LECTURA_SECO);
  const escena = compilarLectura(lectura).escena;
  const deteccion = { globos: CAJAS_DETECCION_SECO.map((c) => ({ box_2d: [...c.box_2d], color: c.color })), fondos: [], uso: { entrada: 0, salida: 0, pensamiento: 0 }, costeEstimadoUsd: 0, trozos: 1, fallidos: 0, racimos: { revisadas: 0, quitadas: 0 } };
  const p = puntuarEscena({ lectura, escena, deteccion });
  assert.ok(p.piezas.globosArmadosVisibles > 0 && p.piezas.globosArmadosVisibles <= p.piezas.globosArmados);
  assert.ok(typeof p.puntajes.proporciones === "number" && typeof p.puntajesTodos.proporciones === "number");
});

console.log(`test-entrenamiento-visibilidad: ${pruebas} pruebas ok`);
