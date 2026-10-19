import assert from "node:assert/strict";
import { medirDominanciaElemento, type MuestraPixeles } from "../../src/lib/plan/dominancia-color";
import { zonaDeCroquis } from "../../src/lib/plan/croquis-zona";
import { coloresDominantesReferencia, coloresNombradosReferencia, coloresObservadosElemento } from "../../src/lib/plan/colores-referencia";
import { codigosPorPalabras, cruzarColor, referenciaPorCodigo } from "../../src/lib/plan/referencia-sempertex";

// Los tonos salmón de una foto deben cruzar a Coral Tropical, no a Naranja Cobrizo.
assert.equal(referenciaPorCodigo("059")?.hexGlobo.toLowerCase(), "#f58a84");
for (const hex of ["#e97f79", "#ee938f"]) {
  assert.equal(cruzarColor(hex).candidatas[0]?.codigo, "059", `${hex} debe cruzar a Coral Tropical`);
  assert.equal(
    cruzarColor(hex, { nombradas: ["062"] }).candidatas[0]?.codigo,
    "059",
    `${hex}: una etiqueta 062 que discrepa no debe desplazar los píxeles de coral`,
  );
}

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
for (const etiqueta of ["cream", "ivory", "off white", "off-white", "cream white", "white cream"]) {
  assert.equal(coloresNombradosReferencia({ observed_colors: [etiqueta] })[0]?.color, "crema", etiqueta);
}
assert.deepEqual(coloresDominantesReferencia(["clear pink"]), ["rosado", "transparente"], "el tono de Cristal conserva acabado transparente");
assert.deepEqual(coloresDominantesReferencia(["clear gold confetti"]), ["transparente"], "el oro del confeti no se compra como látex");
assert.deepEqual(coloresDominantesReferencia(["gold confetti balloons"]), ["dorado"], "confeti estampado no oculta color del globo opaco");
assert.deepEqual(coloresDominantesReferencia(["transparent with gold confetti"]), ["transparente"], "color del confeti se descarta con evidencia de transparencia");
assert.deepEqual(coloresDominantesReferencia(["see-through with gold confetti"]), ["transparente"], "see-through identifica relleno transparente");
for (const [etiqueta, codigo, caso] of [["navy blue", "044", "F7-5"], ["chrome gold", "970", "001"]] as const) {
  const codigos = codigosPorPalabras(etiqueta);
  const referencia = referenciaPorCodigo(codigo);
  assert.ok(codigos.includes(codigo), `${caso}: ${etiqueta} incluye ${codigo}`);
  assert.ok(referencia, `${caso}: existe referencia ${codigo}`);
  assert.equal(cruzarColor(referencia.hexGlobo, { permitidas: codigos, nombradas: codigos }).candidatas[0]?.codigo, codigo, `${caso}: el color medido confirma ${codigo}`);
}
assert.deepEqual(codigosPorPalabras("clear gold confetti"), [], "F7-5: el oro del confeti transparente no abre código de globo");
for (const etiqueta of ["cream", "crema", "ivory", "off white", "off-white", "white cream", "cream white"]) {
  const codigos = codigosPorPalabras(etiqueta);
  assert.ok(codigos.includes("107"), `${etiqueta} conserva Sempertex Crema 107`);
  assert.equal(cruzarColor("#ede3dc", { permitidas: codigos, nombradas: codigos }).candidatas[0]?.codigo, "107", `${etiqueta} devuelve referencia medida`);
}

// CASE-002 archivado v6: región corregida con balance de blancos clasificó 13,27 % como blanco;
// «matte light grey» solo se conserva como blanco con esa evidencia de alta claridad y bajo croma.
const case002Archivado = {
  observed_colors: ["pearl pink", "chrome silver", "matte light grey", "clear"],
  measured_colors: [
    { color: "plateado", share: 0.6454 },
    { color: "crema", share: 0.1524 },
    { color: "blanco", share: 0.1327 },
    { color: "rosado", share: 0.0695 },
  ],
};
const coloresCase002 = coloresDominantesReferencia(case002Archivado);
assert.ok(coloresCase002.includes("blanco"), `CASE-002 incluye blanco: ${coloresCase002}`);
assert.ok(!coloresCase002.includes("gris"), `CASE-002 no habilita gris: ${coloresCase002}`);
assert.deepEqual(
  coloresDominantesReferencia({ observed_colors: ["matte dark grey"], measured_colors: [{ color: "gris", share: 0.78 }, { color: "rosado", share: 0.22 }] }),
  ["gris"],
  "gris real medido se respeta",
);
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

// CASE-002 en vivo: el analizador nombró rosa, plata y blanco; la iluminación
// lila midió algunos píxeles blancos como gris/lila. La medición puede ordenar
// los nombres, pero jamás abrir compra para tonos que el analizador no nombró.
const aparienciaCase002 = {
  observed_colors: ["pearl pink", "chrome silver", "white", "clear"],
  measured_colors: [
    { color: "gris", share: 0.48 },
    { color: "lila", share: 0.32 },
    { color: "rosado", share: 0.12 },
    { color: "plateado", share: 0.08 },
  ],
};
assert.deepEqual(
  coloresDominantesReferencia(aparienciaCase002).sort(),
  ["blanco", "plateado", "rosado", "transparente"].sort(),
  "CASE-002 conserva blanco nombrado y no compra gris/lila medidos por la luz",
);
assert.deepEqual(
  coloresObservadosElemento(aparienciaCase002).sort(),
  ["blanco", "plateado", "rosado", "transparente"].sort(),
  "un tono medido pero no nombrado no habilita material",
);

console.log("[PASS] CASE-002 compra blanco, plata, rosa y transparente; gris/lila no nombrados quedan fuera");
