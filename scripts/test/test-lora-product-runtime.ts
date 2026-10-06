import assert from "node:assert/strict";
import type { SceneSpec } from "../../src/lib/ia/escena/scene-spec";
import { buildVisualContext } from "../../src/lib/ia/escena/visual-context";
import { compileProductPrompt, sizeConfirmationsFromMaterialLines } from "../../src/lib/ia/kagutsuchi/lora-product-runtime";
import { findLoraPromptProductLeaks, preflightLoraPrompt } from "../../src/lib/ia/kagutsuchi/lora-prompt-preflight";

const producto = "7109611258049";
const escena: SceneSpec = {
  schema_version: "1.0",
  generation_mode: "text_to_image",
  canvas: { aspect_ratio: "3:2", content_rect: { x: 0, y: 0, width: 1, height: 1 } },
  venue: { preserve: [], protected_regions: [], editable_regions: [] },
  elements: [{
    element_id: "EST_01_ARCO", name: "Arco dorado", category: "balloon_structure", source_type: "catalog_backed",
    catalog_product_id: producto, catalog_product_ids: [producto], required: true,
    quantity: { mode: "exact", min: 1, max: 1 }, target_bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.7 }, depth_layer: 10,
    resolved_colors: ["dorado"], visual_semantics: { structure_type: "arco", placement: "arco_central", design_role: "focal", repetition_group: "arco", density: "media" },
    identity_constraints: [], relationships: [],
  }],
  positive_prompt: { required_elements: [], composition: [], venue_preservation: [], photorealistic_integration: [] },
  negative_prompt: { forbidden_elements: [], forbidden_venue_changes: [], forbidden_compositing_artifacts: [] },
  metadata: { created_by: "server_default", plan_hash: "runtime-test" },
};
const contexto = buildVisualContext({ userRequest: "cumpleaños en salón" });
const resultado = compileProductPrompt({
  sceneSpec: escena,
  visualContext: contexto,
  productCatalogTitles: new Map([[producto, "B2b Globo Latex Redondo Reflex Dorado"]]),
  sizeConfirmations: [{ elementId: "EST_01_ARCO", productId: producto, sizeCode: "R-12", diameterInches: 12 }],
});

assert.equal(resultado.legacy, false);
assert.deepEqual(resultado.unresolved_products, []);
assert.match(resultado.prompt, /12-inch/);
assert.match(resultado.prompt, /gold/);
assert.doesNotMatch(resultado.prompt, /Reflex|SKU|7109611258049/i);
assert.equal(preflightLoraPrompt({ sceneSpec: escena, clauses: resultado.clauses, prompt: resultado.prompt }).ok, true);
assert.ok(findLoraPromptProductLeaks("SKU 123 pack x 4 COP 100").length >= 3);
assert.equal(findLoraPromptProductLeaks("B2B-20014535, package of 50, $120").length, 3);
assert.deepEqual(findLoraPromptProductLeaks("a golden balloon arch"), []);
assert.deepEqual(sizeConfirmationsFromMaterialLines(
  [{ structure_id: "EST_01_ARCO", product_id: producto }],
  [{ id: producto, tamanoCodigo: "R-12", diamPulg: 12 }],
), [{ elementId: "EST_01_ARCO", productId: producto, sizeCode: "R-12", diameterInches: 12 }]);
console.log("LoRA product runtime base: OK");
