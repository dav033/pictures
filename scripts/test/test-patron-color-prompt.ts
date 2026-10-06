import assert from "node:assert/strict";
import type { SceneSpec } from "@/lib/ia/escena/scene-spec";
import { buildVisualContext } from "@/lib/ia/escena/visual-context";
import { compileFluxCaption } from "@/lib/ia/kagutsuchi/caption-flux";
import { preflightFluxPrompt } from "@/lib/ia/kagutsuchi/preflight-flux";

const sceneSpec: SceneSpec = {
  schema_version: "1.0", generation_mode: "text_to_image",
  canvas: { aspect_ratio: "3:2", content_rect: { x: 0, y: 0, width: 1, height: 1 } },
  venue: { preserve: [], protected_regions: [], editable_regions: [] },
  elements: [{
    element_id: "ARC", name: "Arco orgánico", category: "balloon_structure", source_type: "reference_only", required: true,
    quantity: { mode: "exact", min: 1, max: 1 }, target_bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.7 }, depth_layer: 10,
    resolved_colors: ["dorado", "negro"], visual_semantics: { structure_type: "arco", placement: "arco_central", design_role: "focal", repetition_group: "ARC", density: "media" },
    identity_constraints: [], relationships: [],
  }],
  positive_prompt: { required_elements: [], composition: [], venue_preservation: [], photorealistic_integration: [] },
  negative_prompt: { forbidden_elements: [], forbidden_venue_changes: [], forbidden_compositing_artifacts: [] },
  metadata: { created_by: "server_default", plan_hash: "patron-color-base" },
};
const promptFlux = "wrapped in a spiral of gold and black stripes winding from the left base over the top to the right base";
const compilation = compileFluxCaption({
  sceneSpec,
  visualContext: buildVisualContext({ userRequest: "arco dorado y negro en salón" }),
  colorPatterns: [{ estructura_id: "ARC", aplicado: true, prompt_gemini: "", prompt_lora: promptFlux }],
});
const clause = compilation.clauses.find((item) => item.elementIds.includes("ARC"));
assert.equal(clause?.colorPattern, promptFlux);
assert.equal(compilation.prompt.split(promptFlux).length - 1, 1);
assert.equal(preflightFluxPrompt({ sceneSpec, clauses: compilation.clauses, prompt: compilation.prompt }).ok, true);
const altered = preflightFluxPrompt({ sceneSpec, clauses: compilation.clauses, prompt: compilation.prompt.replace("wrapped in a spiral", "wrapped in a swirl") });
assert.equal(altered.ok, false);
assert.match(altered.errors.join("; "), /patrón de color ausente o alterado/);
console.log("Patrones de color en FLUX base: OK");
