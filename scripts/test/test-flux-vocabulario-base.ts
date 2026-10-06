import assert from "node:assert/strict";
import type { SceneSpec } from "../../src/lib/ia/escena/scene-spec";
import { buildVisualContext } from "../../src/lib/ia/escena/visual-context";
import { compileProductPrompt } from "../../src/lib/ia/kagutsuchi/producto-flux";
import { findFluxPromptProductLeaks, preflightFluxPrompt } from "../../src/lib/ia/kagutsuchi/preflight-flux";
import { referenciaDelTitulo } from "../../src/lib/plan/referencia-sempertex";
import { colorDeReferencia } from "../../src/lib/ia/kagutsuchi/vocabulario-base";

const id = "7109611258049";
const sceneSpec: SceneSpec = {
  schema_version: "1.0", generation_mode: "text_to_image",
  canvas: { aspect_ratio: "3:2", content_rect: { x: 0, y: 0, width: 1, height: 1 } },
  venue: { preserve: [], protected_regions: [], editable_regions: [] },
  elements: [{
    element_id: "ARC", name: "Arco dorado", category: "balloon_structure", source_type: "catalog_backed",
    catalog_product_id: id, catalog_product_ids: [id], required: true,
    quantity: { mode: "exact", min: 1, max: 1 }, target_bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.7 }, depth_layer: 10,
    resolved_colors: ["dorado"], visual_semantics: { structure_type: "arco", placement: "arco_central", design_role: "focal", repetition_group: "arc", density: "media" },
    identity_constraints: [], relationships: [],
  }],
  positive_prompt: { required_elements: [], composition: [], venue_preservation: [], photorealistic_integration: [] },
  negative_prompt: { forbidden_elements: [], forbidden_venue_changes: [], forbidden_compositing_artifacts: [] },
  metadata: { created_by: "server_default", plan_hash: "base-vocabulary-test" },
};
const compiled = compileProductPrompt({
  sceneSpec,
  visualContext: buildVisualContext({ userRequest: "cumpleaños en salón" }),
  productCatalogTitles: new Map([[id, "B2b Globo Latex Redondo Reflex Dorado"]]),
});
assert.equal(compiled.legacy, false);
assert.match(compiled.prompt, /gold/i);
assert.doesNotMatch(compiled.prompt, /Reflex|eventdecor_style|SKU|7109611258049/i);
assert.equal(preflightFluxPrompt({ sceneSpec, clauses: compiled.clauses, prompt: compiled.prompt }).ok, true);
assert.equal(findFluxPromptProductLeaks("SKU 10 pack x 6 COP 25").length, 3);
assert.deepEqual(findFluxPromptProductLeaks(compiled.prompt), []);
console.log("FLUX base vocabulary: OK");

const colorDeTitulo = (titulo: string, acabado: string) => {
  const referencia = referenciaDelTitulo(titulo, acabado);
  assert.ok(referencia, `sin referencia de catálogo: ${titulo}`);
  return colorDeReferencia(referencia);
};

assert.match(colorDeTitulo("B2b Globo Latex Redondo Silk Rosa Primaveral", "satin pearlescent"), /(?:pale|light).*blush pink|blush pink/i);
assert.match(colorDeTitulo("B2b Globo Latex Redondo Pastel Mate Nude", "soft matte"), /(?:pale|light|muted).*nude beige|nude beige/i);
assert.match(colorDeTitulo("B2b Globo Latex Redondo Reflex Plata", "reflective chrome"), /bright silver/i);
assert.equal(colorDeTitulo("B2b Globo Latex Redondo Reflex Dorado", "reflective chrome"), "gold");
assert.match(colorDeTitulo("B2b Globo Latex Redondo Fashion Azul Naval", "matte"), /navy blue/i);
assert.equal(colorDeTitulo("B2b Globo Latex Redondo Fashion Blanco", "matte"), "white (#FFFFFF)");
// Colores vivos: el nombre comercial no los aclara y FLUX recibe el hex real del globo (2026-10-06).
assert.equal(colorDeTitulo("B2b Globo Latex Redondo Fashion Rosa", "matte"), "vivid pink (#E04B87)");
assert.equal(colorDeTitulo("B2b Globo Latex Redondo Fashion Azul", "matte"), "vivid cyan blue (#01B2E8)");
assert.doesNotMatch(colorDeTitulo("B2b Globo Latex Redondo Reflex Plata", "mirror-like chrome"), /#/, "en cromados el hex engaña: solo palabras");
const captionDeTitulo = (titulo: string) => compileProductPrompt({
  sceneSpec,
  visualContext: buildVisualContext({ userRequest: "cumpleaños en salón" }),
  productCatalogTitles: new Map([[id, titulo]]),
}).prompt;
assert.match(captionDeTitulo("B2b Globo Latex Redondo Silk Rosa Primaveral"), /blush pink.*pearlescent|pearlescent.*blush pink/i);
assert.match(captionDeTitulo("B2b Globo Latex Redondo Pastel Mate Nude"), /(?:pale|light|muted).*nude beige/i);
assert.match(captionDeTitulo("B2b Globo Latex Redondo Reflex Plata"), /bright silver.*reflective chrome|reflective chrome.*bright silver/i);
assert.doesNotMatch(captionDeTitulo("B2b Globo Latex Redondo Reflex Plata"), /reflecting the room/i);
console.log("Perceptual catalog colors (pink, nude, chrome silver, gold, navy, white): OK");
