import assert from "node:assert/strict";
import { medirDominanciaElemento, type MuestraPixeles } from "../../src/lib/plan/dominancia-color";
import { zonaDeCroquis } from "../../src/lib/plan/croquis-zona";
import { coloresNombradosReferencia } from "../../src/lib/plan/colores-referencia";
import { codigosPorPalabras, cruzarColor } from "../../src/lib/plan/referencia-sempertex";

function muestraDeFranjas(franjas: readonly { color: readonly [number, number, number]; parte: number }[]): MuestraPixeles {
  const ancho = 100;
  const alto = 20;
  const rgb = new Uint8Array(ancho * alto * 3);
  for (let y = 0; y < alto; y += 1) {
    for (let x = 0; x < ancho; x += 1) {
      const parte = (x + 0.5) / ancho;
      const franja = franjas.find((candidata) => parte <= candidata.parte)!;
      const indice = (y * ancho + x) * 3;
      rgb[indice] = franja.color[0];
      rgb[indice + 1] = franja.color[1];
      rgb[indice + 2] = franja.color[2];
    }
  }
  return { ancho, alto, rgb };
}

const medida = medirDominanciaElemento(
  muestraDeFranjas([
    { color: [198, 162, 154], parte: 0.65 },
    { color: [238, 229, 222], parte: 0.9 },
    { color: [122, 68, 61], parte: 1 },
  ]),
  { x: 0, y: 0, width: 1, height: 1 },
  ["rosado", "crema"],
);
assert.deepEqual(medida.dominantes.map(({ color }) => color), ["rosado", "crema"]);
assert.ok(medida.dominantes[0]!.participacion > medida.dominantes[1]!.participacion);
for (const etiqueta of ["cream white", "white cream"]) {
  assert.equal(coloresNombradosReferencia({ observed_colors: [etiqueta] })[0]?.color, "crema", etiqueta);
}
const mascaraColumnaDerecha = zonaDeCroquis("columna", undefined, "lateral_derecho", 0.59).dentro;
assert.ok(mascaraColumnaDerecha(0.9, 0.5));
assert.ok(!mascaraColumnaDerecha(0.5, 0.5));
assert.equal(zonaDeCroquis("columna", undefined, "lateral_derecho", 0.4).forma, "franja vertical");

// A named cream hue is also widespread outside this element (another balloon/panel).
// The box sketch should keep local cream instead of the full-photo background filter erasing it.
const fotoConFondoCrema = new Uint8Array(100 * 100 * 3);
for (let y = 0; y < 100; y += 1) {
  for (let x = 0; x < 100; x += 1) {
    const dentro = x >= 20 && x < 80 && y >= 20 && y < 80;
    const esRosado = dentro && x < 62;
    const color = esRosado ? [198, 162, 154] : [238, 229, 222];
    const i = (y * 100 + x) * 3;
    fotoConFondoCrema[i] = color[0]!;
    fotoConFondoCrema[i + 1] = color[1]!;
    fotoConFondoCrema[i + 2] = color[2]!;
  }
}
const conservaCremaLocal = medirDominanciaElemento(
  { ancho: 100, alto: 100, rgb: fotoConFondoCrema },
  { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
  ["rosado", "crema"],
  () => true,
);
assert.deepEqual(conservaCremaLocal.dominantes.map(({ color }) => color), ["rosado", "crema"]);
const chocolateConBeige = medirDominanciaElemento(
  muestraDeFranjas([
    { color: [122, 68, 61], parte: 0.6 },
    { color: [210, 180, 140], parte: 1 },
  ]),
  { x: 0, y: 0, width: 1, height: 1 },
  ["cafe", "beige"],
);
assert.deepEqual(chocolateConBeige.dominantes.map(({ color }) => color), ["cafe", "beige"]);

const ancho = 100;
const alto = 100;
const rgb = new Uint8Array(ancho * alto * 3);
const mascaraArco = zonaDeCroquis("semiarco").dentro;
for (let y = 0; y < alto; y += 1) {
  for (let x = 0; x < ancho; x += 1) {
    const i = (y * ancho + x) * 3;
    const color = mascaraArco((x + 0.5) / ancho, (y + 0.5) / alto) ? [198, 162, 154] : [238, 229, 222];
    rgb[i] = color[0]!;
    rgb[i + 1] = color[1]!;
    rgb[i + 2] = color[2]!;
  }
}
const sinPanel = medirDominanciaElemento(
  { ancho, alto, rgb },
  { x: 0, y: 0, width: 1, height: 1 },
  ["rosado", "crema"],
  mascaraArco,
);
assert.deepEqual(sinPanel.dominantes.map(({ color }) => color), ["rosado"]);

const rosadosNombrados = codigosPorPalabras("pearl pink");
assert.ok(rosadosNombrados.includes("010"), "la lámina incluye Fashion Palo de Rosa dentro de rosa nombrado");
assert.ok(!rosadosNombrados.includes("568") && !rosadosNombrados.includes("968"), "rosa nombrado no abre Dorado Rosa");
const cruce = cruzarColor("#b47f77", { permitidas: rosadosNombrados });
assert.ok(cruce.candidatas.length > 0);
assert.ok(cruce.candidatas.every(({ codigo }) => rosadosNombrados.includes(codigo)));
assert.equal(cruce.candidatas[0]!.codigo, "010", "tono medio empolvado elige Palo de Rosa entre referencias rosas");

console.log("[PASS] píxeles solo reparten colores nombrados; rosa empolvado elige 010 y no Dorado Rosa");
