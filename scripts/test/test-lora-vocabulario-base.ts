/**
 * Vocabulario del dialecto `base`: el caption para FLUX.2 sin LoRA (sin trigger).
 *
 * El modelo base nunca vio las captions de entrenamiento, así que el caption no puede hablar como ellas:
 * ni trigger, ni nombres de línea comercial (Reflex, Fashion, Silk, Pastel, Crystal), ni las listas entre
 * paréntesis o separadas por `;` de los dialectos entrenados. Este barrido comprueba esas invariantes sobre
 * las mismas combinaciones de escenas que `test-lora-preflight-barrido.ts`, más el respaldo por título de
 * catálogo para productos que el vocabulario no tiene y la cobertura de todo el vocabulario.
 *
 * Sin red ni proveedores. Run: npm run lora:test-vocabulario-base
 */
import assert from "node:assert/strict";
import type { SceneSpec } from "../../src/lib/ia/escena/scene-spec";
import { buildVisualContext } from "../../src/lib/ia/escena/visual-context";
import { BASE_PROMPT_MAX_LENGTH, captionDialectForTrigger, translateLoraColor } from "../../src/lib/ia/kagutsuchi/lora-caption-compiler";
import { compileProductPrompt, type ElementSizeConfirmation } from "../../src/lib/ia/kagutsuchi/lora-product-runtime";
import { preflightLoraPrompt } from "../../src/lib/ia/kagutsuchi/lora-prompt-preflight";
import { assertDescriptorPerceptualSeguro } from "../../src/lib/lora/descriptor-perceptual";
import { PRODUCT_VOCABULARY } from "../../src/lib/lora/product-vocabulary-data";
import { acabadoVisible, fraseTallasBase, leerTituloCatalogo, terminosBaseDeConcepto } from "../../src/lib/lora/vocabulario-base";

type Elemento = SceneSpec["elements"][number];

function pass(nombre: string): void {
  console.log(`ok - ${nombre}`);
}

// Productos reales del vocabulario (los de test-lora-preflight-barrido.ts). Dorado y plateado son Reflex
// (cromados), el resto Fashion/Silk.
const PRODUCTO_POR_COLOR: Readonly<Record<string, string>> = {
  dorado: "7109611258049",
  plateado: "20014244",
  rosado: "20010671",
  blanco: "7109565710529",
  fucsia: "7105908572353",
  crema: "10467043344577",
};

// En base el vocabulario no decide nada (2026-10-06): cada producto se describe desde su título de catálogo.
const TITULO_POR_PRODUCTO: ReadonlyMap<string, string> = new Map([
  [PRODUCTO_POR_COLOR.dorado!, "B2b Globo Latex Redondo Reflex Dorado"],
  [PRODUCTO_POR_COLOR.plateado!, "B2b Globo Latex Redondo Reflex Plata"],
  [PRODUCTO_POR_COLOR.rosado!, "B2b Globo Latex Redondo Fashion Rosado"],
  [PRODUCTO_POR_COLOR.blanco!, "B2b Globo Latex Redondo Fashion Blanco"],
  [PRODUCTO_POR_COLOR.fucsia!, "B2b Globo Latex Redondo Fashion Fucsia"],
  [PRODUCTO_POR_COLOR.crema!, "B2b Globo Latex Redondo Silk Crema"],
]);

function elemento(id: string, tipo: string, ubicacion: string, rol: string, colores: string[], grupo?: string, productIds = colores.map((color) => PRODUCTO_POR_COLOR[color]!)): Elemento {
  return {
    element_id: id,
    name: id,
    category: tipo === "backdrop" ? "backdrop" : "balloon_structure",
    source_type: "catalog_backed",
    catalog_product_id: productIds[0],
    catalog_product_ids: productIds,
    required: true,
    quantity: { mode: "exact", min: 1, max: 1 },
    target_bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.7 },
    depth_layer: 10,
    resolved_colors: colores,
    visual_semantics: { structure_type: tipo, placement: ubicacion, design_role: rol, repetition_group: grupo ?? id, density: "media" },
    identity_constraints: [],
    relationships: [],
  } as unknown as Elemento;
}

function escena(elementos: Elemento[]): SceneSpec {
  return {
    schema_version: "1.0",
    generation_mode: "text_to_image",
    canvas: { aspect_ratio: "3:2", content_rect: { x: 0, y: 0, width: 1, height: 1 } },
    venue: { preserve: [], protected_regions: [], editable_regions: [] },
    elements: elementos,
    positive_prompt: { required_elements: [], composition: [], venue_preservation: [], photorealistic_integration: [] },
    negative_prompt: { forbidden_elements: [], forbidden_venue_changes: [], forbidden_compositing_artifacts: [] },
    metadata: { created_by: "server_default", plan_hash: "plan-vocabulario-base" },
  } as unknown as SceneSpec;
}

const PALETAS = [["dorado"], ["rosado", "dorado"], ["blanco", "plateado"], ["rosado", "dorado", "plateado"], ["fucsia", "blanco", "dorado"], ["rosado", "crema", "dorado", "plateado"]];
const EVENTOS = [
  { tipo_evento: "XV años", estilo: "glamour", espacio: "salón", pedido: "XV años en un salón, estilo glamour" },
  { tipo_evento: "boda", estilo: "elegante", espacio: "jardín", pedido: "Boda en jardín, elegante" },
  { tipo_evento: "cumpleaños", estilo: "divertido", espacio: "casa", pedido: "Cumpleaños infantil en casa" },
];
const sub = (paleta: string[], desde: number, cuantos: number) => Array.from({ length: Math.min(cuantos, paleta.length) }, (_, i) => paleta[(desde + i) % paleta.length]!);
const FOCALES = [
  (p: string[]) => [elemento("E1_ARCO", "arco", "arco_central", "focal", p)],
  (p: string[]) => [elemento("E1_SEMIARCO", "semiarco", "fondo_pared", "focal", p)],
  (p: string[]) => [elemento("E1_PARED", "pared", "fondo_pared", "focal", p)],
  (p: string[]) => [elemento("E1_GUIRNALDA", "guirnalda", "fondo_pared", "focal", p)],
  (p: string[]) => [elemento("E1_BACKDROP", "backdrop", "fondo_pared", "focal", p)],
];
const SOPORTES = [
  () => [],
  (p: string[]) => [elemento("E2_COL_IZQ", "columna", "lateral_izquierdo", "soporte", sub(p, 0, 2), "cols"), elemento("E3_COL_DER", "columna", "lateral_derecho", "soporte", sub(p, 0, 2), "cols")],
  (p: string[]) => [elemento("E2_TECHO", "guirnalda", "techo", "soporte", sub(p, 1, 2))],
];
const ACENTOS = [
  () => [],
  (p: string[]) => [elemento("E5_CENTRO", "centro_mesa", "sobre_mesa_principal", "acento", sub(p, 1, 2))],
  (p: string[]) => [elemento("E6_CENTROS", "centro_mesa", "mesas_invitados", "acento", sub(p, 2, 1)), elemento("E7_ACCESORIO", "accesorio", "piso_frontal", "acento", sub(p, 0, 1))],
];
const TAMANOS = ["R-5", "R-9", "R-12", "R-18"];

/** Paso de compactación desde el que el caption deja de decir el acabado (`shortLabels`). */
const PASO_SIN_ACABADO = 8;

function compilar(elementos: Elemento[], paleta: string[], evento: (typeof EVENTOS)[number], titulos: ReadonlyMap<string, string> = TITULO_POR_PRODUCTO) {
  const spec = escena(elementos);
  const contexto = buildVisualContext({
    brief: { tipo_evento: evento.tipo_evento, estilo: evento.estilo, colores: paleta, espacio: evento.espacio },
    userRequest: `${evento.pedido}, colores ${paleta.join(", ")}`,
  });
  const sizeConfirmations: ElementSizeConfirmation[] = elementos.flatMap((el, indice) =>
    (el.catalog_product_ids ?? []).flatMap((productId) => (indice === 0 ? TAMANOS : ["R-12"]).map((sizeCode) => ({ elementId: el.element_id, productId, sizeCode }))));
  const resultado = compileProductPrompt({ sceneSpec: spec, visualContext: contexto, vocabulary: PRODUCT_VOCABULARY, sizeConfirmations, productCatalogTitles: titulos, trigger: undefined });
  return { spec, resultado, contexto, sizeConfirmations };
}

// ---------------------------------------------------------------------------
// Contrato con el modo base: sin trigger se compila el dialecto `base`; los entrenados no cambian.
// ---------------------------------------------------------------------------
assert.equal(captionDialectForTrigger(undefined), "base");
assert.equal(captionDialectForTrigger("  "), "base");
assert.equal(captionDialectForTrigger("eventdecor_style_v2"), "scene_v004");
assert.equal(captionDialectForTrigger("eventdecor_style_v3"), "product_v007");
pass("sin trigger → dialecto base; v2 → scene_v004; v3 → product_v007");

// ---------------------------------------------------------------------------
// Barrido de escenas sin trigger.
// ---------------------------------------------------------------------------
const COMERCIALES = /\b(?:Reflex|Fashion|Silk|Pastel|Crystal)\b|®|Link-O-Loon/i;
let total = 0;
let maxLongitud = 0;
for (const focal of FOCALES) for (const soporte of SOPORTES) for (const acento of ACENTOS) for (const paleta of PALETAS) for (const evento of EVENTOS) {
  const elementos = [...focal(paleta), ...soporte(paleta), ...acento(paleta)];
  const { spec, resultado } = compilar(elementos, paleta, evento);
  const prompt = resultado.prompt;
  const caso = `${elementos.map((el) => el.element_id).join("+")} ${paleta.join("/")} ${evento.tipo_evento}: ${prompt}`;
  total += 1;
  maxLongitud = Math.max(maxLongitud, prompt.length);

  assert.doesNotMatch(prompt, /eventdecor_/i, `trigger en el prompt base: ${caso}`);
  assert.doesNotMatch(prompt, COMERCIALES, `nombre comercial en el prompt base: ${caso}`);
  assert.doesNotMatch(prompt, /[();]/, `paréntesis o punto y coma en el prompt base: ${caso}`);
  assert.ok(prompt.length <= BASE_PROMPT_MAX_LENGTH, `longitud ${prompt.length}: ${caso}`);
  assert.equal(resultado.unresolved_products.length, 0, caso);

  for (const color of new Set(paleta.map(translateLoraColor))) {
    assert.match(prompt.toLowerCase(), new RegExp(`\\b${color}\\b`), `color ${color} ausente: ${caso}`);
  }

  // El acabado que distingue un cromado o un metalizado se dice mientras el caption no lo haya compactado.
  const paso = Number(resultado.diagnostics.join(" ").match(/render step (\d+)/)?.[1] ?? 0);
  if (paso < PASO_SIN_ACABADO) {
    const acabados = resultado.clauses.flatMap((clause) => clause.canonicalEntries ?? [])
      .flatMap((entry) => entry.baseTerms?.kind === "balloon" && /chrome|metallic/.test(entry.baseTerms.finish) ? [entry.baseTerms.finish] : []);
    for (const acabado of new Set(acabados)) assert.ok(prompt.includes(acabado), `acabado «${acabado}» ausente: ${caso}`);
    if (paleta.includes("dorado")) assert.match(prompt, /mirror-like chrome gold/, `el dorado Reflex debe verse cromado: ${caso}`);
  }

  const reporte = preflightLoraPrompt({ sceneSpec: spec, clauses: resultado.clauses, prompt, vocabulary: PRODUCT_VOCABULARY, dialect: "base" });
  assert.equal(reporte.ok, true, `${reporte.errors.join("; ")} — ${caso}`);
  assert.equal(reporte.triggerCount, 0);

  const otraVez = compilar(elementos, paleta, evento).resultado.prompt;
  assert.equal(otraVez, prompt, `salida no determinista: ${caso}`);
}
assert.equal(total, FOCALES.length * SOPORTES.length * ACENTOS.length * PALETAS.length * EVENTOS.length);
pass(`barrido base: ${total} escenas sin trigger, sin nombres comerciales, sin «(» ni «;», con cada color y su acabado, preflight ok; longitud máxima ${maxLongitud}/${BASE_PROMPT_MAX_LENGTH}`);

// ---------------------------------------------------------------------------
// Un producto que el vocabulario no tiene se describe con su título de catálogo, no se pierde.
// ---------------------------------------------------------------------------
{
  const titulos = new Map([
    ["SIN-VOCAB-SILK-FUCSIA", "B2b Globo Latex Redondo Silk Fucsia"],
    ["SIN-VOCAB-CORAZON-PLATA", "Globo Latex Corazon Reflex Plateado"],
  ]);
  const elementos = [
    elemento("E1_ARCO", "arco", "arco_central", "focal", ["fucsia", "plateado"], undefined, ["SIN-VOCAB-SILK-FUCSIA", "SIN-VOCAB-CORAZON-PLATA"]),
  ];
  const { spec, resultado } = compilar(elementos, ["fucsia", "plateado"], EVENTOS[0]!, titulos);
  assert.equal(resultado.unresolved_products.length, 0, JSON.stringify(resultado.unresolved_products));
  assert.match(resultado.prompt, /satin pearlescent fuchsia latex balloons/, resultado.prompt);
  assert.match(resultado.prompt, /mirror-like chrome silver heart-shaped latex balloons/, resultado.prompt);
  assert.match(resultado.prompt, /small 5-inch/, resultado.prompt);
  assert.doesNotMatch(resultado.prompt, COMERCIALES, resultado.prompt);
  // Describir desde el catálogo es el camino normal de base: ningún producto queda fuera.
  assert.ok(!resultado.diagnostics.some((linea) => linea.includes("left out of the caption")), resultado.diagnostics.join(" | "));
  // En base el vocabulario no decide (2026-10-06): un producto descrito desde el catálogo ya no es legacy.
  assert.equal(resultado.legacy, false);
  assert.equal(preflightLoraPrompt({ sceneSpec: spec, clauses: resultado.clauses, prompt: resultado.prompt, dialect: "base" }).ok, true);

  // Los dialectos entrenados siguen sin conocer ese producto: su LoRA no lo vio.
  const v007 = compileProductPrompt({ sceneSpec: spec, visualContext: buildVisualContext({ userRequest: "arco" }), vocabulary: PRODUCT_VOCABULARY, productCatalogTitles: titulos, trigger: "eventdecor_style_v3" });
  assert.equal(v007.unresolved_products.length, 2);
  pass("producto fuera del vocabulario: base lo describe por su título de catálogo; v007 lo sigue dejando sin resolver");
}

// ---------------------------------------------------------------------------
// Cobertura: todo concepto activo del vocabulario tiene términos base limpios.
// ---------------------------------------------------------------------------
{
  let globos = 0;
  for (const concepto of PRODUCT_VOCABULARY.filter((candidate) => candidate.status === "active")) {
    const terminos = terminosBaseDeConcepto(concepto);
    const texto = terminos.kind === "balloon" ? [terminos.finish, terminos.color, terminos.noun].filter(Boolean).join(" ") : terminos.label;
    assert.ok(texto.trim(), concepto.concept_id);
    assert.doesNotMatch(texto, COMERCIALES, `${concepto.concept_id}: ${texto}`);
    assert.doesNotMatch(texto, /[();]/, `${concepto.concept_id}: ${texto}`);
    assertDescriptorPerceptualSeguro(texto);
    if (terminos.kind === "balloon") {
      globos += 1;
      if (/reflex|chrome/i.test(concepto.visual.finish)) assert.equal(terminos.finish, "mirror-like chrome", concepto.concept_id);
    }
  }
  assert.ok(globos > 100, `globos descritos por partes: ${globos}`);
  pass(`vocabulario completo: cada concepto activo tiene términos base sin nombres comerciales (${globos} globos por partes)`);
}

// ---------------------------------------------------------------------------
// Tablas de palabras.
// ---------------------------------------------------------------------------
assert.equal(acabadoVisible("Reflex high-shine"), "mirror-like chrome");
assert.equal(acabadoVisible("reflex"), "mirror-like chrome");
assert.equal(acabadoVisible("solid Fashion"), "matte");
assert.equal(acabadoVisible("Silk satin"), "satin pearlescent");
assert.equal(acabadoVisible("Pastel Dusk"), "muted dusty matte");
assert.equal(acabadoVisible("Pastel Matte"), "soft matte");
assert.equal(acabadoVisible("Neon fluorescent"), "fluorescent");
assert.equal(acabadoVisible("metallized foil"), "shiny metallic foil");
assert.equal(acabadoVisible("metalizado"), "satin metallic"); // `ACABADO_EN`: el acabado metalizado del plan es látex metálico, no foil
assert.equal(acabadoVisible("metal"), "satin metallic");
assert.equal(acabadoVisible("mixed matte and glossy chrome finishes"), "mixed matte and mirror-like chrome");
assert.equal(acabadoVisible("nada conocido"), "");
assert.equal(fraseTallasBase(["5-inch", "12-inch", "18-inch"], "all"), "mixed small 5-inch, medium 12-inch and large 18-inch");
assert.equal(fraseTallasBase(["5-inch", "9-inch", "12-inch", "18-inch"], "range"), "mixed small 5-inch to large 18-inch");
assert.equal(fraseTallasBase(["36-inch"], "all"), "giant 36-inch");
assert.equal(fraseTallasBase(["12-inch"], "none"), "");
assert.equal(leerTituloCatalogo("Mural Metalizado Cuadros Dorados"), undefined);
assert.deepEqual(leerTituloCatalogo("B2b Globo Latex Redondo Fashion Blanco"), { forma: "round", material: "latex", acabado: "matte", restoColor: "blanco" });
pass("tablas: acabado visible, tallas con escala relativa y lectura de títulos del catálogo");

// ---------------------------------------------------------------------------
// El preflight base rechaza lo que solo entiende un LoRA, y no relaja los dialectos entrenados.
// ---------------------------------------------------------------------------
{
  const { spec, resultado } = compilar([elemento("E1_ARCO", "arco", "arco_central", "focal", ["dorado"])], ["dorado"], EVENTOS[0]!);
  const base = (prompt: string) => preflightLoraPrompt({ sceneSpec: spec, clauses: resultado.clauses, prompt, dialect: "base" });
  assert.equal(base(resultado.prompt).ok, true);
  assert.equal(base(`eventdecor_style_v3, ${resultado.prompt}`).ok, false);
  assert.equal(base(resultado.prompt.replace("mirror-like chrome", "Reflex")).ok, false);
  assert.equal(base(resultado.prompt.replace(/gold/g, "yellow")).ok, false);
  // El mismo prompt, sin trigger, sigue fallando en un dialecto entrenado.
  assert.equal(preflightLoraPrompt({ sceneSpec: spec, clauses: resultado.clauses, prompt: resultado.prompt, triggers: ["eventdecor_style_v3"] }).ok, false);
  pass("preflight base: trigger, nombre comercial o color ausente fallan; los dialectos entrenados siguen exigiendo su trigger");
}

console.log("LoRA vocabulario base: OK");
