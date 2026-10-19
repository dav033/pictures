/**
 * Lectura de foto → escena (`lectura-foto.ts`, `compilar-lectura.ts`) con las 13 fotos de referencia del dueño,
 * leídas a mano (`referencias-dueno.ts`). Sin coste: no llama a ningún modelo.
 * - cada lectura cumple el esquema (el mismo que se le pide a Gemini) y compila sin piezas perdidas: todo lo que no es
 *   `otro` sale como nodo; la escena arma sin avisos;
 * - la escala manda: una guirnalda leída de 0,06 a 0,83 del ancho en una foto de 250 cm mide ~190 cm;
 * - los colores salen por su nombre de decorador («azul marino» → 044, «dorado» cromado → 970) y el confeti en 390;
 * - lo que nace del piso queda en el piso; lo de pared, a su altura;
 * - un globo o unos corazones «en el aire» de la foto salen de aire con un aviso (no se sabe si flotan o cuelgan); el ramo de helio, de helio;
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
import { esGloboDeHelio } from "@/lib/globos3d/helio-cinta";
import { NOTA_GLOBOS_EN_EL_AIRE } from "@/lib/globos3d/corazones-lectura";

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

// Un adorno mal nombrado nunca tira la guirnalda: color plural («pampas doradas»), color que esa flor no trae y follaje inventado.
for (const [follaje, esperado, notasEsperadas] of [
  [["pampas doradas"], ["pampa dorada"], 0], [["pampas doradas", "girasol azul"], ["pampa dorada"], 1], [["pampas moradas"], ["pampa beige"], 1], [["girasol"], [], 1],
] as const) {
  const lectura = structuredClone(REFERENCIAS_DUENO[0]!.lectura);
  for (const p of lectura.piezas) if (p.tipo === "guirnalda_organica") p.follaje = [...follaje];
  LecturaFotoSchema.parse(lectura);
  const r = compilarLectura(lectura);
  assert.ok(!r.omitidas.some((o) => /guirnalda_organica/.test(o)), `${follaje.join("+")}: la guirnalda se perdió: ${r.omitidas.join(" | ")}`);
  const sacadas = new Set(armarEscena(r.escena).flores.map((f) => `${f.tipo} ${FLORES_ARTIFICIALES[f.tipo].colores.find((c) => c.hex === f.hex)!.id}`));
  assert.deepEqual([...sacadas].sort(), [...esperado], follaje.join("+"));
  assert.equal(r.notas.filter((n) => /Follaje|no viene en/.test(n)).length, notasEsperadas, `${follaje.join("+")}: ${r.notas.join(" | ")}`);
}

// Helio de la lista de compra: «en el aire» es solo dónde se ve el globo (flotando o colgado): sale de aire y la lectura avisa, una sola vez.
// El ramo de helio sí es helio. Los corazones se tratan igual que un globo suelto.
const color = { nombre: "rojo", hex: "#dc1010", peso: 100, acabado: "mate" } as const;
const sueltos = structuredClone(REFERENCIAS_DUENO[0]!.lectura);
sueltos.piezas = [
  { tipo: "globo", x: 0.3, y: 0.3, diametro: 0.1, en: "aire", colores: [color] },
  { tipo: "globo", x: 0.6, y: 0.8, diametro: 0.1, en: "piso", colores: [color] },
  { tipo: "corazon", x: 0.5, y: 0.3, en: "aire", cantidad: 2, colores: [color] },
  { tipo: "corazon", x: 0.2, y: 0.8, en: "piso", cantidad: 2, colores: [color] },
  { tipo: "ramo_helio", x: 0.8, yBase: 0.7, yArriba: 0.3, cantidad: 3, colores: [color] },
];
LecturaFotoSchema.parse(sueltos);
const conAire = compilarLectura(sueltos);
const flotan = armarEscena(conAire.escena).porNodo.map((n) => [n.id.replace(/-\d+$/, ""), n.globos.filter(esGloboDeHelio).length] as const);
assert.deepEqual(flotan.filter(([, k]) => k > 0), [["ramo", 1], ["ramo", 1], ["ramo", 1]], "solo flotan los tres del ramo de helio");
assert.equal(conAire.notas.filter((n) => n === NOTA_GLOBOS_EN_EL_AIRE).length, 1, "el aviso de los globos en el aire sale una vez");
assert.ok(!compilarLectura({ ...sueltos, piezas: sueltos.piezas.filter((p) => !("en" in p) || p.en === "piso") }).notas.includes(NOTA_GLOBOS_EN_EL_AIRE), "sin globos en el aire no hay aviso");

// Colores.
const notas: string[] = [];
assert.equal(codigoDeColor({ nombre: "azul marino", hex: "#1d2b5c", peso: 50, acabado: "mate" }, ["R-12"], notas), "044");
assert.equal(codigoDeColor({ nombre: "dorado", hex: "#c9a24e", peso: 50, acabado: "cromado" }, ["R-12"], notas), "970");
assert.equal(codigoDeColor({ nombre: "cristal con confeti dorado", hex: "#eee", peso: 10, acabado: "confeti" }, ["R-12"], notas), "390");
assert.match(codigoDeColor({ nombre: "verde loro inventado", hex: "#2fa84f", peso: 10, acabado: "mate" }, ["R-12"], notas), /^\d{3}$/);
console.log("test-compilar-lectura: ok");
