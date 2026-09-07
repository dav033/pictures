import assert from "node:assert/strict";
import { compilarDescriptorProductoPerceptual, assertDescriptorPerceptualSeguro } from "../src/lib/lora/descriptor-perceptual";
import { SceneSpecSchema } from "../src/lib/ia/scene-spec";
import { compileLoraCaption } from "../src/lib/ia/lora-caption-compiler";
import { preflightLoraPrompt } from "../src/lib/ia/lora-prompt-preflight";
import { buildVisualContext } from "../src/lib/ia/visual-context";
import { ensureLoraTriggers } from "../src/lib/ia/sempertex-lora";

const concept = {
  concept_id: "fixture.halloween.printed.balloon",
  canonical_label: "round latex balloon with a Reflex high-shine Halloween print",
  visual: {
    family: "Reflex",
    shape: "round",
    material: "latex",
    color: "black",
    finish: "Reflex high-shine",
    pattern: { kind: "printed", motif: "black bats and white ghosts", contains_text: false },
  },
  aliases: { es: [], en: [], contextual: [] },
  catalog_product_ids: ["V-HALLOWEEN"],
  sizes: { separate: true as const, allowed_codes: ["R-12"] },
  status: "active" as const,
  vocabulary_version: "product-vocabulary.v1",
};

const scene = SceneSpecSchema.parse({
  schema_version: "1.1",
  generation_mode: "text_to_image",
  canvas: { aspect_ratio: "3:2", content_rect: { x: 0, y: 0, width: 1, height: 1 } },
  venue: {
    preserve: [],
    anchors: [{ anchor_id: "ANC_PUERTA", tipo: "puerta", evidencia: "doorway visible in approved venue photo", bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 } }],
    protected_regions: [],
    editable_regions: [],
  },
  elements: [
    {
      element_id: "EST_01_ARANA",
      name: "Araña fixture",
      category: "balloon_structure",
      source_type: "catalog_backed",
      catalog_product_id: "V-HALLOWEEN",
      catalog_product_ids: ["V-HALLOWEEN"],
      required: true,
      quantity: { mode: "exact", min: 18, max: 18 },
      target_bbox: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
      depth_layer: 10,
      resolved_colors: ["black"],
      resolved_finishes: ["Reflex high-shine"],
      identity_constraints: ["round latex balloon in black, printed with black bats and white ghosts"],
      visual_semantics: { structure_type: "escultura", placement: "entrada", design_role: "focal", repetition_group: "spider", density: "lujosa" },
      element_kind: "balloon_structure",
      quantity_semantics: "material_units",
      physical_form: {
        categoria_sujeto: "animal",
        sujeto: "spider",
        descripcion_perceptual_en: "a balloon spider sculpture with a rounded body, eight thin legs, and small contrasting eyes",
        partes: [
          { parte_id: "body", funcion: "volumen_principal", descriptor_perceptual_en: "rounded body", variant_ids: ["V-HALLOWEEN"] },
          { parte_id: "legs", funcion: "extremidad", descriptor_perceptual_en: "eight thin legs", variant_ids: ["V-HALLOWEEN"] },
        ],
      },
      catalog_visual: {
        descriptor_perceptual_en: "round latex balloon in black, printed with black bats and white ghosts",
        pattern: { kind: "printed", motif: "black bats and white ghosts", text_policy: "none" },
      },
      physical_relations: [{ relacion: "enmarcar", target: { kind: "ancla_espacio", id: "ANC_PUERTA" }, prioridad: "primaria" }],
      relationships: [],
    },
    {
      element_id: "PROP_01_CALABAZAS",
      name: "props fixture",
      category: "other",
      source_type: "catalog_backed",
      catalog_product_id: "V-HALLOWEEN",
      catalog_product_ids: ["V-HALLOWEEN"],
      required: true,
      quantity: { mode: "exact", min: 3, max: 3 },
      target_bbox: { x: 0.25, y: 0.7, width: 0.5, height: 0.2 },
      depth_layer: 20,
      resolved_colors: ["orange"],
      identity_constraints: ["three small decorative pumpkins"],
      visual_semantics: { structure_type: "accesorio", placement: "piso_frontal", design_role: "acento", repetition_group: "pumpkins", density: "media" },
      element_kind: "catalog_prop",
      quantity_semantics: "physical_instances",
      catalog_visual: {
        descriptor_perceptual_en: "small orange decorative pumpkins with a matte surface",
        pattern: { kind: "solid", text_policy: "none" },
      },
      physical_relations: [{ relacion: "apoyarse_en", target: { kind: "elemento_plan", id: "EST_01_ARANA" }, prioridad: "primaria" }],
      relationships: [],
    },
  ],
  positive_prompt: { required_elements: [], composition: [], venue_preservation: [], photorealistic_integration: [] },
  negative_prompt: { forbidden_elements: [], forbidden_venue_changes: [], forbidden_compositing_artifacts: [] },
  metadata: { created_by: "server_default", plan_hash: "fixture-rich-plan" },
});

const descriptor = compilarDescriptorProductoPerceptual(concept);
assert.match(descriptor, /printed with black bats and white ghosts/i);
assert.doesNotMatch(descriptor, /Reflex|SKU|price|paquete/i);
assert.doesNotThrow(() => assertDescriptorPerceptualSeguro(descriptor));
assert.throws(() => assertDescriptorPerceptualSeguro("Reflex high-shine SKU 123"), /descriptor perceptual/i);

const compilation = compileLoraCaption({
  sceneSpec: scene,
  visualContext: buildVisualContext({ userRequest: "Halloween en la puerta" }),
  productConcepts: [{ elementId: "EST_01_ARANA", conceptId: concept.concept_id, canonicalLabel: descriptor }],
});
assert.match(compilation.prompt, /balloon spider sculpture/i);
assert.match(compilation.prompt, /framing the doorway/i);
assert.match(compilation.prompt, /black bats and white ghosts/i);
assert.match(compilation.prompt, /three .*pumpkins/i);
assert.doesNotMatch(compilation.prompt, /Reflex|SKU|precio|paquete|EST_01|PROP_01/i);

const preflight = preflightLoraPrompt({ sceneSpec: scene, clauses: compilation.clauses, prompt: compilation.prompt });
assert.equal(preflight.ok, true, preflight.errors.join("; "));
assert.deepEqual(preflight.structures, { expected: 2, represented: 2 });
assert.deepEqual(preflight.locations, { expected: 2, represented: 2 });
assert.equal(preflight.productLeaks.length, 0);

const payloadPrompt = ensureLoraTriggers(compilation.prompt, [{
  path: "https://example.test/artifact.safetensors",
  trigger: "eventdecor_style_v2",
  scale: 0.6,
}]);
assert.equal(payloadPrompt, "eventdecor_style_v2, " + compilation.prompt.replace(/^eventdecor_style_v2,\s*/i, ""));

console.log("Rich composition contract: OK");
