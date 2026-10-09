/**
 * Lectura de foto → escena (`lectura-foto.ts`, `compilar-lectura.ts`) con las 13 fotos de referencia del dueño,
 * leídas a mano (`referencias-dueno.ts`). Sin coste: no llama a ningún modelo.
 * - cada lectura cumple el esquema (el mismo que se le pide a Gemini) y compila sin piezas perdidas: todo lo que no es
 *   `otro` sale como nodo; la escena arma sin avisos;
 * - la escala manda: una guirnalda leída de 0,06 a 0,83 del ancho en una foto de 250 cm mide ~190 cm;
 * - los colores salen por su nombre de decorador («azul marino» → 044, «dorado» cromado → 970) y el confeti en 390;
 * - lo que nace del piso queda en el piso; lo de pared, a su altura;
 * - determinista: dos compilaciones dan la misma escena.
 *
 * Run: npx tsx scripts/test/test-compilar-lectura.ts
 */
import assert from "node:assert/strict";
import { REFERENCIAS_DUENO } from "@/lib/globos3d/referencias-dueno";
import { LecturaFotoSchema } from "@/lib/globos3d/lectura-foto";
import { compilarLectura, codigoDeColor } from "@/lib/globos3d/compilar-lectura";
import { armarEscena } from "@/lib/globos3d/escena";
import { FLORES_ARTIFICIALES } from "@/lib/globos3d/flores-artificiales";

assert.equal(REFERENCIAS_DUENO.length, 13);
for (const r of REFERENCIAS_DUENO) {
  LecturaFotoSchema.parse(r.lectura);
  const { escena, omitidas } = compilarLectura(r.lectura);
  assert.ok(!omitidas.some((o) => /^Pieza \d/.test(o)), `${r.numero}: ${omitidas.join(" | ")}`);
  const otros = r.lectura.piezas.filter((p) => p.tipo === "otro").length;
  assert.ok(escena.nodos.length >= r.lectura.piezas.length - otros, `${r.numero}: ${escena.nodos.length} nodos`);
  const armada = armarEscena(escena);
  assert.deepEqual(armada.avisos, [], `${r.numero}: ${armada.avisos.join(" | ")}`);
  assert.deepEqual(compilarLectura(r.lectura).escena, escena, `${r.numero}: determinista`);
}

// Escala: foto 1, guirnalda de 0,06 a 0,83 del ancho, imagen de 250 cm de alto y aspecto 1 → ~190 cm (+ su grosor).
const uno = compilarLectura(REFERENCIAS_DUENO[0]!.lectura);
const guirnalda = armarEscena(uno.escena).porNodo.find((n) => n.id.startsWith("guirnalda-organica"))!;
const ancho = guirnalda.caja.max.x - guirnalda.caja.min.x;
assert.ok(ancho > 190 && ancho < 260, `ancho ${ancho.toFixed(0)}`);
assert.ok(guirnalda.caja.min.y > 150, `la guirnalda va arriba en la pared (${guirnalda.caja.min.y.toFixed(0)})`);

// Foto 2: el medio arco nace del piso.
const dos = armarEscena(compilarLectura(REFERENCIAS_DUENO[1]!.lectura).escena);
assert.ok(dos.porNodo.find((n) => n.id.startsWith("guirnalda-organica"))!.caja.min.y < 8, "el medio arco nace del piso");

// Una lectura con «pampa beige» en el follaje de la guirnalda compila a plumas de pampa en los huecos (no a hojas secas).
const conPampa = structuredClone(REFERENCIAS_DUENO[0]!.lectura);
for (const p of conPampa.piezas) if (p.tipo === "guirnalda_organica") p.follaje = ["pampas beige"];
LecturaFotoSchema.parse(conPampa);
const floresLeidas = armarEscena(compilarLectura(conPampa).escena).flores;
assert.ok(floresLeidas.length > 0 && floresLeidas.every((f) => f.tipo === "pampa" && f.hex === FLORES_ARTIFICIALES.pampa.colores.find((c) => c.id === "beige")!.hex), `${floresLeidas.length} flores leídas`);

// Colores.
const notas: string[] = [];
assert.equal(codigoDeColor({ nombre: "azul marino", hex: "#1d2b5c", peso: 50, acabado: "mate" }, ["R-12"], notas), "044");
assert.equal(codigoDeColor({ nombre: "dorado", hex: "#c9a24e", peso: 50, acabado: "cromado" }, ["R-12"], notas), "970");
assert.equal(codigoDeColor({ nombre: "cristal con confeti dorado", hex: "#eee", peso: 10, acabado: "confeti" }, ["R-12"], notas), "390");
assert.match(codigoDeColor({ nombre: "verde loro inventado", hex: "#2fa84f", peso: 10, acabado: "mate" }, ["R-12"], notas), /^\d{3}$/);
console.log("test-compilar-lectura: ok");
