import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import { planBlueprint } from "@/lib/plan/blueprint";
import { planResueltoDesdePython } from "@/lib/plan/python-mapper";
import { cajasDeEstructuras } from "@/lib/plan/ubicaciones";
import { PatronColorResueltoSchema, type PatronColorResuelto } from "@/lib/plan/patron-color";
import { ArmadoBouquetResueltoSchema, type ArmadoBouquetResuelto } from "@/lib/plan/armado-bouquet";
import { frasesDeEstructuras } from "@/lib/ia/uzume/mezcla-color-escena";
import { buildApprovedSceneSpec, type SceneSpec } from "@/lib/ia/escena/scene-spec";
import { bloqueMezclaPorEstructura } from "@/lib/ia/escena/tamano-fisico";
import { buildVisualContext } from "@/lib/ia/escena/visual-context";
import { buildImagePrompt, placementDescription, promptElementName, tieneContratoDeColor } from "@/lib/ia/uzume/build-image-prompt";
import { GEMINI_COMPOSITION_HARD_LOCK, hardLockComposicionGemini } from "@/lib/ia/uzume/lora-gemini-composition";
import { compileLoraCaption, LORA_JSON_PROMPT_MAX_LENGTH, LORA_PROMPT_MAX_LENGTH, translateLoraColor, type LoraVisualClause } from "@/lib/ia/kagutsuchi/lora-caption-compiler";
import { compileProductPrompt, type ElementSizeConfirmation } from "@/lib/ia/kagutsuchi/lora-product-runtime";
import { findLoraPromptLanguageLeaks, preflightLoraPrompt } from "@/lib/ia/kagutsuchi/lora-prompt-preflight";
import { ensureLoraTriggers } from "@/lib/ia/kagutsuchi/sempertex-lora";
import { PRODUCT_VOCABULARY } from "@/lib/lora/product-vocabulary-data";
import { verificarCoherenciaPrompt, verificarColoresCaptionLora, type EscenaParaCoherencia } from "@/lib/plan/coherencia";
import { planFijado, type PlanFijadoDeFixture } from "../lib/planes-fijados";
import { loadVectors } from "../lib/vectores-golden";

/**
 * Adaptador temporal del patrón de color en los prompts de imagen (ADR-0028 §12).
 *
 * TypeScript no redacta, no expande y no cuenta patrones: inserta tal cual las
 * frases `prompt_gemini` / `prompt_lora` que Python escribe en
 * `plan_resuelto.patrones_color`. Lo que fija este test:
 *
 * - sin patrón (sin `patrones_color`, con una lista vacía, con el modo
 *   aleatorio —frases vacías— o con sugerencias `aplicado: false`) cada prompt
 *   es byte a byte el de antes del adaptador. La referencia es
 *   `scripts/fixtures/patron-color-prompt/prompts-sin-patron.json`, capturada
 *   una sola vez con los constructores ANTERIORES al cambio. No se regenera
 *   desde el código bajo prueba: un espejo aceptaría cualquier regresión.
 * - con patrón, la frase de Python entra en la línea de color de SU estructura
 *   (y en su elemento del JSON de escena), también bajo un MONOCHROME LOCK (dos
 *   acabados del mismo color), en la cláusula LoRA justo después de la frase de
 *   materiales, en la clave de agrupación y en el JSON del LoRA; la
 *   compactación nunca la quita y, si no cabe, el preflight falla cerrado.
 * - frontera: las frases REALES de Python (`expected_python` de los vectores
 *   dorados con patrón) pasan coherencia, el control de idioma y el preflight
 *   del LoRA, porque TypeScript no las traduce.
 *
 * Los planes son entradas congeladas (`scripts/lib/planes-fijados.ts` y los
 * vectores dorados) y los patrones, salidas de Python fijadas a mano en
 * `scripts/fixtures/patron-color-prompt/patrones.json`: no son un oráculo de
 * conteo. Determinista y sin red.
 * Run: npx tsx --conditions=react-server scripts/test/test-patron-color-prompt.ts
 */

const DIRECTORIO_FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "patron-color-prompt");

function leerFixture(nombre: string): unknown {
  return JSON.parse(readFileSync(join(DIRECTORIO_FIXTURES, nombre), "utf8"));
}

const PATRONES = z.record(z.string(), PatronColorResueltoSchema).parse(leerFixture("patrones.json"));
/** Armados de bouquet como los escribe Python (ADR-0030), fijados a mano igual que los patrones. */
const ARMADOS = z.record(z.string(), ArmadoBouquetResueltoSchema).parse(leerFixture("armados.json"));

function armado(nombre: string, cambios: Partial<ArmadoBouquetResuelto> = {}): ArmadoBouquetResuelto {
  const base = ARMADOS[nombre];
  if (!base) throw new Error(`armado de fixture desconocido: ${nombre} (hay ${Object.keys(ARMADOS).join(", ")})`);
  return ArmadoBouquetResueltoSchema.parse({ ...base, ...cambios });
}

function patron(nombre: string, cambios: Partial<PatronColorResuelto> = {}): PatronColorResuelto {
  const base = PATRONES[nombre];
  if (!base) throw new Error(`patrón de fixture desconocido: ${nombre} (hay ${Object.keys(PATRONES).join(", ")})`);
  return PatronColorResueltoSchema.parse({ ...base, ...cambios });
}

// ---------------------------------------------------------------------------
// Escenas: las mismas transformaciones que /api/generate (route.ts).
// ---------------------------------------------------------------------------

/** Plan congelado con `patrones_color` puesto encima, como lo devolvería Python. */
function conPatrones(fijado: PlanFijadoDeFixture, patrones: readonly PatronColorResuelto[] | undefined): PlanResuelto {
  return patrones === undefined ? fijado.plan : { ...fijado.plan, patrones_color: [...patrones] };
}

function escenaDePlan({ plan, materialEstimate }: PlanFijadoDeFixture): SceneSpec {
  const colorDeVariante = new Map(plan.estructuras.flatMap((estructura) => estructura.lineas.map((linea) => [linea.variant_id, linea.color] as const)));
  const blueprint = planBlueprint(plan);
  return buildApprovedSceneSpec({
    blueprint,
    aspectRatio: "3:2",
    targetBoxes: Object.fromEntries(Object.entries(cajasDeEstructuras(plan.plan.estructuras)).map(([id, layout]) => [id, layout.bbox])),
    catalogProducts: Object.fromEntries(blueprint.elements.map((element) => [element.element_id, (element.model_decision?.bill_of_materials ?? []).map((linea) => ({
      id: linea.catalog_product_id,
      name: linea.catalog_product_id,
      description: "",
      category: "balloon",
      colors: [colorDeVariante.get(linea.catalog_product_id)!],
      share: linea.share,
      role: linea.role,
    }))])),
    materialEstimate,
    generationMode: "text_to_image",
    createdBy: "server_default",
    planHash: plan.plan_hash,
    catalogOnly: true,
  });
}

/** Mirror of the route's private officialStructuresDePlan (src/app/api/generate/route.ts). */
function officialStructuresDe(plan: PlanResuelto): ReadonlyMap<string, string> {
  return new Map(plan.plan.estructuras.flatMap((estructura) => estructura.estructura_oficial ? [[estructura.estructura_id, estructura.estructura_oficial] as const] : []));
}

/** El mismo bloque de tamaños que arma route.ts, necesario para la coherencia. */
function sizeMixDe(plan: PlanResuelto, escena: SceneSpec): string | undefined {
  const ubicaciones = new Map<string, string>();
  for (const element of escena.elements) {
    const grupo = element.visual_semantics?.repetition_group ?? element.element_id.split("#")[0]!;
    if (!ubicaciones.has(grupo)) ubicaciones.set(grupo, placementDescription(element.target_bbox, element.category));
  }
  return bloqueMezclaPorEstructura(plan.estructuras.map((estructura) => ({
    nombre: estructura.nombre,
    total_unidades: estructura.total_unidades,
    repeticiones: estructura.repeticiones,
    ubicacion_en_palabras: ubicaciones.get(estructura.estructura_id),
    mezcla_real: estructura.mezcla_real.map((linea) => ({ diamPulg: linea.diam_pulg, forma: linea.forma, unidades: linea.unidades })),
  }))) ?? undefined;
}

/** Lo mismo que arma route.ts para la comprobación estructural de color. */
function escenaParaCoherencia(escena: SceneSpec): EscenaParaCoherencia {
  return {
    elementos: escena.elements.map((element) => ({
      element_id: element.element_id,
      nombre_en_prompt: promptElementName(element.name),
      estructura_id: element.visual_semantics?.repetition_group ?? element.element_id.split("#")[0]!,
      resolved_colors: element.resolved_colors,
      espera_linea_de_color: tieneContratoDeColor(element),
    })),
  };
}

const CONTEXTO_CUMPLE = buildVisualContext({
  brief: { tipo_evento: "cumpleaños", estilo: "glamour", colores: ["rojo", "dorado"], espacio: "salón" },
  userRequest: "Cumpleaños en un salón con un semiarco y una columna rojo y dorado",
});

const CONTEXTO_XV = buildVisualContext({
  brief: { tipo_evento: "XV años", estilo: "elegante", colores: ["blanco", "dorado"], espacio: "salón" },
  userRequest: "XV años en salón, arco orgánico con dos columnas blanco y dorado",
});

/** Gemini: prompt completo, con el bloque de tamaños y el vocabulario oficial de route.ts. */
function promptGemini(fijado: PlanFijadoDeFixture, colorPatterns: readonly PatronColorResuelto[] | undefined, visualContext = CONTEXTO_CUMPLE): string {
  const escena = escenaDePlan(fijado);
  const plan = conPatrones(fijado, colorPatterns);
  return buildImagePrompt({ sceneSpec: escena, visualContext, sizeMixBlock: sizeMixDe(plan, escena), officialStructures: officialStructuresDe(plan), colorPatterns: plan.patrones_color });
}

/** Caption LoRA sin vocabulario de producto (camino legacy de color/acabado). */
function captionLegacy(fijado: PlanFijadoDeFixture, colorPatterns: readonly PatronColorResuelto[] | undefined, dialect: "product_v007" | "scene_v004", visualContext = CONTEXTO_XV) {
  const plan = conPatrones(fijado, colorPatterns);
  return compileLoraCaption({ sceneSpec: escenaDePlan(fijado), visualContext, officialStructures: officialStructuresDe(plan), dialect, colorPatterns: plan.patrones_color });
}

// Productos reales del vocabulario v007 (los mismos de test-lora-preflight-barrido.ts).
const PRODUCTO_POR_COLOR: Readonly<Record<string, string>> = {
  dorado: "7109611258049",
  plateado: "20014244",
  rosado: "20010671",
  blanco: "7109565710529",
  crema: "10467043344577",
};

type Elemento = SceneSpec["elements"][number];

function elemento(id: string, nombre: string, tipo: "arco" | "columna" | "guirnalda" | "centro_mesa", ubicacion: "arco_central" | "lateral_izquierdo" | "lateral_derecho" | "techo" | "sobre_mesa_principal" | "mesas_invitados", rol: "focal" | "soporte" | "acento", colores: string[]): Elemento {
  const productIds = colores.map((color) => PRODUCTO_POR_COLOR[color]!);
  return {
    element_id: id,
    name: nombre,
    category: "balloon_structure",
    source_type: "catalog_backed",
    catalog_product_id: productIds[0],
    catalog_product_ids: productIds,
    required: true,
    quantity: { mode: "exact", min: 1, max: 1 },
    target_bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.7 },
    depth_layer: 10,
    resolved_colors: colores,
    visual_semantics: { structure_type: tipo, placement: ubicacion, design_role: rol, repetition_group: id, density: "media" },
    identity_constraints: [],
    relationships: [],
  };
}

function escenaSintetica(elementos: Elemento[]): SceneSpec {
  return {
    schema_version: "1.0",
    generation_mode: "text_to_image",
    canvas: { aspect_ratio: "3:2", content_rect: { x: 0, y: 0, width: 1, height: 1 } },
    venue: { preserve: [], protected_regions: [], editable_regions: [] },
    elements: elementos,
    positive_prompt: { required_elements: [], composition: [], venue_preservation: [], photorealistic_integration: [] },
    negative_prompt: { forbidden_elements: [], forbidden_venue_changes: [], forbidden_compositing_artifacts: [] },
    metadata: { created_by: "server_default", plan_hash: "plan-patron-color" },
  };
}

/** Arco focal y dos columnas espejo: el caso en que dos patrones distintos no pueden fusionarse. */
const ESCENA_COLUMNAS = escenaSintetica([
  elemento("EST_01_ARCO", "Arco orgánico", "arco", "arco_central", "focal", ["rosado", "dorado"]),
  elemento("EST_02_COL_IZQ", "Columna izquierda", "columna", "lateral_izquierdo", "soporte", ["rosado", "dorado"]),
  elemento("EST_03_COL_DER", "Columna derecha", "columna", "lateral_derecho", "soporte", ["rosado", "dorado"]),
]);

/** Varias tallas por estructura: dispara "mixed organically rather than graded" en el dialecto de producto. */
const TALLAS_COLUMNAS: ElementSizeConfirmation[] = ESCENA_COLUMNAS.elements.flatMap((el) => (el.catalog_product_ids ?? []).flatMap((productId) =>
  (el.element_id === "EST_01_ARCO" ? ["R-5", "R-12", "R-18"] : ["R-5", "R-12"]).map((sizeCode) => ({ elementId: el.element_id, productId, sizeCode }))));

const CONTEXTO_BODA = buildVisualContext({
  brief: { tipo_evento: "boda", estilo: "elegante", colores: ["rosado", "crema", "dorado", "plateado"], espacio: "jardín" },
  userRequest: "Decoración para boda en jardín, elegante, colores rosado, crema, dorado y plateado",
});

/** Escena cargada: el caption solo cabe compactado. */
const ESCENA_CARGADA = escenaSintetica([
  elemento("EST_01_ARCO", "Arco orgánico", "arco", "arco_central", "focal", ["rosado", "crema", "dorado", "plateado"]),
  elemento("EST_02_COL_IZQ", "Columna izquierda", "columna", "lateral_izquierdo", "soporte", ["rosado", "crema"]),
  elemento("EST_03_COL_DER", "Columna derecha", "columna", "lateral_derecho", "soporte", ["rosado", "crema"]),
  elemento("EST_04_GUIRNALDA", "Guirnalda de techo", "guirnalda", "techo", "soporte", ["crema", "dorado"]),
  elemento("EST_05_CENTRO", "Centro de mesa principal", "centro_mesa", "sobre_mesa_principal", "acento", ["crema", "dorado"]),
  elemento("EST_06_CENTROS_INVITADOS", "Centros de mesa invitados", "centro_mesa", "mesas_invitados", "acento", ["dorado"]),
]);

const TALLAS_CARGADA: ElementSizeConfirmation[] = ESCENA_CARGADA.elements.flatMap((el, indice) => (el.catalog_product_ids ?? []).flatMap((productId) =>
  (indice === 0 ? ["R-5", "R-9", "R-12", "R-18"] : ["R-12"]).map((sizeCode) => ({ elementId: el.element_id, productId, sizeCode }))));

function captionCanonico(sceneSpec: SceneSpec, sizeConfirmations: ElementSizeConfirmation[], visualContext: ReturnType<typeof buildVisualContext>, colorPatterns: readonly PatronColorResuelto[] | undefined, trigger?: string, maxLength?: number) {
  return compileProductPrompt({ sceneSpec, visualContext, vocabulary: PRODUCT_VOCABULARY, sizeConfirmations, trigger, maxLength, colorPatterns });
}

/** Todo lo que sale del compilador: texto, JSON, paso de compactación, diagnósticos y cláusulas (la agrupación). */
function textoLora(resultado: { prompt: string; jsonPrompt: string; compactionStep?: number; diagnostics?: string[]; clauses: unknown[] }): string {
  return JSON.stringify({
    prompt: resultado.prompt,
    jsonPrompt: resultado.jsonPrompt,
    compactionStep: resultado.compactionStep ?? null,
    diagnostics: resultado.diagnostics ?? null,
    clauses: resultado.clauses,
  });
}

export type CasoPrompt = {
  nombre: string;
  /** Estructuras del caso que un patrón podría tocar. */
  estructuras: readonly string[];
  generar: (colorPatterns?: readonly PatronColorResuelto[]) => string;
};

/**
 * Los prompts sin patrón que se comparan byte a byte con la instantánea. Se
 * exporta solo para haberla capturado con los constructores de ANTES del
 * adaptador; el test nunca la reescribe.
 */
export function casosSinPatron(): CasoPrompt[] {
  const cumple = planFijado("calibracion-cumple-semiarco-columna");
  const xv = planFijado("calibracion-xv-arco-columnas");
  const monocromo = planFijado("color-arco-con-columnas");
  const estructurasDe = (fijado: PlanFijadoDeFixture) => fijado.plan.plan.estructuras.map((estructura) => estructura.estructura_id);
  const idsSinteticos = (escena: SceneSpec) => escena.elements.map((element) => element.element_id);
  return [
    { nombre: "gemini/cumple-semiarco-columna", estructuras: estructurasDe(cumple), generar: (patrones) => promptGemini(cumple, patrones) },
    { nombre: "gemini/xv-arco-columnas", estructuras: estructurasDe(xv), generar: (patrones) => promptGemini(xv, patrones, CONTEXTO_XV) },
    { nombre: "gemini/arco-con-columnas-monocromo", estructuras: estructurasDe(monocromo), generar: (patrones) => promptGemini(monocromo, patrones) },
    { nombre: "lora-legacy-v007/cumple-semiarco-columna", estructuras: estructurasDe(cumple), generar: (patrones) => textoLora(captionLegacy(cumple, patrones, "product_v007", CONTEXTO_CUMPLE)) },
    { nombre: "lora-legacy-v007/xv-arco-columnas", estructuras: estructurasDe(xv), generar: (patrones) => textoLora(captionLegacy(xv, patrones, "product_v007")) },
    { nombre: "lora-legacy-v004/xv-arco-columnas", estructuras: estructurasDe(xv), generar: (patrones) => textoLora(captionLegacy(xv, patrones, "scene_v004")) },
    { nombre: "lora-canonico-v007/columnas", estructuras: idsSinteticos(ESCENA_COLUMNAS), generar: (patrones) => textoLora(captionCanonico(ESCENA_COLUMNAS, TALLAS_COLUMNAS, CONTEXTO_XV, patrones)) },
    { nombre: "lora-canonico-v004/columnas", estructuras: idsSinteticos(ESCENA_COLUMNAS), generar: (patrones) => textoLora(captionCanonico(ESCENA_COLUMNAS, TALLAS_COLUMNAS, CONTEXTO_XV, patrones, "eventdecor_style_v2")) },
    { nombre: "lora-canonico-v004/cargada", estructuras: idsSinteticos(ESCENA_CARGADA), generar: (patrones) => textoLora(captionCanonico(ESCENA_CARGADA, TALLAS_CARGADA, CONTEXTO_BODA, patrones, "eventdecor_style_v2")) },
    { nombre: "lora-canonico-v007/cargada", estructuras: idsSinteticos(ESCENA_CARGADA), generar: (patrones) => textoLora(captionCanonico(ESCENA_CARGADA, TALLAS_CARGADA, CONTEXTO_BODA, patrones)) },
  ];
}

function main(): void {
  // 1. Sin patrón, byte a byte lo de antes.
  const instantanea = z.record(z.string(), z.string()).parse(leerFixture("prompts-sin-patron.json"));
  for (const caso of casosSinPatron()) {
    const esperado = instantanea[caso.nombre];
    assert.ok(esperado !== undefined, `la instantánea no tiene ${caso.nombre}`);
    const variantes: Record<string, readonly PatronColorResuelto[] | undefined> = {
      "sin patrones_color": undefined,
      "lista vacía": [],
      // Modo aleatorio: Python deja las dos frases vacías y manda el reparto orgánico de siempre.
      "modo aleatorio": caso.estructuras.map((id) => patron("aleatorio", { estructura_id: id })),
      // Una sugerencia (aplicado: false) nunca entra al prompt aunque traiga frases.
      "sugerencias": caso.estructuras.map((id) => patron("sugerencia", { estructura_id: id })),
    };
    for (const [variante, patrones] of Object.entries(variantes)) {
      assert.equal(caso.generar(patrones), esperado, `${caso.nombre} (${variante}) cambió respecto al prompt anterior al adaptador`);
    }
  }
  assert.equal(GEMINI_COMPOSITION_HARD_LOCK, instantanea["hibrido/hard-lock"]);
  assert.equal(hardLockComposicionGemini(false), instantanea["hibrido/hard-lock"], "sin patrón el hard lock de la etapa 2 no cambia");
  console.log("[PASS] sin patrón aplicado (ausente, vacío, aleatorio o sugerido) los prompts Gemini y LoRA son byte a byte los de antes");

  geminiConPatron(instantanea);
  loraConPatron(instantanea);
  agrupacionConPatron();
  compactacionConPatron();
  armadoDeBouquetEnLosPrompts(instantanea);
  // Al final: es la frontera con la salida real de Python, no con las frases fijadas arriba.
  vectoresDoradosConPatron();
}

/**
 * El armado de un bouquet (ADR-0030) entra por la misma puerta que el patrón:
 * `frasesDeEstructuras` junta `patrones_color` y `armados_bouquet` y los
 * constructores insertan `prompt_gemini` / `prompt_lora` tal cual, sin
 * redactar nada. Sin armados ni patrones la petición es la de siempre.
 */
function armadoDeBouquetEnLosPrompts(instantanea: Readonly<Record<string, string>>): void {
  const cumple = planFijado("calibracion-cumple-semiarco-columna");
  const apilado = armado("apilado-semiarco");
  assert.equal(apilado.estructura_id, "EST_01_SEMIARCO");
  // Sin ninguno de los dos, nada que insertar: la petición de siempre.
  assert.equal(frasesDeEstructuras({}), undefined);
  assert.equal(frasesDeEstructuras(null), undefined);
  const frases = frasesDeEstructuras({ armados_bouquet: [apilado] })!;
  assert.deepEqual(frases, [{ estructura_id: "EST_01_SEMIARCO", aplicado: true, prompt_gemini: apilado.prompt_gemini, prompt_lora: apilado.prompt_lora }]);
  // Un patrón y un armado de piezas distintas conviven en la misma lista.
  const espiralColumna = patron("espiral-columna", { estructura_id: "EST_02_COLUMNA" });
  assert.equal(frasesDeEstructuras({ patrones_color: [espiralColumna], armados_bouquet: [apilado] })!.length, 2);

  // Gemini: la frase del armado va en la línea de color de su pieza y en su color_pattern.
  const escena = escenaDePlan(cumple);
  const prompt = buildImagePrompt({ sceneSpec: escena, visualContext: CONTEXTO_CUMPLE, sizeMixBlock: sizeMixDe(cumple.plan, escena), officialStructures: officialStructuresDe(cumple.plan), colorPatterns: frases });
  const lineaSemiarco = prompt.split("\n").find((linea) => linea.startsWith("- Semiarco derecho: "))!;
  assert.ok(lineaSemiarco.endsWith(` ${apilado.prompt_gemini} Do not invent, recolor, or borrow any additional color.`), lineaSemiarco);
  assert.doesNotMatch(lineaSemiarco, /organic clusters/);
  const deshecho = prompt
    .replace(apilado.prompt_gemini, "Distribute them through intentional organic clusters and transitions; avoid flat stripes, random speckles, or one color replacing another.")
    .replace(`,"color_pattern":${JSON.stringify(apilado.prompt_gemini)}`, "");
  assert.equal(deshecho, instantanea["gemini/cumple-semiarco-columna"]);

  // LoRA: el fragmento va tras la frase de materiales, en su cláusula y en el JSON, y pasa el control de idioma y el preflight.
  const caption = compileLoraCaption({ sceneSpec: escena, visualContext: CONTEXTO_CUMPLE, officialStructures: officialStructuresDe(cumple.plan), dialect: "product_v007", colorPatterns: frases });
  assert.equal(clausulaDe(caption.clauses, "EST_01_SEMIARCO").colorPattern, apilado.prompt_lora);
  assert.equal(vecesEn(caption.prompt, apilado.prompt_lora), 1, caption.prompt);
  const json = ensureLoraTriggers(caption.jsonPrompt, [{ path: "patron-color", trigger: "eventdecor_style_v2", scale: 1 }]);
  assert.deepEqual(findLoraPromptLanguageLeaks(`${caption.prompt} ${json}`), [], "Python escribió prompt_lora con texto que el LoRA rechaza");
  const reporte = preflight(escena, caption);
  assert.equal(reporte.ok, true, reporte.errors.join("; "));
  console.log("[PASS] bouquet: el armado de Python entra en los prompts Gemini y LoRA por la misma puerta que el patrón, tal cual");
}

/** Gemini: la frase de Python reemplaza SOLO la del reparto orgánico, en la línea de su estructura. */
function geminiConPatron(instantanea: Readonly<Record<string, string>>): void {
  const cumple = planFijado("calibracion-cumple-semiarco-columna");
  const espiral = patron("espiral-semiarco");
  const frase = espiral.prompt_gemini;
  const prompt = promptGemini(cumple, [espiral]);
  const lineas = prompt.split("\n");
  const lineaSemiarco = lineas.find((linea) => linea.startsWith("- Semiarco derecho: "))!;
  const lineaColumna = lineas.find((linea) => linea.startsWith("- Columna izquierda: "))!;
  assert.ok(lineaSemiarco && lineaColumna, prompt);
  // El prefijo que lee coherencia.ts, la proporción y el cierre se conservan.
  assert.match(lineaSemiarco, /^- Semiarco derecho: APPROVED COLOR VARIETY — use exactly these catalog colors: rojo, dorado\. Approximate share of this structure's own balloons: .+\. Keep that balance visible; the dominant color must read as dominant\. /, lineaSemiarco);
  assert.ok(lineaSemiarco.endsWith(` ${frase} Do not invent, recolor, or borrow any additional color.`), lineaSemiarco);
  assert.doesNotMatch(lineaSemiarco, /organic clusters|avoid flat stripes/, "con patrón no se pide el reparto orgánico que lo contradice");
  // La otra estructura no tiene patrón: conserva la frase orgánica y no recibe la de Python.
  assert.ok(!lineaColumna.includes(frase), lineaColumna);
  assert.match(lineaColumna, /Distribute them through intentional organic clusters and transitions; avoid flat stripes, random speckles, or one color replacing another\./);
  // El JSON de escena: `color_pattern` solo en el elemento con patrón.
  const escena = JSON.parse(/<AUTOMATIC_SCENE_SPEC>\n(.+)\n<\/AUTOMATIC_SCENE_SPEC>/.exec(prompt)![1]!) as { elements: Array<{ name: string; color_pattern?: string }> };
  assert.equal(escena.elements.find((element) => element.name === "Semiarco derecho")?.color_pattern, frase);
  assert.ok(!("color_pattern" in escena.elements.find((element) => element.name === "Columna izquierda")!));
  // Y nada más cambia: deshaciendo las dos inserciones queda el prompt de antes.
  const deshecho = prompt
    .replace(frase, "Distribute them through intentional organic clusters and transitions; avoid flat stripes, random speckles, or one color replacing another.")
    .replace(`,"color_pattern":${JSON.stringify(frase)}`, "");
  assert.equal(deshecho, instantanea["gemini/cumple-semiarco-columna"]);
  // coherencia.ts sigue leyendo los colores de cada línea.
  const plan = conPatrones(cumple, [espiral]);
  const coherencia = verificarCoherenciaPrompt(prompt, plan, escenaParaCoherencia(escenaDePlan(cumple)));
  assert.equal(coherencia.ok, true, coherencia.errores.join("; "));
  console.log("[PASS] Gemini: la frase de Python va en la línea de color de su estructura y en su color_pattern; la otra estructura y coherencia no cambian");

  // Una estructura repetida (`EST_02_COLUMNAS#1`, `#2`): cada instancia lleva el patrón de su estructura.
  const repetida = planFijado("qa-lateral-repetida-x2");
  const patronColumnas = patron("espiral-columna", { estructura_id: "EST_02_COLUMNAS" });
  const promptRepetida = promptGemini(repetida, [patronColumnas]);
  const lineasColumnas = promptRepetida.split("\n").filter((linea) => / de 2: APPROVED COLOR VARIETY/.test(linea));
  assert.equal(lineasColumnas.length, 2, promptRepetida);
  for (const linea of lineasColumnas) assert.ok(linea.includes(patronColumnas.prompt_gemini), linea);
  assert.ok(!promptRepetida.split("\n").find((linea) => linea.startsWith("- Arco"))!.includes(patronColumnas.prompt_gemini));
  const coherenciaRepetida = verificarCoherenciaPrompt(promptRepetida, conPatrones(repetida, [patronColumnas]), escenaParaCoherencia(escenaDePlan(repetida)));
  assert.equal(coherenciaRepetida.ok, true, coherenciaRepetida.errores.join("; "));

  console.log("[PASS] Gemini: las instancias repetidas llevan el patrón de su estructura");

  geminiMonocromoConPatron();

  // Etapa 2 del híbrido: una frase más en el hard lock, solo con patrón.
  assert.equal(hardLockComposicionGemini(true), `${GEMINI_COMPOSITION_HARD_LOCK} Keep each structure's color pattern exactly as in the LoRA image.`);
  console.log("[PASS] híbrido: el hard lock pide conservar el patrón de la imagen LoRA solo cuando hay patrón");
}

const COLUMNAS_DOS_ACABADOS = "EST_02_COLUMNAS";
const DORADO_MATE = { product_id: "P-DORADO-MATE", variant_id: "V-P-DORADO-MATE-R-12", sku: "SKU-P-DORADO-MATE-R-12", titulo: "Globo dorado mate — R-12" };

/**
 * `color-arco-con-columnas` con las columnas en dos acabados del mismo dorado
 * (cromado y mate) y el patrón `espiral-dos-acabados`, como las deja Python:
 * 40 globos por columna, 20 de cada acabado. Solo cambia esa estructura; el
 * arco, las compras y el resto del plan congelado quedan igual.
 */
function columnasDosAcabados(): { fijado: PlanFijadoDeFixture; patron: PatronColorResuelto } {
  const { plan, materialEstimate } = planFijado("color-arco-con-columnas");
  const espiral = patron("espiral-dos-acabados");
  assert.equal(espiral.estructura_id, COLUMNAS_DOS_ACABADOS);
  // Mitad y mitad, como el conteo del patrón (20 + 20 por columna).
  const total = espiral.globos_por_instancia * espiral.repeticiones;
  const mitad = total / 2;
  assert.deepEqual(espiral.conteo.map((linea) => linea.unidades_total), [mitad, mitad]);
  const declarado = plan.plan;
  if (declarado.plan_version !== "1.0") throw new Error(`color-arco-con-columnas cambió de versión de plan: ${declarado.plan_version}`);
  return {
    patron: espiral,
    fijado: {
      plan: {
        ...plan,
        plan: {
          ...declarado,
          estructuras: declarado.estructuras.map((estructura) => estructura.estructura_id !== COLUMNAS_DOS_ACABADOS ? estructura : {
            ...estructura,
            materiales: [
              { ...estructura.materiales[0]!, acabado: "reflex", participacion: 0.5 },
              { ...estructura.materiales[0]!, product_id: DORADO_MATE.product_id, acabado: "mate", participacion: 0.5 },
            ],
            patron_color: espiral.patron,
          }),
        },
        estructuras: plan.estructuras.map((estructura) => estructura.estructura_id !== COLUMNAS_DOS_ACABADOS ? estructura : {
          ...estructura,
          total_unidades: total,
          lineas: [
            { ...estructura.lineas[0]!, unidades: mitad },
            { ...estructura.lineas[0]!, ...DORADO_MATE, acabado: "mate", unidades: mitad },
          ],
          mezcla_real: [{ ...estructura.mezcla_real[0]!, unidades: total }],
        }),
      },
      materialEstimate: {
        ...materialEstimate,
        balloons: materialEstimate.balloons.flatMap((linea) => linea.structure_id !== COLUMNAS_DOS_ACABADOS ? [linea] : [
          { ...linea, design_quantity: mitad, required_quantity: mitad, waste_adjusted_quantity: mitad },
          { ...linea, product_id: DORADO_MATE.product_id, variant_id: DORADO_MATE.variant_id, finish: "mate", design_quantity: mitad, required_quantity: mitad, waste_adjusted_quantity: mitad },
        ]),
      },
    },
  };
}

/**
 * Un MONOCHROME LOCK también puede tener patrón: dos materiales del mismo color
 * con distinto acabado son una sola línea de color, pero Python les da patrón
 * y el conteo y la cotización salen de él. El candado queda como estaba y la
 * frase de Python va detrás; el caption LoRA lleva la suya, así que el mismo
 * plan firmado describe el mismo patrón con los dos proveedores.
 */
function geminiMonocromoConPatron(): void {
  const { fijado, patron: espiral } = columnasDosAcabados();
  const frase = espiral.prompt_gemini;
  const prompt = promptGemini(fijado, [espiral]);
  const lineasColumnas = prompt.split("\n").filter((linea) => linea.startsWith("- Columnas laterales "));
  assert.equal(lineasColumnas.length, 2, prompt);
  for (const linea of lineasColumnas) {
    assert.match(linea, /^- Columnas laterales #[12] de 2: MONOCHROME LOCK — use only dorado; do not introduce color variety\. /, linea);
    assert.ok(linea.endsWith(`do not introduce color variety. ${frase}`), linea);
  }
  const lineaArco = prompt.split("\n").find((linea) => linea.startsWith("- Arco principal"))!;
  assert.ok(lineaArco && !lineaArco.includes(frase), lineaArco);
  assert.match(lineaArco, /Distribute them through intentional organic clusters/);
  const escena = JSON.parse(/<AUTOMATIC_SCENE_SPEC>\n(.+)\n<\/AUTOMATIC_SCENE_SPEC>/.exec(prompt)![1]!) as { elements: Array<{ name: string; color_pattern?: string }> };
  assert.deepEqual(escena.elements.map((element) => element.color_pattern), [undefined, frase, frase]);
  // Nada más cambia: sin las dos inserciones es el prompt del mismo plan sin patrón.
  const deshecho = prompt
    .replaceAll(`do not introduce color variety. ${frase}`, "do not introduce color variety.")
    .replaceAll(`,"color_pattern":${JSON.stringify(frase)}`, "");
  assert.equal(deshecho, promptGemini(fijado, undefined));
  // coherencia.ts sigue leyendo "use only dorado;" en cada columna.
  const plan = conPatrones(fijado, [espiral]);
  const coherencia = verificarCoherenciaPrompt(prompt, plan, escenaParaCoherencia(escenaDePlan(fijado)));
  assert.equal(coherencia.ok, true, coherencia.errores.join("; "));

  // El caption LoRA del mismo plan lleva el patrón, y con él el hard lock de la etapa 2.
  const caption = captionLegacy(fijado, [espiral], "product_v007", CONTEXTO_CUMPLE);
  assert.equal(clausulaDe(caption.clauses, `${COLUMNAS_DOS_ACABADOS}#1`).colorPattern, espiral.prompt_lora);
  assert.equal(vecesEn(caption.prompt, espiral.prompt_lora), 1, caption.prompt);
  const reporte = preflight(escenaDePlan(fijado), caption);
  assert.equal(reporte.ok, true, reporte.errors.join("; "));
  console.log("[PASS] Gemini: un MONOCHROME LOCK con patrón (dos acabados del mismo color) conserva el candado y lleva la frase de Python, igual que el caption LoRA");
}

function clausulaDe(clauses: readonly LoraVisualClause[], elementId: string): LoraVisualClause {
  const clausula = clauses.find((clause) => clause.elementIds.includes(elementId));
  assert.ok(clausula, `ninguna cláusula representa ${elementId}`);
  return clausula;
}

function preflight(sceneSpec: SceneSpec, resultado: { clauses: LoraVisualClause[]; prompt: string }, prompt = resultado.prompt, maxLength?: number) {
  return preflightLoraPrompt({ sceneSpec, clauses: resultado.clauses, prompt, vocabulary: PRODUCT_VOCABULARY, maxLength });
}

function vecesEn(texto: string, fragmento: string): number {
  return texto.split(fragmento).length - 1;
}

/** LoRA: el fragmento de Python va justo detrás de la frase de materiales, en la misma cláusula. */
function loraConPatron(instantanea: Readonly<Record<string, string>>): void {
  const cumple = planFijado("calibracion-cumple-semiarco-columna");
  const espiral = patron("espiral-semiarco");
  const frase = espiral.prompt_lora;
  const sinPatron = JSON.parse(instantanea["lora-legacy-v007/cumple-semiarco-columna"]!) as { prompt: string };
  const resultado = captionLegacy(cumple, [espiral], "product_v007", CONTEXTO_CUMPLE);
  assert.equal(clausulaDe(resultado.clauses, "EST_01_SEMIARCO").colorPattern, frase);
  assert.equal(clausulaDe(resultado.clauses, "EST_02_COLUMNA").colorPattern, undefined);
  assert.ok(sinPatron.prompt.includes("in red and gold standing on the right side"), sinPatron.prompt);
  assert.equal(resultado.prompt, sinPatron.prompt.replace("in red and gold standing on the right side", `in red and gold ${frase} standing on the right side`));
  const escena = escenaDePlan(cumple);
  const reporte = preflight(escena, resultado);
  assert.equal(reporte.ok, true, reporte.errors.join("; "));
  const colores = verificarColoresCaptionLora(conPatrones(cumple, [espiral]), escenaParaCoherencia(escena), { clausulas: resultado.clauses, traducirColor: translateLoraColor });
  assert.equal(colores.ok, true, colores.errores.join("; "));
  // El JSON del LoRA: la misma frase como `color_pattern` del sujeto con patrón, y solo en él.
  const json = JSON.parse(resultado.jsonPrompt) as { subjects: Array<{ description: string; color_pattern?: string }> };
  assert.deepEqual(json.subjects.map((subject) => subject.color_pattern), [frase, undefined]);
  assert.ok(json.subjects[0]!.description.includes(`in red and gold ${frase} `), json.subjects[0]!.description);
  // Un patrón alterado o perdido falla cerrado en el preflight.
  const alterado = preflight(escena, resultado, resultado.prompt.replace("wrapped in a spiral", "wrapped in a swirl"));
  assert.equal(alterado.ok, false);
  assert.match(alterado.errors.join("; "), /patrón de color ausente o alterado: EST_01_SEMIARCO/);
  console.log("[PASS] LoRA legacy: el fragmento va justo detrás de la frase de materiales, en su cláusula y en el JSON; el preflight lo exige literal");

  // Dialecto de producto con vocabulario: sin "mixed organically rather than graded" en la cláusula con patrón.
  const arco = patron("espiral-columna", { estructura_id: "EST_01_ARCO", prompt_lora: "wrapped in a spiral of pink and gold stripes winding from the left base over the top to the right base" });
  const canonico = captionCanonico(ESCENA_COLUMNAS, TALLAS_COLUMNAS, CONTEXTO_XV, [arco]);
  const sujetos = (JSON.parse(canonico.jsonPrompt) as { subjects: Array<{ description: string; color_pattern?: string }> }).subjects;
  assert.ok(sujetos[0]!.description.includes(`(5-inch, 12-inch and 18-inch) ${arco.prompt_lora} centered around the stage photo area`), sujetos[0]!.description);
  assert.doesNotMatch(sujetos[0]!.description, /mixed organically/, sujetos[0]!.description);
  assert.match(sujetos[1]!.description, /mixed organically rather than graded/, "la estructura sin patrón conserva la relación de tamaños");
  assert.deepEqual(sujetos.map((subject) => subject.color_pattern), [arco.prompt_lora, undefined]);
  assert.equal(vecesEn(canonico.prompt, arco.prompt_lora), 1);
  assert.ok(canonico.prompt.includes(`) ${arco.prompt_lora} centered around the stage photo area`), canonico.prompt);
  assert.ok(canonico.prompt.length <= LORA_PROMPT_MAX_LENGTH);
  const reporteCanonico = preflight(ESCENA_COLUMNAS, canonico);
  assert.equal(reporteCanonico.ok, true, reporteCanonico.errors.join("; "));
  // El JSON va con el trigger que le antepone route.ts, y el patrón sigue literal tras el escapado.
  const jsonConTrigger = ensureLoraTriggers(canonico.jsonPrompt, [{ path: "patron-color", trigger: "eventdecor_style_v2", scale: 1 }]);
  const reporteJson = preflight(ESCENA_COLUMNAS, canonico, jsonConTrigger, LORA_JSON_PROMPT_MAX_LENGTH);
  assert.equal(reporteJson.ok, true, reporteJson.errors.join("; "));

  // Dialecto de escena (v004): detrás de "of ... balloons".
  const escenaV004 = captionCanonico(ESCENA_COLUMNAS, TALLAS_COLUMNAS, CONTEXTO_XV, [arco], "eventdecor_style_v2");
  assert.ok(escenaV004.prompt.includes(`glossy chrome gold balloons ${arco.prompt_lora} as the central focal piece`), escenaV004.prompt);
  const reporteV004 = preflight(ESCENA_COLUMNAS, escenaV004);
  assert.equal(reporteV004.ok, true, reporteV004.errors.join("; "));
  console.log("[PASS] LoRA con vocabulario: el patrón sigue a los materiales en los dos dialectos y reemplaza \"mixed organically\" solo en su cláusula");
}

/** Dos patrones distintos (o uno y ninguno) nunca se fusionan en una cláusula. */
function agrupacionConPatron(): void {
  const xv = planFijado("calibracion-xv-arco-columnas");
  const escena = escenaDePlan(xv);
  const espiral = patron("espiral-columna");
  const anillos = patron("anillos-columna");

  const sinPatron = captionLegacy(xv, undefined, "product_v007");
  const par = clausulaDe(sinPatron.clauses, "EST_02_COL_IZQ");
  assert.deepEqual([...par.elementIds].sort(), ["EST_02_COL_IZQ", "EST_03_COL_DER"]);
  assert.equal(par.bilateral, true);

  for (const [caso, patrones] of [["espiral y anillos", [espiral, anillos]], ["espiral y ninguno", [espiral]]] as const) {
    const resultado = captionLegacy(xv, patrones, "product_v007");
    const izquierda = clausulaDe(resultado.clauses, "EST_02_COL_IZQ");
    const derecha = clausulaDe(resultado.clauses, "EST_03_COL_DER");
    assert.notEqual(izquierda, derecha, `${caso}: las columnas no se fusionan`);
    assert.ok(!izquierda.bilateral && !derecha.bilateral, caso);
    assert.equal(izquierda.colorPattern, espiral.prompt_lora);
    assert.equal(derecha.colorPattern, patrones.length > 1 ? anillos.prompt_lora : undefined);
    for (const patronDeCaso of patrones) assert.equal(vecesEn(resultado.prompt, patronDeCaso.prompt_lora), 1, `${caso}: ${resultado.prompt}`);
    // conciseClause no le quita los colores a una cláusula con patrón: el patrón se arma con ellos.
    assert.ok(resultado.prompt.includes(`a balloon column in white and gold ${espiral.prompt_lora} `), resultado.prompt);
    const reporte = preflight(escena, resultado);
    assert.equal(reporte.ok, true, `${caso}: ${reporte.errors.join("; ")}`);
    assert.equal(reporte.relationships.expected, 0, `${caso}: dos patrones distintos no son una pareja espejo`);
  }

  // El mismo patrón en las dos columnas sí es la misma pareja espejo, con la frase una sola vez.
  const mismo = captionLegacy(xv, [espiral, patron("espiral-columna", { estructura_id: "EST_03_COL_DER" })], "product_v007");
  const pareja = clausulaDe(mismo.clauses, "EST_02_COL_IZQ");
  assert.equal(pareja, clausulaDe(mismo.clauses, "EST_03_COL_DER"));
  assert.equal(pareja.bilateral, true);
  assert.equal(pareja.colorPattern, espiral.prompt_lora);
  assert.equal(vecesEn(mismo.prompt, espiral.prompt_lora), 1, mismo.prompt);
  const reporteMismo = preflight(escena, mismo);
  assert.equal(reporteMismo.ok, true, reporteMismo.errors.join("; "));
  assert.deepEqual([reporteMismo.relationships.expected, reporteMismo.relationships.represented], [1, 1]);

  // Las instancias de UNA estructura repetida comparten patrón y siguen siendo la pareja.
  const repetida = planFijado("qa-lateral-repetida-x2");
  const patronRepetida = patron("espiral-columna", { estructura_id: "EST_02_COLUMNAS" });
  const captionRepetida = captionLegacy(repetida, [patronRepetida], "product_v007", CONTEXTO_CUMPLE);
  const parRepetido = clausulaDe(captionRepetida.clauses, "EST_02_COLUMNAS#1");
  assert.equal(parRepetido, clausulaDe(captionRepetida.clauses, "EST_02_COLUMNAS#2"));
  assert.equal(parRepetido.colorPattern, patronRepetida.prompt_lora);
  const reporteRepetida = preflight(escenaDePlan(repetida), captionRepetida);
  assert.equal(reporteRepetida.ok, true, reporteRepetida.errors.join("; "));
  // Etapa 2 del híbrido: route.ts decide la frase del hard lock con estas cláusulas.
  assert.equal(captionRepetida.clauses.some((clause) => Boolean(clause.colorPattern)), true);
  assert.equal(captionLegacy(repetida, undefined, "product_v007", CONTEXTO_CUMPLE).clauses.some((clause) => Boolean(clause.colorPattern)), false);
  console.log("[PASS] agrupación: patrones distintos nunca se fusionan, el mismo patrón conserva la pareja espejo y el preflight lo espera así");
}

/** La compactación nunca quita el patrón; si no cabe, el preflight falla cerrado. */
function compactacionConPatron(): void {
  // Cabe compactando: el patrón queda entero.
  const arco = patron("espiral-columna", { estructura_id: "EST_01_ARCO", prompt_lora: "wrapped in a spiral of pink and gold stripes winding from the left base over the top to the right base" });
  const columnas = captionCanonico(ESCENA_COLUMNAS, TALLAS_COLUMNAS, CONTEXTO_XV, [arco]);
  assert.ok(columnas.diagnostics.some((linea) => /prompt compacted to render step [1-9]/.test(linea)), columnas.diagnostics.join(" | "));
  assert.ok(columnas.prompt.includes(arco.prompt_lora));

  // No cabe ni en el último paso: se descartan cola y escenario, nunca el patrón, y el preflight falla por longitud.
  for (const [trigger, ultimoPaso] of [["eventdecor_style_v2", 9], [undefined, 8]] as const) {
    const cargada = captionCanonico(ESCENA_CARGADA, TALLAS_CARGADA, CONTEXTO_BODA, [arco], trigger);
    assert.ok(cargada.diagnostics.some((linea) => linea.includes(`render step ${ultimoPaso} `)), `${trigger}: ${cargada.diagnostics.join(" | ")}`);
    assert.equal(vecesEn(cargada.prompt, arco.prompt_lora), 1, cargada.prompt);
    assert.doesNotMatch(cargada.prompt, /\bset in\b|elegant event decor|natural depth/, "la cola y el escenario se van antes que el patrón");
    assert.ok(cargada.prompt.length > LORA_PROMPT_MAX_LENGTH, `${cargada.prompt.length}`);
    const reporte = preflight(ESCENA_CARGADA, cargada);
    assert.equal(reporte.ok, false);
    assert.match(reporte.errors.join("; "), new RegExp(`longitud \\d+ supera límite ${LORA_PROMPT_MAX_LENGTH}`));
    assert.doesNotMatch(reporte.errors.join("; "), /patrón de color/);
  }
  console.log("[PASS] compactación: el patrón nunca se recorta; lo que no cabe falla cerrado en el preflight");
}

/**
 * Frontera con la salida REAL de Python: los vectores dorados que traen
 * `patrones_color` (su bloque `expected_python`, que se regenera con el
 * resolutor) pasan por los dos constructores con las comprobaciones de
 * route.ts. TypeScript inserta cada frase tal cual y nunca la traduce, así que
 * `prompt_lora` tiene que llegar en inglés ASCII y sin nada que el escapado JSON
 * altere; si no, el control de idioma (LORA_LANGUAGE_FAILED) o el preflight la
 * rechazan y la generación LoRA falla cerrada. Mejor aquí que en producción.
 */
function vectoresDoradosConPatron(): void {
  const vectores = loadVectors().flatMap(({ file, vector }) => {
    const resultado = vector.expected_python;
    if (!resultado?.plan_resuelto.patrones_color?.length) return [];
    const fijado: PlanFijadoDeFixture = { plan: planResueltoDesdePython(resultado.plan_resuelto), materialEstimate: resultado.material_estimate };
    return [{ nombre: basename(file, ".json"), fijado, patrones: resultado.plan_resuelto.patrones_color }];
  });
  assert.ok(vectores.length >= 3, `se esperaban los vectores dorados con patrón (29, 30, 31); hay ${vectores.length}`);
  for (const { nombre, fijado, patrones } of vectores) {
    const prompt = promptGemini(fijado, patrones);
    for (const patronDelPlan of patrones) {
      if (patronDelPlan.prompt_gemini) assert.ok(prompt.includes(patronDelPlan.prompt_gemini), `${nombre}: falta la frase Gemini de ${patronDelPlan.estructura_id}`);
    }
    const escena = escenaDePlan(fijado);
    const coherencia = verificarCoherenciaPrompt(prompt, fijado.plan, escenaParaCoherencia(escena));
    assert.equal(coherencia.ok, true, `${nombre}: ${coherencia.errores.join("; ")}`);

    for (const dialect of ["product_v007", "scene_v004"] as const) {
      const caso = `${nombre} (${dialect})`;
      const caption = captionLegacy(fijado, patrones, dialect, CONTEXTO_CUMPLE);
      for (const patronDelPlan of patrones) {
        if (patronDelPlan.prompt_lora) assert.equal(vecesEn(caption.prompt, patronDelPlan.prompt_lora), 1, `${caso}: ${caption.prompt}`);
      }
      const json = ensureLoraTriggers(caption.jsonPrompt, [{ path: "patron-color", trigger: "eventdecor_style_v2", scale: 1 }]);
      const fugas = findLoraPromptLanguageLeaks(`${caption.prompt} ${json}`);
      assert.deepEqual(fugas, [], `${caso}: Python escribió prompt_lora con texto que el LoRA rechaza (${fugas.join(", ")}): ${patrones.map((patronDelPlan) => JSON.stringify(patronDelPlan.prompt_lora)).join(", ")}. La frase la redacta services/ai-api/app/patron_color.py (ADR-0028 §8): tiene que salir en inglés ASCII; TypeScript no la traduce.`);
      const reporte = preflight(escena, caption);
      assert.equal(reporte.ok, true, `${caso}: ${reporte.errors.join("; ")}`);
      const reporteJson = preflight(escena, caption, json, LORA_JSON_PROMPT_MAX_LENGTH);
      assert.equal(reporteJson.ok, true, `${caso} JSON: ${reporteJson.errors.join("; ")}`);
      const colores = verificarColoresCaptionLora(fijado.plan, escenaParaCoherencia(escena), { clausulas: caption.clauses, traducirColor: translateLoraColor });
      assert.equal(colores.ok, true, `${caso}: ${colores.errores.join("; ")}`);
    }
  }
  console.log(`[PASS] frontera con Python: las frases reales de ${vectores.length} vectores dorados con patrón pasan coherencia, el control de idioma y el preflight del LoRA`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error: unknown) {
    console.error(error);
    process.exit(1);
  }
}
