/**
 * Aísla el fallo `relaciones bilaterales 0/1` del preflight del caption LoRA.
 *
 * Hipótesis: cuando las DOS columnas laterales son las únicas estructuras del
 * plan, la cláusula fusionada es también la focal, y `resolveRelations`
 * (`lora-caption-compiler.ts:750`) descarta la focal con `continue` antes de
 * asignarle `flanking`. Sin esa relación el render cae en "standing apart on
 * the left" (`:1029`) y el preflight exige justo la frase espejo (`:185`), así
 * que /api/generate lanza LORA_PREFLIGHT_FAILED (`route.ts:1148`).
 *
 * Diagnóstico, sin red ni llamadas pagadas.
 *   npx tsx --conditions=react-server scripts/diag-bilateral.ts
 */
import type { SceneSpec } from "../src/lib/ia/escena/scene-spec";
import { GROUPING_ONLY_CONTEXT, LORA_PROMPT_MAX_LENGTH } from "../src/lib/ia/kagutsuchi/lora-caption-compiler";
import { LORA_PRESENTATION_INSTRUCTION } from "../src/lib/ia/uzume/lora-gemini-composition";
import { compileProductPrompt, type ElementSizeConfirmation } from "../src/lib/ia/kagutsuchi/lora-product-runtime";
import { preflightLoraPrompt } from "../src/lib/ia/kagutsuchi/lora-prompt-preflight";
import { ensureLoraTriggers } from "../src/lib/ia/kagutsuchi/sempertex-lora";
import { PRODUCT_VOCABULARY } from "../src/lib/lora/product-vocabulary-data";

const TRIGGER = "eventdecor_style_v2";
type Elemento = SceneSpec["elements"][number];
type Tipo = "arco" | "columna";
type Ubicacion = "arco_central" | "lateral_izquierdo" | "lateral_derecho";

const PRODUCTO_POR_COLOR: Readonly<Record<string, string>> = {
  rosado: "20010671",
  plateado: "20014244",
  blanco: "7109565710529",
};

function elemento(id: string, nombre: string, tipo: Tipo, ubicacion: Ubicacion, rol: "focal" | "soporte", colores: string[]): Elemento {
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
    visual_semantics: { structure_type: tipo, placement: ubicacion, design_role: rol, repetition_group: tipo === "columna" ? "cols" : id, density: "media" },
    identity_constraints: [],
    relationships: [],
  } as Elemento;
}

function escena(elementos: Elemento[]): SceneSpec {
  return {
    schema_version: "1.0",
    generation_mode: "text_to_image",
    canvas: { aspect_ratio: "2:3", content_rect: { x: 0, y: 0, width: 1, height: 1 } },
    venue: { preserve: [], protected_regions: [], editable_regions: [] },
    elements: elementos,
    positive_prompt: { required_elements: [], composition: [], venue_preservation: [], photorealistic_integration: [] },
    negative_prompt: { forbidden_elements: [], forbidden_venue_changes: [], forbidden_compositing_artifacts: [] },
    metadata: { created_by: "server_default", plan_hash: "diag-bilateral" },
  } as SceneSpec;
}

function correr(nombre: string, elementos: Elemento[]): void {
  const spec = escena(elementos);
  const sizeConfirmations: ElementSizeConfirmation[] = elementos.flatMap((el) =>
    (el.catalog_product_ids ?? []).flatMap((productId) => ["R-5", "R-12", "R-18"].map((sizeCode) => ({ elementId: el.element_id, productId, sizeCode }))),
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
  const prompt = ensureLoraTriggers(compilacion.prompt, [{ path: "v004", trigger: TRIGGER, scale: 0.8 }]);
  const preflight = preflightLoraPrompt({ sceneSpec: spec, clauses: compilacion.clauses, prompt, triggers: [TRIGGER], vocabulary: PRODUCT_VOCABULARY });
  const bilateral = compilacion.clauses.find((c) => c.bilateral);
  console.log(`\n### ${nombre}`);
  console.log(`preflight.ok = ${preflight.ok}${preflight.ok ? "" : `  errores=${JSON.stringify(preflight.errors)}`}`);
  console.log(`clausula bilateral: relation=${JSON.stringify(bilateral?.relation)} placement=${bilateral?.placement} salience=${bilateral?.salience}`);
  console.log(`caption: ${prompt}`);
  console.log(`=> /api/generate ${preflight.ok ? "GENERA" : "LANZA LORA_PREFLIGHT_FAILED (route.ts:1148)"}`);
}

const izq = elemento("EST_COL_IZQ", "Columna izquierda", "columna", "lateral_izquierdo", "focal", ["rosado", "plateado"]);
const der = elemento("EST_COL_DER", "Columna derecha", "columna", "lateral_derecho", "focal", ["rosado", "plateado"]);
const arco = elemento("EST_ARCO", "Arco organico", "arco", "arco_central", "focal", ["rosado", "plateado", "blanco"]);
const izqSop = elemento("EST_COL_IZQ", "Columna izquierda", "columna", "lateral_izquierdo", "soporte", ["rosado", "plateado"]);
const derSop = elemento("EST_COL_DER", "Columna derecha", "columna", "lateral_derecho", "soporte", ["rosado", "plateado"]);

correr("A · solo dos columnas laterales (el caso del informe)", [izq, der]);
correr("B · arco central + dos columnas laterales", [arco, izqSop, derSop]);
correr("C · solo dos columnas, rol soporte", [izqSop, derSop]);
