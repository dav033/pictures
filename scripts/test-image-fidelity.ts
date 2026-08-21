import assert from "node:assert/strict";
import { buildImagePrompt } from "@/lib/ia/build-image-prompt";
import { ReferenceBlueprintV2Schema } from "@/lib/ia/reference-blueprint";
import { buildApprovedSceneSpec, resolveElementColors } from "@/lib/ia/scene-spec";
import { resolveAspectTransform } from "@/lib/ia/aspect-transform";

const blueprint = ReferenceBlueprintV2Schema.parse({
  schema_version: "2.0",
  source_images: [{ image_id: "REF_01", approved_roles: ["element_reference", "composition_reference", "palette_reference"] }],
  elements: [{
    element_id: "REF_01_E01", source_image_id: "REF_01", name: "fabric curtain backdrop", category: "curtain", scene_role: "backdrop", detection_confidence: 0.86, visible_evidence: "Pleated fabric spans the rear center.", reference_bbox: { x: 0.18, y: 0.05, width: 0.64, height: 0.82 }, depth_layer: 1, include_policy: "include", approved: true, source_type: "catalog_backed", quantity: { mode: "approximate", min: 1, max: 1 }, appearance: { observed_colors: ["warm beige"], resolved_colors: [], color_policy: "adapt_to_event_palette", material: "soft pleated fabric", shape: "floor-length rectangular drape" }, relationships: [], uncertainties: [], model_decision: { action: "include", catalog_product_id: "cat-curtain", match_type: "closest", reason: "Closest catalog curtain.", adaptation: "Adapt reference color to catalog color." },
  }, {
    element_id: "REF_01_E02", source_image_id: "REF_01", name: "unapproved table", category: "furniture", scene_role: "foreground", detection_confidence: 0.45, visible_evidence: "Possible table edge.", reference_bbox: { x: 0.1, y: 0.7, width: 0.3, height: 0.2 }, depth_layer: 2, include_policy: "exclude", approved: false, source_type: "reference_only", quantity: { mode: "approximate", min: 1, max: 1 }, appearance: { observed_colors: ["brown"], resolved_colors: [], color_policy: "match_reference", material: "wood", shape: "rectangular table" }, relationships: [], uncertainties: ["partially occluded"],
  }],
  composition: { focal_point: "balloon installation over curtain", density: "dense", symmetry: "asymmetric", negative_space: ["upper-right edge"] },
  palette: { observed: ["warm beige", "cream", "muted gold"], priority: ["cream", "muted gold"] },
  unresolved_decisions: [],
});

assert.throws(() => ReferenceBlueprintV2Schema.parse({ ...blueprint, unexpected: true }));
assert.deepEqual(resolveElementColors({ policy: "adapt_to_event_palette", eventPalette: ["ivory"], observedColors: ["beige"] }), ["ivory"]);
assert.deepEqual(resolveElementColors({ override: ["blue"], policy: "adapt_to_event_palette", eventPalette: ["ivory"], observedColors: ["beige"] }), ["blue"]);

const scene = buildApprovedSceneSpec({ blueprint, aspectRatio: "16:9", venueImageId: "VENUE_01", targetBoxes: { REF_01_E01: { x: 0.25, y: 0.1, width: 0.45, height: 0.75 } }, eventPalette: ["ivory"], catalogProducts: { "REF_01_E01": [{ id: "cat-curtain", name: "fabric curtain backdrop", description: "soft pleated fabric curtain", category: "curtain", colors: ["ivory"], share: 1, role: "material principal" }] } });
assert.equal(scene.elements.length, 1);
assert.deepEqual(scene.elements[0].resolved_colors, ["ivory"]);
const prompt = buildImagePrompt({ sceneSpec: scene, inputs: [{ image_id: "VENUE_01", role: "venue_base", allowed_use: "venue identity" }, { image_id: "REF_01", role: "composition_reference", allowed_use: "composition only" }] });
assert.match(prompt, /fabric curtain backdrop/);
assert.match(prompt, /No decorative object absent from the automatic element allowlist/);
assert.match(prompt, /Never copy a source-image border/);
assert.match(prompt, /Reference images were analyzed upstream/);
assert.match(prompt, /CATALOG_\* image as the only visual source/);
assert.match(prompt, /Every catalog-backed element .* mandatory quoted line item/);
assert.match(scene.positive_prompt.required_elements[0], /MANDATORY VISIBLE CATALOG ITEM/);
assert.match(prompt, /OUTPUT FORMAT/);
assert.match(prompt, /Never render catalog IDs/);
assert.match(prompt, /Catalog color lock/);
assert.match(prompt, /black product must remain black/);
assert.match(scene.positive_prompt.photorealistic_integration.join(" "), /reference palette cannot recolor catalog items/);
assert.doesNotMatch(prompt, /target_bbox|depth layer|Layer \d|"bbox"/i);
assert.match(prompt, /Never draw placement guides/);
assert.match(prompt, /green or yellow outlines/);
assert.doesNotMatch(prompt, /references never provide objects/i);
assert.match(buildImagePrompt({ sceneSpec: { ...scene, generation_mode: "revise_current_result" }, revisionInstruction: "make curtain ivory" }), /REVISION DELTA/);
assert.equal(resolveAspectTransform("16:9", { exactAspectRatios: ["3:2", "1:1", "2:3"], totalInputImageLimit: 16, objectFidelityInputLimit: 5, highFidelityInputSupport: false, multiTurnSupport: false }).strategy, "pad");

// Bill of materials: un elemento (árbol de globos) armado con tres productos
// distintos en proporciones distintas — nunca debe colapsar a "usa este
// único producto exacto" ni perder los colores de los materiales secundarios.
const treeBlueprint = ReferenceBlueprintV2Schema.parse({
  schema_version: "2.0",
  source_images: [{ image_id: "REF_01", approved_roles: ["element_reference"] }],
  elements: [{
    element_id: "REF_01_E01", source_image_id: "REF_01", name: "balloon Christmas tree", category: "balloon_structure", scene_role: "foreground", detection_confidence: 0.8, visible_evidence: "Cone-shaped cluster of round balloons.", reference_bbox: { x: 0.1, y: 0.1, width: 0.3, height: 0.6 }, depth_layer: 3, include_policy: "include", approved: true, source_type: "catalog_backed", quantity: { mode: "approximate", min: 60, max: 60 }, appearance: { observed_colors: ["red", "green", "gold"], resolved_colors: [], color_policy: "match_reference", material: "latex balloons", shape: "cone-shaped tree", composition: "60% red round balloons at the base, 30% green climbing the sides, 10% gold accents near the top" }, relationships: [], uncertainties: [], model_decision: { action: "include", catalog_product_id: "cat-red", match_type: "closest", reason: "Closest catalog balloon match.", adaptation: "Combine three balloon colors into a hand-built cone.", bill_of_materials: [{ catalog_product_id: "cat-red", role: "base balloons", share: 0.6 }, { catalog_product_id: "cat-green", role: "side balloons", share: 0.3 }, { catalog_product_id: "cat-gold", role: "top accents", share: 0.1 }] },
  }],
  composition: { focal_point: "balloon tree", density: "dense", symmetry: "symmetric", negative_space: [] },
  palette: { observed: ["red", "green", "gold"], priority: ["red", "green", "gold"] },
  unresolved_decisions: [],
});
const treeScene = buildApprovedSceneSpec({
  blueprint: treeBlueprint,
  aspectRatio: "16:9",
  targetBoxes: { REF_01_E01: { x: 0.1, y: 0.1, width: 0.3, height: 0.6 } },
  catalogProducts: {
    REF_01_E01: [
      { id: "cat-red", name: "Globo Redondo Rojo", description: "Paquete de globos redondos rojos", category: "globo_latex", colors: ["rojo"], unitsPerPackage: 50, packageCount: 1, share: 0.6, role: "base balloons" },
      { id: "cat-green", name: "Globo Redondo Verde", description: "Paquete de globos redondos verdes", category: "globo_latex", colors: ["verde"], unitsPerPackage: 50, packageCount: 1, share: 0.3, role: "side balloons" },
      { id: "cat-gold", name: "Globo Metalizado Dorado", description: "Paquete de globos metalizados dorados", category: "globo_latex", colors: ["dorado"], unitsPerPackage: 50, packageCount: 1, share: 0.1, role: "top accents" },
    ],
  },
});
assert.equal(treeScene.elements.length, 1);
assert.deepEqual(treeScene.elements[0].catalog_product_ids, ["cat-red", "cat-green", "cat-gold"]);
assert.deepEqual(new Set(treeScene.elements[0].resolved_colors), new Set(["rojo", "verde", "dorado"]));
const treeIdentity = treeScene.elements[0].identity_constraints.join(" | ");
assert.match(treeIdentity, /60% base balloons = "Globo Redondo Rojo"/);
assert.match(treeIdentity, /30% side balloons = "Globo Redondo Verde"/);
assert.match(treeIdentity, /10% top accents = "Globo Metalizado Dorado"/);
assert.match(treeIdentity, /never render only one of them alone/);
assert.ok(treeScene.elements[0].identity_constraints.every((constraint) => constraint.length <= 220), "no identity_constraint should be truncated mid-word past the schema limit");
const treePrompt = buildImagePrompt({ sceneSpec: treeScene, inputs: [{ image_id: "CATALOG_01", role: "catalog_product_reference", allowed_use: "material identity" }] });
assert.match(treePrompt, /balloon Christmas tree/);
assert.match(treePrompt, /Globo Redondo Rojo/);
assert.match(treePrompt, /Globo Redondo Verde/);
assert.match(treePrompt, /Globo Metalizado Dorado/);

console.log("image-fidelity tests: ok");
