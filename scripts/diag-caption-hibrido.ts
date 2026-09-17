/**
 * Imprime el caption LITERAL que el pipeline híbrido (foto del espacio + LoRA)
 * manda hoy a fal, para un diseño de control de dos columnas orgánicas.
 *
 * Replica exactamente la llamada de `src/app/api/generate/route.ts:1066-1080`
 * en modo `usarComposicionLoraGemini`: `ambientDecor = []`,
 * `visualContext = GROUPING_ONLY_CONTEXT` y el techo del caption recortado por
 * `LORA_PRESENTATION_INSTRUCTION`.
 *
 * Diagnóstico, sin red ni llamadas pagadas.
 *   npx tsx --conditions=react-server scripts/diag-caption-hibrido.ts
 */
import type { SceneSpec } from "../src/lib/ia/scene-spec";
import { GROUPING_ONLY_CONTEXT, LORA_PROMPT_MAX_LENGTH } from "../src/lib/ia/lora-caption-compiler";
import { LORA_PRESENTATION_INSTRUCTION, promptPresentacionLora } from "../src/lib/ia/lora-gemini-composition";
import { compileProductPrompt, type ElementSizeConfirmation } from "../src/lib/ia/lora-product-runtime";
import { preflightLoraPrompt } from "../src/lib/ia/lora-prompt-preflight";
import { ensureLoraTriggers } from "../src/lib/ia/sempertex-lora";
import { PRODUCT_VOCABULARY } from "../src/lib/lora/product-vocabulary-data";

const TRIGGER = "eventdecor_style_v2";
type Elemento = SceneSpec["elements"][number];

const PRODUCTO_POR_COLOR: Readonly<Record<string, string>> = {
  rosado: "20010671",
  plateado: "20014244",
  blanco: "7109565710529",
  dorado: "7109611258049",
};

function elemento(id: string, nombre: string, colores: string[], ubicacion: "lateral_izquierdo" | "lateral_derecho"): Elemento {
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
    target_bbox: { x: 0.1, y: 0.1, width: 0.35, height: 0.8 },
    depth_layer: 10,
    resolved_colors: colores,
    visual_semantics: { structure_type: "columna", placement: ubicacion, design_role: "focal", repetition_group: "cols", density: "media" },
    identity_constraints: [],
    relationships: [],
  } as Elemento;
}

const elementos = [
  elemento("EST_01_COL_IZQ", "Columna izquierda", ["rosado", "plateado", "blanco"], "lateral_izquierdo"),
  elemento("EST_02_COL_DER", "Columna derecha", ["rosado", "plateado", "blanco"], "lateral_derecho"),
];

const spec = {
  schema_version: "1.0",
  generation_mode: "text_to_image",
  canvas: { aspect_ratio: "2:3", content_rect: { x: 0, y: 0, width: 1, height: 1 } },
  venue: { preserve: [], protected_regions: [], editable_regions: [] },
  elements: elementos,
  positive_prompt: { required_elements: [], composition: [], venue_preservation: [], photorealistic_integration: [] },
  negative_prompt: { forbidden_elements: [], forbidden_venue_changes: [], forbidden_compositing_artifacts: [] },
  metadata: { created_by: "server_default", plan_hash: "diag-hibrido" },
} as SceneSpec;

const sizeConfirmations: ElementSizeConfirmation[] = elementos.flatMap((el) =>
  (el.catalog_product_ids ?? []).flatMap((productId) =>
    ["R-5", "R-12", "R-18", "R-36"].map((sizeCode) => ({ elementId: el.element_id, productId, sizeCode })),
  ),
);

const compilacion = compileProductPrompt({
  sceneSpec: spec,
  visualContext: GROUPING_ONLY_CONTEXT,
  vocabulary: PRODUCT_VOCABULARY,
  sizeConfirmations,
  trigger: TRIGGER,
  maxLength: LORA_PROMPT_MAX_LENGTH - LORA_PRESENTATION_INSTRUCTION.length,
  ambientDecor: [],
  officialStructures: new Map<string, string>(),
});

const caption = ensureLoraTriggers(compilacion.prompt, [{ path: "v004", trigger: TRIGGER, scale: 0.8 }]);
const final = promptPresentacionLora(caption);
const preflight = preflightLoraPrompt({ sceneSpec: spec, clauses: compilacion.clauses, prompt: caption, triggers: [TRIGGER], vocabulary: PRODUCT_VOCABULARY });

console.log("=== PRESUPUESTO ===");
console.log(`LORA_PROMPT_MAX_LENGTH      ${LORA_PROMPT_MAX_LENGTH}`);
console.log(`LORA_PRESENTATION_INSTRUCTION ${LORA_PRESENTATION_INSTRUCTION.length}`);
console.log(`techo efectivo del diseno   ${LORA_PROMPT_MAX_LENGTH - LORA_PRESENTATION_INSTRUCTION.length}`);
console.log(`\n=== CAPTION COMPILADO (${caption.length} ch) ===\n${caption}`);
console.log(`\n=== LO QUE RECIBE fal HOY (${final.length} ch) ===\n${final}`);
console.log(`\n=== PREFLIGHT ===\nok=${preflight.ok} errores=${JSON.stringify(preflight.errors)}`);
console.log(`\n=== DIAGNOSTICOS DEL COMPILADOR ===\n${compilacion.diagnostics.join("\n")}`);
console.log(`\n=== CLAUSULAS ===\n${compilacion.clauses.map((c) => JSON.stringify(c)).join("\n")}`);
