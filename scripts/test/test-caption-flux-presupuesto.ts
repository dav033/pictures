/**
 * El caption FLUX cabe siempre en su límite sin perder lo que el dueño pidió (verificador 127, 2026-10-07).
 *
 * En producción la foto de ejemplo 06 se quedó sin imagen en las dos vistas: `FLUX_PREFLIGHT_FAILED: longitud 1540
 * supera límite 1000`, AUN en el paso más compacto. Tres piezas del motor orgánico (semiarco, columna y guirnalda)
 * con sus frases de forma de Python (~600 caracteres), el hex pegado a CADA mención de cada color (9 menciones de 3
 * colores), «with matching …» repitiendo los colores que la columna ya nombraba, la escenografía de la foto y la
 * forma propia de la columna orgánica.
 *
 * El arreglo (caption-flux.ts, pasos de presupuesto; solo si nada de lo de antes cabe): un hex por color distinto
 * (en su primera mención), «matching» solo con colores nuevos, sin escenografía, sin la forma propia de la columna
 * y, al final, la frase de FORMA del motor orgánico por fragmentos enteros del final hacia el principio. Nunca se
 * corta a ciegas ni se toca un patrón de color o un armado de bouquet o de guirnalda.
 *
 * Entrada de ej06: `fixtures/caption-flux-ejemplo-06.json`, lo que /api/generate le pasó a `compileProductPrompt`,
 * rehecho sin red con `scripts/lib/caption-de-cuerpo-generate.ts` desde el cuerpo guardado del banco. Sin coste:
 *
 *   npx tsx --conditions=react-server scripts/test/test-caption-flux-presupuesto.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SceneSpec } from "../../src/lib/ia/escena/scene-spec";
import type { VisualContext } from "../../src/lib/ia/escena/visual-context";
import { BASE_PROMPT_MAX_LENGTH } from "../../src/lib/ia/kagutsuchi/caption-flux";
import { compileProductPrompt, type ElementSizeConfirmation } from "../../src/lib/ia/kagutsuchi/producto-flux";
import { preflightFluxPrompt } from "../../src/lib/ia/kagutsuchi/preflight-flux";
import type { FraseDeEstructura } from "../../src/lib/ia/uzume/mezcla-color-escena";

type Fixture = {
  sceneSpec: SceneSpec;
  visualContext: VisualContext;
  sizeConfirmations: ElementSizeConfirmation[];
  productIdAliases: Array<[string, string[]]>;
  productCatalogTitles: Array<[string, string]>;
  ambientDecor: string[];
  creativeCues: string[];
  officialStructures: Array<[string, string]>;
  colorPatterns: FraseDeEstructura[];
};

const EJ06 = JSON.parse(readFileSync(path.join(process.cwd(), "scripts", "test", "fixtures", "caption-flux-ejemplo-06.json"), "utf8")) as Fixture;

function compilar(entrada: Fixture) {
  const compilacion = compileProductPrompt({
    sceneSpec: entrada.sceneSpec,
    visualContext: entrada.visualContext,
    sizeConfirmations: entrada.sizeConfirmations,
    productIdAliases: new Map(entrada.productIdAliases),
    productCatalogTitles: new Map(entrada.productCatalogTitles),
    ambientDecor: entrada.ambientDecor,
    creativeCues: entrada.creativeCues,
    officialStructures: new Map(entrada.officialStructures),
    colorPatterns: entrada.colorPatterns,
  });
  return { compilacion, preflight: preflightFluxPrompt({ sceneSpec: entrada.sceneSpec, clauses: compilacion.clauses, prompt: compilacion.prompt }) };
}

const HEX = /\(#([0-9A-F]{6})\)/gi;
function hexDe(texto: string): string[] {
  return [...texto.matchAll(HEX)].map((coincidencia) => coincidencia[1]!.toUpperCase());
}

/** Lo que el caption no puede perder: cada color con su hex una vez, cada pieza, los patrones y armados enteros. */
function comprobarSinPerdidas(nombre: string, entrada: Fixture, coloresConHex: readonly string[]): string {
  const { compilacion, preflight } = compilar(entrada);
  const texto = compilacion.prompt;
  console.log(`  ${nombre}: ${texto.length} caracteres (${compilacion.diagnostics.find((linea) => linea.startsWith("caption compactado")) ?? "sin compactar"})`);
  assert.ok(texto.length <= BASE_PROMPT_MAX_LENGTH, `${nombre}: cabe en ${BASE_PROMPT_MAX_LENGTH} (mide ${texto.length})\n${texto}`);
  assert.equal(preflight.ok, true, `${nombre}: el preflight lo acepta: ${preflight.errors.join("; ")}`);
  const hexes = hexDe(texto);
  for (const hex of coloresConHex) assert.equal(hexes.filter((valor) => valor === hex).length, 1, `${nombre}: #${hex} pegado a su color una vez\n${texto}`);
  assert.equal(new Set(hexes).size, hexes.length, `${nombre}: ningún hex repetido`);
  assert.doesNotMatch(texto, /,\s*\(#|#[0-9A-F]{6}(?!\))/i, `${nombre}: ningún hex suelto`);
  assert.equal(preflight.structures.represented, preflight.structures.expected, `${nombre}: todas las piezas`);
  assert.equal(preflight.colors.represented, preflight.colors.expected, `${nombre}: todos los colores`);
  for (const clausula of compilacion.clauses) {
    if (!clausula.colorPattern) continue;
    if (clausula.fraseDeForma) {
      // La de forma, por fragmentos enteros desde el principio (o ninguno): nunca un fragmento a medias.
      const fragmentos = clausula.colorPattern.split(/,\s+/);
      const enteros = fragmentos.filter((_, indice) => texto.includes(fragmentos.slice(0, indice + 1).join(", "))).length;
      if (enteros < fragmentos.length) assert.ok(!texto.includes(`${fragmentos.slice(0, enteros).join(", ")}, ${fragmentos[enteros]!.slice(0, 6)}`), `${nombre}: ${clausula.elementIds.join("+")} sin fragmento cortado`);
    } else {
      assert.ok(texto.includes(clausula.colorPattern), `${nombre}: el patrón o armado de ${clausula.elementIds.join("+")} va entero`);
    }
  }
  return texto;
}

// ── 1. La foto 06 del banco: antes 1540, ahora cabe ──────────────────────────────────────────────────────────────
const texto06 = comprobarSinPerdidas("ej06", EJ06, ["F2B6C8", "01B2E8", "FFFFFF"]);
assert.match(texto06, /light pink \(#F2B6C8\)/);
assert.match(texto06, /vivid cyan blue \(#01B2E8\)/);
assert.match(texto06, /white \(#FFFFFF\)/);
assert.match(texto06, /standing on the floor on its left leg, climbing and finishing free in the air on the right/, "el semiarco conserva cómo se apoya y hacia dónde sube");
assert.match(texto06, /widest at the base and tapering toward the top/, "la columna conserva su forma");
assert.doesNotMatch(texto06, /with matching light pink/, "sin repetir los colores que la columna ya nombra");
// Lo que se quita es lo que menos importa y SOLO porque no cabía: con más presupuesto vuelve.
const holgado = compileProductPrompt({
  sceneSpec: EJ06.sceneSpec, visualContext: EJ06.visualContext, sizeConfirmations: EJ06.sizeConfirmations,
  productIdAliases: new Map(EJ06.productIdAliases), productCatalogTitles: new Map(EJ06.productCatalogTitles),
  ambientDecor: EJ06.ambientDecor, creativeCues: EJ06.creativeCues, officialStructures: new Map(EJ06.officialStructures),
  colorPatterns: EJ06.colorPatterns, maxLength: 2000,
});
assert.ok(holgado.prompt.length > BASE_PROMPT_MAX_LENGTH, "con 2000 de presupuesto el caption sale entero (como antes)");
for (const frase of EJ06.colorPatterns.filter((item) => item.aplicado)) {
  if (EJ06.colorPatterns.find((item) => item.aplicado && item.estructura_id === frase.estructura_id) !== frase) continue;
  assert.ok(holgado.prompt.includes(frase.prompt_lora.trim()), `con presupuesto, la frase de ${frase.estructura_id} va entera`);
}
assert.match(holgado.prompt, /styled with /, "y la escenografía vuelve");
assert.equal(hexDe(holgado.prompt).length > 3, true, "y el hex en cada mención (los captions que caben no cambian)");

// ── 2. Un plan de muchos colores: tres piezas del motor orgánico, ocho colores distintos ─────────────────────────
const COLORES: ReadonlyArray<{ color: string; titulo: string; hex: string }> = [
  { color: "rosado", titulo: "Fashion Rosado", hex: "F2B6C8" },
  { color: "azul", titulo: "Fashion Azul", hex: "01B2E8" },
  { color: "blanco", titulo: "Satin Blanco", hex: "F7F7F5" },
  { color: "verde", titulo: "Fashion Verde Lima", hex: "8AC85B" },
  { color: "amarillo", titulo: "Fashion Amarillo", hex: "F6E702" },
  { color: "lila", titulo: "Fashion Lila", hex: "B698C1" },
  { color: "naranja", titulo: "Fashion Naranja", hex: "E75D1D" },
  { color: "fucsia", titulo: "Fashion Fucsia", hex: "E44A80" },
];
const TALLAS = [5, 9, 12, 18] as const;
const PALETAS: Readonly<Record<string, readonly number[]>> = {
  EST_01_SEMIARCO: [0, 1, 2, 3, 4],
  EST_02_COLUMNA: [5, 6, 7, 0, 1],
  EST_03_GUIRNALDA: [2, 3, 4, 5, 6],
};
const titulos: Array<[string, string]> = [];
const confirmaciones: ElementSizeConfirmation[] = [];
const elementos = EJ06.sceneSpec.elements.map((elemento) => {
  const paleta = PALETAS[elemento.element_id] ?? [0, 1, 2];
  const ids = paleta.flatMap((indice, orden) => TALLAS.map((talla) => {
    const id = `MC-${COLORES[indice]!.color}-${talla}`;
    if (!titulos.some(([existente]) => existente === id)) titulos.push([id, `B2b Globo Latex Redondo ${COLORES[indice]!.titulo}`]);
    confirmaciones.push({ elementId: elemento.element_id, productId: id, sizeCode: `R-${talla}`, diameterInches: talla, units: 12 - orden * 2 });
    return id;
  }));
  return { ...elemento, catalog_product_id: ids[0], catalog_product_ids: ids, resolved_colors: paleta.map((indice) => COLORES[indice]!.color), resolved_finishes: ["fashion"] };
});
const muchos: Fixture = { ...EJ06, sceneSpec: { ...EJ06.sceneSpec, elements: elementos }, sizeConfirmations: confirmaciones, productCatalogTitles: titulos, productIdAliases: [] };
comprobarSinPerdidas("muchos colores", muchos, COLORES.map((item) => item.hex));

console.log("OK test-caption-flux-presupuesto: ej06 y un plan de ocho colores caben en 1000 con cada hex una vez, sus piezas y sus patrones");
