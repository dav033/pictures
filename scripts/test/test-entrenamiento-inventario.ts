/**
 * Inventario de las fotos de entrenamiento (W4): sobre una carpeta temporal, nunca las fotos del dueño.
 *   npx tsx scripts/test/test-entrenamiento-inventario.ts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { carpetaDeFotos, escribirEsqueleto, esqueletoDeLeaderboard, inventariarFotos } from "../entrenamiento/inventario";
import { FOTOS_POR_DEFECTO } from "../entrenamiento/lib-fotos";

const tmp = mkdtempSync(path.join(tmpdir(), "entrenamiento-inventario-"));
let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const carpeta = path.join(tmp, "fotos");
mkdirSync(carpeta);
const contenidos = new Map<string, Buffer>();
for (const n of [30, 25, 54, 26]) {
  const bytes = Buffer.from(`foto-falsa-${n}`);
  contenidos.set(`images (${n}).jpg`, bytes);
  writeFileSync(path.join(carpeta, `images (${n}).jpg`), bytes);
}
for (const ajeno of ["images (24).jpg", "images (55).jpg", "images (25).png", "notas.txt"]) writeFileSync(path.join(carpeta, ajeno), "no cuenta");

console.log("Inventario de fotos del entrenamiento (W4):");

prueba("lista solo el rango 25-54, en orden numérico, con id estable, tamaño y hash de los bytes", () => {
  const { fotos, faltantes } = inventariarFotos(carpeta);
  assert.deepEqual(fotos.map((f) => f.id), ["foto-25", "foto-26", "foto-30", "foto-54"]);
  for (const f of fotos) {
    const bytes = contenidos.get(f.nombre)!;
    assert.equal(f.sha256, sha(bytes));
    assert.equal(f.bytes, bytes.byteLength);
  }
  assert.equal(faltantes.length, 30 - 4);
  assert.ok(!faltantes.includes(25) && faltantes.includes(27));
});

prueba("el id y el hash no dependen del orden ni de otras fotos; un byte distinto cambia el hash", () => {
  const otra = path.join(tmp, "otra");
  mkdirSync(otra);
  writeFileSync(path.join(otra, "images (30).jpg"), contenidos.get("images (30).jpg")!);
  const sola = inventariarFotos(otra).fotos[0]!;
  assert.deepEqual(sola, inventariarFotos(carpeta).fotos.find((f) => f.id === "foto-30"));
  writeFileSync(path.join(otra, "images (30).jpg"), "otro contenido");
  assert.notEqual(inventariarFotos(otra).fotos[0]!.sha256, sola.sha256);
  assert.equal(inventariarFotos(otra).fotos[0]!.id, sola.id);
});

prueba("es solo lectura: la carpeta queda igual", () => {
  const antes = readFileSync(path.join(carpeta, "images (25).jpg"));
  inventariarFotos(carpeta);
  assert.deepEqual(readFileSync(path.join(carpeta, "images (25).jpg")), antes);
  assert.equal(existsSync(path.join(carpeta, "LEADERBOARD.md")), false);
});

prueba("una carpeta que no existe falla con el error de lectura, no devuelve un inventario vacío", () => {
  assert.throws(() => inventariarFotos(path.join(tmp, "no-existe")), /ENOENT/);
});

prueba("la carpeta sale del argumento, luego del entorno, y solo al final del valor de este equipo", () => {
  assert.equal(carpetaDeFotos("/a", { ENTRENAMIENTO_FOTOS: "/b" }), "/a");
  assert.equal(carpetaDeFotos(undefined, { ENTRENAMIENTO_FOTOS: "/b" }), "/b");
  assert.equal(carpetaDeFotos(" ", {}), FOTOS_POR_DEFECTO);
});

prueba("el esqueleto tiene una fila por foto y no pisa un leaderboard existente", () => {
  const inventario = inventariarFotos(carpeta);
  const md = esqueletoDeLeaderboard(inventario, "2026-10-14T00:00:00.000Z");
  const filas = md.split("\n").filter((l) => /^\| \d+ \|/.test(l));
  assert.equal(filas.length, 4);
  assert.match(filas[0]!, /images \(25\)\.jpg \| foto-25 \| [0-9a-f]{12} \|/);
  assert.match(md, /faltan los números 27/);
  const ruta = path.join(tmp, "bitacora", "LEADERBOARD.md");
  assert.equal(escribirEsqueleto(ruta, inventario, "2026-10-14T00:00:00.000Z"), true);
  writeFileSync(ruta, "filas de corridas");
  assert.equal(escribirEsqueleto(ruta, inventario, "2026-10-14T00:00:00.000Z"), false);
  assert.equal(readFileSync(ruta, "utf8"), "filas de corridas");
});

rmSync(tmp, { recursive: true, force: true });
console.log(`test-entrenamiento-inventario: ok (${pruebas} pruebas)`);
