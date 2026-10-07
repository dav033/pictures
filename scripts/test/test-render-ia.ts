/**
 * Texto que acompaña la captura del taller 3D a FLUX `/edit` (`promptRender3d`, `descripcionRender3d`). Sin coste:
 * no llama a FLUX.
 * - pide conservar forma, cantidades y colores, y cambia solo el fondo y el piso por el lugar elegido;
 * - la descripción va en inglés, de mayor a menor cantidad, y nunca pasa de MAX_DESCRIPCION.
 */
import assert from "node:assert/strict";
import { AMBIENTES_RENDER, MAX_DESCRIPCION, descripcionRender3d, formatoEnIngles, promptRender3d } from "../../src/lib/globos3d/render-ia";

assert.equal(formatoEnIngles("R-12"), "12-inch round");
assert.equal(formatoEnIngles("LOL-6"), "6-inch Link-O-Loon");
assert.equal(formatoEnIngles("T-260"), "260 twisting tube");
assert.equal(formatoEnIngles("C-12"), "12-inch heart");

const descripcion = descripcionRender3d("A balloon column 1.8 m tall", [
  { cantidad: 8, formatoId: "R-12", colorEn: "Pastel Matte Pink" },
  { cantidad: 40, formatoId: "R-12", colorEn: "Fashion White" },
]);
assert.equal(descripcion, "A balloon column 1.8 m tall. Colors: about 83% Fashion White, 17% Pastel Matte Pink. Sizes: 12-inch round balloons");
const mezcla = descripcionRender3d("An organic column", [
  { cantidad: 30, formatoId: "R-5", colorEn: "Pastel Matte Blue" }, { cantidad: 2, formatoId: "R-24", colorEn: "Pastel Matte Blue" },
  { cantidad: 10, formatoId: "R-12", colorEn: "Reflex Silver" }, { cantidad: 6, formatoId: "T-260", colorEn: "Fashion Pink" }, { cantidad: 4, formatoId: "LOL-12", colorEn: "Fashion Pink" },
]);
assert.equal(mezcla, "An organic column. Colors: about 62% Pastel Matte Blue, 19% Reflex Silver, 19% Fashion Pink. Sizes: round balloons from 5 to 24 inches, twisting balloons, Link-O-Loon balloons");

const larga = descripcionRender3d(`A wall ${"with many small details ".repeat(40)}`, Array.from({ length: 80 }, (_, i) => ({ cantidad: i + 1, formatoId: "R-5", colorEn: `Color number ${i}` })));
assert.ok(larga.length <= MAX_DESCRIPCION, `descripción de ${larga.length} caracteres`);
assert.ok(larga.endsWith("…"));

for (const ambiente of AMBIENTES_RENDER) {
  const prompt = promptRender3d(descripcion, ambiente.id);
  assert.ok(prompt.includes(ambiente.frase), ambiente.id);
  assert.ok(/same number, size, position and color of every balloon/.test(prompt));
  assert.ok(prompt.includes(`The decoration: ${descripcion}.`));
  assert.ok(!/Sempertex/i.test(prompt), "sin marcas en el texto");
}
assert.ok(!promptRender3d("", "estudio").includes("The decoration:"));

console.log("test-render-ia: ok");
