/**
 * Clasificación de resultados del arnés y escritura de filas del leaderboard (W4). Puro: sin red, sin coste, sin disco.
 *   npx tsx scripts/test/test-entrenamiento-clasificar.ts
 */
import assert from "node:assert/strict";
import type { RegistroPasada } from "../entrenamiento/lib-agregado";
import { actualizarLeaderboard, clasificarResultado, filaDeResultado, rutaDeTriptico } from "../entrenamiento/lib-clasificar";
import { inventariarFotos, esqueletoDeLeaderboard } from "../entrenamiento/inventario";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

const registro = (sobre: Partial<RegistroPasada> = {}): RegistroPasada => ({
  foto: "images (25).jpg", modo: "seco", transporte: "seco", modelo: "claude-haiku-5-5", esfuerzo: "medium", pensamiento: true, commit: "abc", iniciadaEn: "2026-10-14T10:00:00.000Z",
  turnos: 1, turnosMax: 1, llamadas: 5, deteccionCacheada: false, convergio: true,
  puntajes: { proporciones: 0.8, colores: 0.6, zonas: null, iou: null },
  piezas: { leidas: 2, armadas: 2, omitidas: 0, globosFoto: 3, globosArmados: 10 },
  fallos: [], captura: "pendiente", costeUsd: 0.1, abortada: null, error: null, ...sobre,
});

console.log("Clasificación y leaderboard del arnés (W4):");

prueba("un resultado sano no tiene clase, y la captura pendiente no es un fallo del visor", () => {
  assert.deepEqual(clasificarResultado(registro()), []);
});

prueba("cada etapa que se rompe cae en su clase", () => {
  assert.deepEqual(clasificarResultado(registro({ error: "La IA no pudo leer la foto", piezas: { leidas: 0, armadas: 0, omitidas: 0, globosFoto: 0, globosArmados: 0 }, puntajes: { proporciones: null, colores: null, zonas: null, iou: null } })), ["lectura"]);
  assert.deepEqual(clasificarResultado(registro({ puntajes: { proporciones: null, colores: null, zonas: null, iou: null } })), ["medida"]);
  assert.deepEqual(clasificarResultado(registro({ piezas: { leidas: 3, armadas: 2, omitidas: 1, globosFoto: 3, globosArmados: 10 } })), ["compilacion"]);
  assert.deepEqual(clasificarResultado(registro({ piezas: { leidas: 3, armadas: 2, omitidas: 1, globosFoto: 3, globosArmados: 10 }, capacidades: { falta_figura: 1 } })), ["capacidad_faltante"], "con causa de capacidad, la omitida no cuenta como fallo de compilación");
  assert.deepEqual(clasificarResultado(registro({ piezas: { leidas: 1, armadas: 1, omitidas: 0, globosFoto: 3, globosArmados: 0 }, puntajes: { proporciones: 0, colores: null, zonas: null, iou: 0 } })), ["escena_vacia"]);
  assert.deepEqual(clasificarResultado(registro(), true), ["visor"]);
  assert.deepEqual(clasificarResultado(registro({ fallos: ["agente"] })), ["agente"]);
});

prueba("varias causas a la vez salen todas, en el orden fijo de las clases", () => {
  const r = registro({ piezas: { leidas: 3, armadas: 1, omitidas: 2, globosFoto: 3, globosArmados: 0 }, puntajes: { proporciones: 0, colores: null, zonas: null, iou: 0 }, fallos: ["agente"] });
  assert.deepEqual(clasificarResultado(r, true), ["compilacion", "visor", "escena_vacia", "agente"]);
});

prueba("la fila lleva el puntaje medio, la clase y la ruta del triptico", () => {
  const fila = filaDeResultado(registro(), "/corridas/2026-10-14T10-00-00-000Z");
  assert.equal(fila.puntaje, 0.7);
  assert.equal(fila.triptico, "/corridas/2026-10-14T10-00-00-000Z/images (25)-triptico.png");
  assert.equal(rutaDeTriptico("/x/", "images (26).jpg"), "/x/images (26)-triptico.png");
  assert.equal(filaDeResultado(registro({ puntajes: { proporciones: null, colores: null, zonas: null, iou: null } }), "/x").puntaje, null);
});

prueba("actualizar el leaderboard cambia solo la fila de la foto, suma la corrida y agrega las fotos que no estaban", () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "clasificar-"));
  try {
    for (const n of [25, 26]) writeFileSync(path.join(tmp, `images (${n}).jpg`), `bytes-${n}`);
    const base = esqueletoDeLeaderboard(inventariarFotos(tmp), "2026-10-14T00:00:00.000Z");
    const una = actualizarLeaderboard(base, filaDeResultado(registro({ fallos: [], piezas: { leidas: 3, armadas: 2, omitidas: 1, globosFoto: 3, globosArmados: 10 } }), "/c/uno"));
    const filas = una.split("\n").filter((l) => /^\| \d+ \|/.test(l));
    assert.equal(filas.length, 2);
    assert.match(filas[0]!, /^\| 1 \| images \(25\)\.jpg \| foto-25 \| [0-9a-f]{12} \| 0\.70 \| compilacion \| 1 \| 2026-10-14T10:00:00\.000Z \| corrida \| \/c\/uno\/images \(25\)-triptico\.png \|$/);
    assert.equal(filas[1], base.split("\n").filter((l) => /^\| \d+ \|/.test(l))[1], "la otra foto no cambia");
    const dos = actualizarLeaderboard(una, filaDeResultado(registro({ iniciadaEn: "2026-10-14T11:00:00.000Z" }), "/c/dos"));
    assert.match(dos.split("\n").find((l) => l.includes("images (25).jpg"))!, /\| ninguno \| 2 \| 2026-10-14T11:00:00\.000Z \| corrida \| \/c\/dos\//);
    const nueva = actualizarLeaderboard(dos, filaDeResultado(registro({ foto: "images (40).jpg" }), "/c/dos"));
    assert.match(nueva.split("\n").filter((l) => /^\| \d+ \|/.test(l)).at(-1)!, /^\| 3 \| images \(40\)\.jpg \| — \| — \|/);
    assert.equal(nueva.split("\n").length, dos.split("\n").length + 1);
    assert.throws(() => actualizarLeaderboard("# sin tabla\n", filaDeResultado(registro(), "/c")), /esqueleto/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

console.log(`test-entrenamiento-clasificar: ok (${pruebas} pruebas)`);
