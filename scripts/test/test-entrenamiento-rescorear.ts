/**
 * Volver a puntuar una corrida (`lib-rescorear.ts`): la detección se elige por su foto, lo ambiguo no se adivina y el fallo de una foto no para a las demás.
 *   npx tsx --conditions=react-server scripts/test/test-entrenamiento-rescorear.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DeteccionGuardada } from "../entrenamiento/lib-cache-deteccion";
import { guardarDeteccionCacheada } from "../entrenamiento/lib-cache-deteccion";
import { elegirDeteccion, rescorearTodas } from "../entrenamiento/lib-rescorear";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

const det = (n: number, x: number, foto?: string, fondos: string[] = ["pedestales"]): DeteccionGuardada => ({
  globos: Array.from({ length: n }, (_, i) => ({ box_2d: [i, x, i + 10, x + 10], color: "azul" })), fondos: fondos.map((id) => ({ id, box_2d: [0, 0, 10, 10] })),
  uso: { entrada: 0, salida: 0, pensamiento: 0 }, costeEstimadoUsd: 0, trozos: 1, fallidos: 0, racimos: { revisadas: 0, quitadas: 0 }, ...(foto ? { foto } : {}),
});

prueba("el arnés guarda la foto en la caché y se recupera por ella aunque otra foto tenga los mismos globos y fondos", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "rescorear-"));
  guardarDeteccionCacheada(dir, "a", det(5, 1), "real", "images (25).jpg");
  guardarDeteccionCacheada(dir, "b", det(5, 2), "real", "images (26).jpg");
  const cache = readdirSync(dir).map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")) as DeteccionGuardada);
  const e = elegirDeteccion(cache, "images (26).jpg", { globos: 5, fondos: ["pedestales"] });
  assert.equal(e.foto, "images (26).jpg");
  assert.equal(e.globos[0]!.box_2d[1], 2);
});

prueba("una caché vieja sin foto sirve si solo una detección concuerda; si hay dos distintas, no se adivina", () => {
  assert.equal(elegirDeteccion([det(5, 1), det(7, 1)], "images (25).jpg", { globos: 5, fondos: ["pedestales"] }).globos.length, 5);
  assert.equal(elegirDeteccion([det(5, 1), det(5, 1)], "images (25).jpg", { globos: 5, fondos: ["pedestales"] }).globos.length, 5, "dos copias iguales son una");
  assert.throws(() => elegirDeteccion([det(5, 1), det(5, 2)], "images (25).jpg", { globos: 5, fondos: ["pedestales"] }), /podrían ser de images \(25\)/);
  assert.throws(() => elegirDeteccion([det(6, 1)], "images (25).jpg", { globos: 5, fondos: ["pedestales"] }), /Sin detección en caché/);
  assert.throws(() => elegirDeteccion([det(5, 1, undefined, ["media_luna"])], "images (25).jpg", { globos: 5, fondos: ["pedestales"] }), /Sin detección/);
});

prueba("la foto de otra no sirve aunque coincida el número de globos", () => {
  assert.throws(() => elegirDeteccion([det(5, 1, "images (30).jpg")], "images (25).jpg", { globos: 5, fondos: ["pedestales"] }), /Sin detección/);
});

prueba("el fallo de una foto queda anotado y las demás se puntúan", () => {
  const r = rescorearTodas(["a", "b", "c"], (a) => { if (a === "b") throw new Error("sin auditoría"); return a.toUpperCase(); });
  assert.deepEqual(r.filas, ["A", "C"]);
  assert.deepEqual(r.errores, [{ archivo: "b", error: "sin auditoría" }]);
});

console.log(`test-entrenamiento-rescorear: ${pruebas} pruebas ok`);
