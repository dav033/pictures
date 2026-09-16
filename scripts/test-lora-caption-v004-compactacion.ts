/**
 * Regresión de la compactación del dialecto scene_v004 (eventdecor_style_v2).
 *
 * El barrido de preflight solo mide longitud y cobertura; aquí se fija la
 * gramática y el contenido de los prompts compactados:
 * - una referencia a un concepto repetido nunca queda como "with in matching"
 *   ni "a/an in matching" (pieza sin nombre);
 * - un accesorio cuyo único nombre es el producto lo conserva al compactar;
 * - una cláusula mixta se lee "of <balloons> with matching <color>";
 * - la ambientación ("set in a/an <venue>" / "set against …") solo se quita
 *   cuando ni los rótulos cortos caben con ella.
 *
 * Sin red ni llamadas pagadas. Run: npx tsx --conditions=react-server scripts/test-lora-caption-v004-compactacion.ts
 */
import assert from "node:assert/strict";
import type { SceneSpec } from "../src/lib/ia/scene-spec";
import { LORA_PROMPT_MAX_LENGTH } from "../src/lib/ia/lora-caption-compiler";
import { compileProductPrompt, type ElementSizeConfirmation } from "../src/lib/ia/lora-product-runtime";
import { preflightLoraPrompt } from "../src/lib/ia/lora-prompt-preflight";
import { buildVisualContext } from "../src/lib/ia/visual-context";
import { ensureLoraTriggers } from "../src/lib/ia/sempertex-lora";
import { PRODUCT_VOCABULARY } from "../src/lib/lora/product-vocabulary-data";

type Elemento = SceneSpec["elements"][number];
type Tipo = "arco" | "semiarco" | "guirnalda" | "columna" | "pared" | "centro_mesa" | "backdrop" | "kit" | "accesorio";
type Ubicacion = "fondo_pared" | "arco_central" | "sobre_mesa_principal" | "lateral_izquierdo" | "lateral_derecho" | "piso_frontal" | "mesas_invitados" | "entrada" | "techo";
type Rol = "focal" | "soporte" | "acento";

const TRIGGER = "eventdecor_style_v2";

// Productos reales del vocabulario v007 (los mismos del barrido).
const PRODUCTO_POR_COLOR: Readonly<Record<string, string>> = {
  dorado: "7109611258049",
  plateado: "20014244",
  rosado: "20010671",
  blanco: "7109565710529",
  fucsia: "7105908572353",
  crema: "10467043344577",
};

function elemento(id: string, nombre: string, tipo: Tipo, ubicacion: Ubicacion, rol: Rol, colores: string[], grupo?: string): Elemento {
  const productIds = colores.map((color) => PRODUCTO_POR_COLOR[color]!);
  return {
    element_id: id,
    name: nombre,
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
  } as Elemento;
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
    metadata: { created_by: "server_default", plan_hash: "plan-v004-compactacion" },
  } as SceneSpec;
}

function subpaleta(paleta: string[], desde: number, cuantos: number): string[] {
  return Array.from({ length: Math.min(cuantos, paleta.length) }, (_, i) => paleta[(desde + i) % paleta.length]!);
}

const EVENTOS = [
  { tipo_evento: "XV años", estilo: "glamour", espacio: "salón", pedido: "Quiero decorar unos XV años en un salón, estilo glamour", ambientacion: "set in an indoor event hall" },
  { tipo_evento: "boda", estilo: "elegante", espacio: "jardín", pedido: "Decoración para boda en jardín, elegante", ambientacion: "set in an outdoor garden setting" },
  { tipo_evento: "cumpleaños", estilo: "divertido", espacio: "casa", pedido: "Cumpleaños infantil en casa", ambientacion: "set in a residential event space" },
] as const;

type Evento = (typeof EVENTOS)[number];

/** Compila como /api/generate y devuelve el prompt efectivo, el paso de compactación y el preflight. */
function compilar(elementos: Elemento[], paleta: string[], evento: Evento, tamanosFocal: readonly string[] = ["R-5", "R-9", "R-12", "R-18"]) {
  const spec = escena(elementos);
  const contexto = buildVisualContext({
    brief: { tipo_evento: evento.tipo_evento, estilo: evento.estilo, colores: paleta, espacio: evento.espacio },
    userRequest: `${evento.pedido}, colores ${paleta.join(", ")}`,
  });
  const sizeConfirmations: ElementSizeConfirmation[] = elementos.flatMap((el, indice) => {
    const tamanos = indice === 0 ? tamanosFocal : ["R-12"];
    return (el.catalog_product_ids ?? []).flatMap((productId) => tamanos.map((sizeCode) => ({ elementId: el.element_id, productId, sizeCode })));
  });
  const resultado = compileProductPrompt({ sceneSpec: spec, visualContext: contexto, vocabulary: PRODUCT_VOCABULARY, sizeConfirmations, trigger: TRIGGER });
  const prompt = ensureLoraTriggers(resultado.prompt, [{ path: "v004", trigger: TRIGGER, scale: 1 }]);
  const reporte = preflightLoraPrompt({ sceneSpec: spec, clauses: resultado.clauses, prompt, triggers: [TRIGGER], vocabulary: PRODUCT_VOCABULARY });
  const pasoTexto = resultado.diagnostics.map((linea) => /render step (\d+)/.exec(linea)?.[1]).find(Boolean);
  return { prompt, paso: pasoTexto ? Number(pasoTexto) : 0, errores: reporte.errors };
}

const conAmbientacion = (prompt: string) => /\bset (?:in an? |against )/.test(prompt);

// ---------------------------------------------------------------------------
// Barrido v004: gramática de referencias y ambientación conservada.
// ---------------------------------------------------------------------------
const PALETAS: readonly string[][] = [
  ["rosado", "dorado"],
  ["blanco", "plateado"],
  ["rosado", "dorado", "plateado"],
  ["fucsia", "blanco", "dorado"],
  ["rosado", "crema", "dorado", "plateado"],
];

const columnas = (p: string[]) => [
  elemento("EST_02_COLUMNA_IZQ", "Columna izquierda", "columna", "lateral_izquierdo", "soporte", subpaleta(p, 0, 2), "cols"),
  elemento("EST_03_COLUMNA_DER", "Columna derecha", "columna", "lateral_derecho", "soporte", subpaleta(p, 0, 2), "cols"),
];
const ESCENAS: ReadonlyArray<{ nombre: string; elementos: (p: string[]) => Elemento[] }> = [
  { nombre: "arco", elementos: (p) => [elemento("EST_01_ARCO", "Arco orgánico", "arco", "arco_central", "focal", p)] },
  {
    nombre: "arco+columnas+techo+centro+accesorio",
    elementos: (p) => [
      elemento("EST_01_ARCO", "Arco orgánico", "arco", "arco_central", "focal", p),
      ...columnas(p),
      elemento("EST_04_GUIRNALDA", "Guirnalda de techo", "guirnalda", "techo", "soporte", subpaleta(p, 1, 2)),
      elemento("EST_05_CENTRO", "Centro de mesa principal", "centro_mesa", "sobre_mesa_principal", "acento", subpaleta(p, 1, 2)),
      elemento("EST_06_ACCESORIO", "Accesorio frontal", "accesorio", "piso_frontal", "acento", subpaleta(p, 0, 1)),
    ],
  },
  {
    nombre: "pared+columnas+techo+centros",
    elementos: (p) => [
      elemento("EST_01_PARED", "Pared de globos", "pared", "fondo_pared", "focal", p),
      ...columnas(p),
      elemento("EST_04_GUIRNALDA", "Guirnalda de techo", "guirnalda", "techo", "soporte", subpaleta(p, 1, 2)),
      elemento("EST_05_CENTRO", "Centro de mesa principal", "centro_mesa", "sobre_mesa_principal", "acento", subpaleta(p, 1, 2)),
      elemento("EST_06_CENTROS_INVITADOS", "Centros de mesa invitados", "centro_mesa", "mesas_invitados", "acento", subpaleta(p, 2, 1)),
    ],
  },
];

let compactadas = 0;
let accesoriosCompactados = 0;
const ULTIMO_PASO_CON_AMBIENTACION = 8;
for (const { nombre, elementos } of ESCENAS) {
  for (const paleta of PALETAS) {
    const porEvento = EVENTOS.map((evento) => ({ evento, ...compilar(elementos(paleta), paleta, evento) }));
    for (const { evento, prompt, paso, errores } of porEvento) {
      const caso = `${nombre} / ${paleta.join("+")} / ${evento.espacio} (paso ${paso})`;
      assert.deepEqual(errores, [], `${caso}: ${prompt}`);
      assert.doesNotMatch(prompt, /\bwith in matching\b/, `${caso}: referencia agramatical\n${prompt}`);
      assert.doesNotMatch(prompt, /\ban? in matching\b/, `${caso}: pieza sin nombre\n${prompt}`);
      // La ambientación solo se pierde cuando ni los rótulos cortos caben con ella.
      if (paso <= ULTIMO_PASO_CON_AMBIENTACION) assert.ok(prompt.includes(evento.ambientacion), `${caso}: sin "${evento.ambientacion}"\n${prompt}`);
      else assert.ok(!conAmbientacion(prompt) && prompt.length + evento.ambientacion.length + 2 > LORA_PROMPT_MAX_LENGTH, `${caso}: ambientación quitada sin necesidad\n${prompt}`);
      if (paso > 0) compactadas += 1;
      if (paso > 0 && nombre.includes("accesorio")) {
        accesoriosCompactados += 1;
        // El accesorio conserva un nombre (su producto o "decorative accessory") delante de su ubicación.
        assert.match(prompt, /, an? [a-z -]*\b(?:balloons?|accessory)\b[^,.]* resting on the floor in front\b/, `${caso}: accesorio sin nombre\n${prompt}`);
      }
    }
    // Distintos lugares, distintos prompts: la compactación no borra el venue.
    assert.equal(new Set(porEvento.map(({ prompt }) => prompt)).size, EVENTOS.length, `${nombre} / ${paleta.join("+")}: prompts idénticos entre lugares`);
  }
}
assert.ok(compactadas > 0, "el barrido debe ejercitar prompts compactados");
assert.ok(accesoriosCompactados > 0, "el barrido debe compactar escenas con accesorio");
console.log(`ok - barrido v004: ${compactadas} prompts compactados sin referencias agramaticales y con su ambientación`);

// ---------------------------------------------------------------------------
// Caso fijo: boda en jardín que necesita rótulos cortos conserva el lugar.
// ---------------------------------------------------------------------------
{
  const paleta = ["rosado", "crema", "dorado", "plateado"];
  const elementos = ESCENAS[1]!.elementos(paleta);
  const jardin = compilar(elementos, paleta, EVENTOS[1]);
  assert.ok(jardin.paso >= 7, `se esperaba una escena muy compactada (paso ${jardin.paso})`);
  assert.ok(jardin.prompt.includes("set in an outdoor garden setting"), jardin.prompt);
  console.log(`ok - boda en jardín compactada al paso ${jardin.paso} conserva "set in an outdoor garden setting"`);
}

// ---------------------------------------------------------------------------
// Cláusula mixta: una columna repite el rosado del arco y añade blanco.
// ---------------------------------------------------------------------------
{
  const paleta = ["rosado", "blanco"];
  const elementos = [
    elemento("EST_01_ARCO", "Arco orgánico", "arco", "arco_central", "focal", ["rosado"]),
    elemento("EST_02_COLUMNA_IZQ", "Columna izquierda", "columna", "lateral_izquierdo", "soporte", ["rosado", "blanco"], "cols"),
    elemento("EST_03_COLUMNA_DER", "Columna derecha", "columna", "lateral_derecho", "soporte", ["rosado", "blanco"], "cols"),
    elemento("EST_04_GUIRNALDA", "Guirnalda de techo", "guirnalda", "techo", "soporte", ["blanco", "rosado"]),
    elemento("EST_05_CENTRO", "Centro de mesa principal", "centro_mesa", "sobre_mesa_principal", "acento", ["rosado", "blanco"]),
    elemento("EST_06_CENTROS_INVITADOS", "Centros de mesa invitados", "centro_mesa", "mesas_invitados", "acento", ["blanco"]),
  ];
  const mixta = compilar(elementos, paleta, EVENTOS[0]);
  assert.ok(mixta.paso >= 1, `la escena debe compactarse para referenciar conceptos (paso ${mixta.paso})\n${mixta.prompt}`);
  assert.deepEqual(mixta.errores, [], mixta.prompt);
  assert.match(mixta.prompt, /\bof [a-z ]*balloons with matching [a-z]+\b/, mixta.prompt);
  console.log(`ok - cláusula mixta: "of … balloons with matching …" (paso ${mixta.paso})`);
}

// ---------------------------------------------------------------------------
// Palabras de tamaño: v004 juzgaba el tamaño a ojo y relativo a la pieza, así
// que dos diámetros distintos son "large and small" aunque ambos caigan entre
// 10" y 15". Antes una mezcla R-5 + R-12 se describía entera como "small".
// ---------------------------------------------------------------------------
{
  const arco = (colores: string[]) => [elemento("EST_01_ARCO", "Arco orgánico", "arco", "arco_central", "focal", colores)];
  const mezclaPequena = compilar(arco(["dorado"]), ["dorado"], EVENTOS[0], ["R-5", "R-12"]);
  assert.match(mezclaPequena.prompt, /large and small/, mezclaPequena.prompt);
  const mezclaGrande = compilar(arco(["dorado"]), ["dorado"], EVENTOS[0], ["R-12", "R-18"]);
  assert.match(mezclaGrande.prompt, /large and small/, mezclaGrande.prompt);
  const unSoloDiametro = compilar(arco(["dorado"]), ["dorado"], EVENTOS[0], ["R-12"]);
  assert.doesNotMatch(unSoloDiametro.prompt, /\b(?:large|small)\b/, unSoloDiametro.prompt);
  const soloPequeno = compilar(arco(["dorado"]), ["dorado"], EVENTOS[0], ["R-5"]);
  assert.match(soloPequeno.prompt, /small [a-z ]*balloons/, soloPequeno.prompt);
  assert.doesNotMatch(soloPequeno.prompt, /large and small/, soloPequeno.prompt);
  const soloGrande = compilar(arco(["dorado"]), ["dorado"], EVENTOS[0], ["R-18"]);
  assert.match(soloGrande.prompt, /large [a-z ]*balloons/, soloGrande.prompt);
  assert.doesNotMatch(soloGrande.prompt, /large and small/, soloGrande.prompt);
  console.log("ok - sceneSizeWords: dos diámetros distintos = \"large and small\"; uno solo conserva la regla absoluta");
}

console.log("LoRA caption v004 compactación: OK");
