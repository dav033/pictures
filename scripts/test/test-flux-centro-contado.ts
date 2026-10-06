/**
 * Auditoría de propiedades huérfanas (2026-10-05, CASE-006): el centro de mesa de UN globo burbuja que el plan
 * compra (UI-6) llegaba al caption como «small balloon cluster centerpiece made of ... balloons» y FLUX pintaba
 * un racimo de doce. El conteo ya viajaba en el elemento del plan (`quantity`, material_units) y nadie lo leía.
 *
 * Sin red ni llamadas pagadas.
 *   npx tsx --conditions=react-server scripts/test/test-flux-centro-contado.ts
 */
import assert from "node:assert/strict";
import type { SceneSpec } from "../../src/lib/ia/escena/scene-spec";
import { GROUPING_ONLY_CONTEXT, FLUX_PROMPT_MAX_LENGTH } from "../../src/lib/ia/kagutsuchi/caption-flux";
import { compileProductPrompt } from "../../src/lib/ia/kagutsuchi/producto-flux";
import { FUENTE_PLAN } from "../../src/lib/plan/blueprint";

type Elemento = SceneSpec["elements"][number];

function centro(globos: number, fuente: string | undefined): Elemento {
  return {
    element_id: "EST_02_CENTRO",
    name: "Centro de mesa",
    category: "balloon_structure",
    source_type: "catalog_backed",
    ...(fuente ? { source_image_id: fuente } : {}),
    required: true,
    quantity: { mode: "exact", min: globos, max: globos },
    target_bbox: { x: 0.4, y: 0.6, width: 0.2, height: 0.25 },
    depth_layer: 10,
    resolved_colors: ["transparente"],
    visual_semantics: { structure_type: "centro_mesa", placement: "sobre_mesa_principal", design_role: "acento", repetition_group: "EST_02_CENTRO", density: "media" },
    identity_constraints: [],
    relationships: [],
  } as Elemento;
}

function caption(elemento: Elemento): string {
  const spec = {
    schema_version: "1.0",
    generation_mode: "text_to_image",
    canvas: { aspect_ratio: "3:2", content_rect: { x: 0, y: 0, width: 1, height: 1 } },
    venue: { preserve: [], protected_regions: [], editable_regions: [] },
    elements: [elemento],
    positive_prompt: { required_elements: [], composition: [], venue_preservation: [], photorealistic_integration: [] },
    negative_prompt: { forbidden_elements: [], forbidden_venue_changes: [], forbidden_compositing_artifacts: [] },
    metadata: { created_by: "server_default", plan_hash: "centro" },
  } as SceneSpec;
  return compileProductPrompt({
    sceneSpec: spec,
    visualContext: GROUPING_ONLY_CONTEXT,
    sizeConfirmations: [],
    maxLength: FLUX_PROMPT_MAX_LENGTH,
    ambientDecor: [],
    officialStructures: new Map<string, string>()
}).prompt;
}

// Un globo del plan: se nombra como un solo globo, nunca como racimo.
const uno = caption(centro(1, FUENTE_PLAN));
assert.match(uno, /single-balloon centerpiece/, uno);
assert.doesNotMatch(uno, /cluster/, "un globo no es un racimo");
// Tres del plan: por su número.
assert.match(caption(centro(3, FUENTE_PLAN)), /three-balloon centerpiece/);
// Un centro de verdad (40 globos) sigue con su sustantivo de siempre.
assert.doesNotMatch(caption(centro(40, FUENTE_PLAN)), /-balloon centerpiece/);
// Fuera del plan, `quantity` puede contar piezas: no se lee como globos.
assert.doesNotMatch(caption(centro(1, undefined)), /single-balloon/);

console.log("[PASS] centro de mesa contado: el caption dice cuántos globos lleva");
