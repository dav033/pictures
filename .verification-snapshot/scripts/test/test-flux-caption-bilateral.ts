/**
 * Regresión de la pareja lateral espejo en el caption LoRA.
 *
 * El defecto: cuando las dos estructuras laterales son las ÚNICAS del plan, la
 * cláusula fusionada es también la focal, y `resolveRelations`
 * (`caption-flux.ts`) descarta la focal con `continue` antes de
 * asignarle `flanking`. Sin esa relación el render caía en "standing apart on
 * the left" —las dos columnas a la izquierda— y el preflight exigía justo la
 * frase espejo, así que `/api/generate` lanzaba FLUX_PREFLIGHT_FAILED y la
 * petición no producía imagen alguna.
 *
 * Ninguno de los 24 planes congelados tiene esa forma, así que la batería no
 * podía verla. Estos tres casos la fijan.
 *
 * Sin red ni llamadas pagadas.
 *   npx tsx --conditions=react-server scripts/test/test-flux-caption-bilateral.ts
 */
import assert from "node:assert/strict";
import type { SceneSpec } from "../../src/lib/ia/escena/scene-spec";
import { GROUPING_ONLY_CONTEXT, FLUX_PROMPT_MAX_LENGTH } from "../../src/lib/ia/kagutsuchi/caption-flux";
import { FLUX_PRESENTATION_INSTRUCTION } from "./fixtures/gemini-composition-historica";
import { compileProductPrompt, type ElementSizeConfirmation } from "../../src/lib/ia/kagutsuchi/producto-flux";
import { preflightFluxPrompt } from "../../src/lib/ia/kagutsuchi/preflight-flux";


type Elemento = SceneSpec["elements"][number];
type Tipo = "arco" | "columna" | "semiarco";
type Ubicacion = "arco_central" | "lateral_izquierdo" | "lateral_derecho";

const PRODUCTO_POR_COLOR: Readonly<Record<string, string>> = { rosado: "20010671", plateado: "20014244" };

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
    visual_semantics: { structure_type: tipo, placement: ubicacion, design_role: rol, repetition_group: tipo === "arco" ? id : "pareja", density: "media" },
    identity_constraints: [],
    relationships: [],
  } as Elemento;
}

function compilar(elementos: Elemento[]): { prompt: string; ok: boolean; errores: string[] } {
  const spec = {
    schema_version: "1.0",
    generation_mode: "text_to_image",
    canvas: { aspect_ratio: "2:3", content_rect: { x: 0, y: 0, width: 1, height: 1 } },
    venue: { preserve: [], protected_regions: [], editable_regions: [] },
    elements: elementos,
    positive_prompt: { required_elements: [], composition: [], venue_preservation: [], photorealistic_integration: [] },
    negative_prompt: { forbidden_elements: [], forbidden_venue_changes: [], forbidden_compositing_artifacts: [] },
    metadata: { created_by: "server_default", plan_hash: "bilateral" },
  } as SceneSpec;
  const sizeConfirmations: ElementSizeConfirmation[] = elementos.flatMap((el) =>
    (el.catalog_product_ids ?? []).flatMap((productId) => ["R-5", "R-12"].map((sizeCode) => ({ elementId: el.element_id, productId, sizeCode }))),
  );
  const compilacion = compileProductPrompt({
    sceneSpec: spec,
    visualContext: GROUPING_ONLY_CONTEXT,
    sizeConfirmations,
    maxLength: FLUX_PROMPT_MAX_LENGTH - FLUX_PRESENTATION_INSTRUCTION.length,
    ambientDecor: [],
    officialStructures: new Map<string, string>()
});
  const prompt = compilacion.prompt;
  const reporte = preflightFluxPrompt({ sceneSpec: spec, clauses: compilacion.clauses, prompt });
  return { prompt, ok: reporte.ok, errores: reporte.errors };
}

const PAREJA = ["rosado", "plateado"];

// 1) Dos columnas laterales y nada más: la pareja ES la focal.
{
  const r = compilar([
    elemento("EST_01_COL_IZQ", "Columna izquierda", "columna", "lateral_izquierdo", "focal", PAREJA),
    elemento("EST_02_COL_DER", "Columna derecha", "columna", "lateral_derecho", "focal", PAREJA),
  ]);
  assert.ok(r.ok, `dos columnas sin foco deben pasar el preflight; errores: ${r.errores.join("; ")}`);
  assert.match(r.prompt, /one standing on the left and one on the right/, "la pareja debe nombrar los dos lados");
  assert.doesNotMatch(r.prompt, /standing apart on the left/, "las dos columnas no pueden quedar ambas a la izquierda");
}

// 2) Dos semiarcos laterales y nada más: misma forma, otro tipo de estructura.
{
  const r = compilar([
    elemento("EST_01_SEMI_IZQ", "Semiarco izquierdo", "semiarco", "lateral_izquierdo", "soporte", PAREJA),
    elemento("EST_02_SEMI_DER", "Semiarco derecho", "semiarco", "lateral_derecho", "soporte", PAREJA),
  ]);
  assert.ok(r.ok, `dos semiarcos sin foco deben pasar el preflight; errores: ${r.errores.join("; ")}`);
  assert.match(r.prompt, /one standing on the left and one on the right/, "la pareja de semiarcos debe nombrar los dos lados");
  // Auditoría de huérfanas (2026-10-05, CASE-005): sin pieza entre ellas, FLUX cerraba el par en un solo arco.
  assert.match(r.prompt, /one on the right, with open space between them/, "el par sin foco dice que queda separado");
}

// 3) Pareja con arco central: la relación "flanking" no se pierde con el arreglo.
{
  const r = compilar([
    elemento("EST_01_ARCO", "Arco organico", "arco", "arco_central", "focal", PAREJA),
    elemento("EST_02_COL_IZQ", "Columna izquierda", "columna", "lateral_izquierdo", "soporte", PAREJA),
    elemento("EST_03_COL_DER", "Columna derecha", "columna", "lateral_derecho", "soporte", PAREJA),
  ]);
  assert.ok(r.ok, `arco + pareja debe pasar el preflight; errores: ${r.errores.join("; ")}`);
  assert.match(r.prompt, /one standing on the left and one on the right, flanking the main arch/, "con foco la pareja sigue flanqueando");
}

// 4) Lados de tipo distinto: NO son espejo y no deben describirse como tal.
{
  const r = compilar([
    elemento("EST_01_SEMI_DER", "Semiarco derecho", "semiarco", "lateral_derecho", "focal", PAREJA),
    elemento("EST_02_COL_IZQ", "Columna izquierda", "columna", "lateral_izquierdo", "soporte", PAREJA),
  ]);
  assert.doesNotMatch(r.prompt, /one standing on the left and one on the right/, "dos piezas distintas no son una pareja espejo");
}

console.log("[PASS] pareja lateral espejo: 4 casos");
