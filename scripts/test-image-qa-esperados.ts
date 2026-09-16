import assert from "node:assert/strict";
import { describeExpectedQaElement, evaluateSceneQa, parseVisionObservation } from "@/lib/ia/image-qa";
import type { SceneSpec } from "@/lib/ia/scene-spec";

/**
 * Regresión (plan tropical, 2026-09-14): el observador de QA recibía cada
 * elemento esperado solo como "canonical type=kit; canonical placement=entrada"
 * y reportó la figura planeada como "unexpected element". La descripción
 * esperada lleva el nombre del plan y el sustantivo de la estructura oficial.
 * Sin red. Run: npx tsx --conditions=react-server scripts/test-image-qa-esperados.ts
 */

const figura = {
  element_id: "EST_04_FIGURA",
  name: "Figura con globos tropical",
  category: "balloon_structure",
  source_type: "catalog_backed",
  required: true,
  quantity: { mode: "exact", min: 1, max: 1 },
  target_bbox: { x: 0.7, y: 0.2, width: 0.2, height: 0.6 },
  depth_layer: 10,
  resolved_colors: ["verde"],
  visual_semantics: { structure_type: "kit", placement: "entrada", design_role: "acento", repetition_group: "EST_04_FIGURA", density: "media" },
  identity_constraints: [],
  relationships: [],
} as unknown as SceneSpec["elements"][number];

const linea = describeExpectedQaElement(figura);
assert.match(linea, /name="Figura con globos tropical"/);
assert.match(linea, /official structure=balloon sculpture figure/);
assert.match(linea, /canonical placement=entrada/);

const accesorio = describeExpectedQaElement({ ...figura, element_id: "EST_05_BANDEROLA", name: "Banderola tropical", visual_semantics: { ...figura.visual_semantics!, structure_type: "accesorio" } } as SceneSpec["elements"][number]);
assert.match(accesorio, /name="Banderola tropical"/);
assert.doesNotMatch(accesorio, /official structure=/, "an accessory is not described as a balloon structure");

console.log("[PASS] QA visual: los elementos esperados llevan nombre y estructura oficial");

// `appearance_details`: por qué falló la apariencia, no solo el id. Compatible
// con observaciones anteriores al campo y validado en la frontera.
const escena = {
  schema_version: "1.0",
  generation_mode: "text_to_image",
  canvas: { aspect_ratio: "3:2", content_rect: { x: 0, y: 0, width: 1, height: 1 } },
  venue: { preserve: [], protected_regions: [], editable_regions: [] },
  elements: [figura],
  positive_prompt: { required_elements: [], composition: [], venue_preservation: [], photorealistic_integration: [] },
  negative_prompt: { forbidden_elements: [], forbidden_venue_changes: [], forbidden_compositing_artifacts: [] },
  metadata: { created_by: "server_default" },
} as unknown as SceneSpec;

assert.deepEqual(parseVisionObservation({ present_element_ids: ["EST_04_FIGURA"] }).appearanceDetails, [], "una observación anterior al campo se parsea como sin detalle");
const conDetalle = parseVisionObservation({
  present_element_ids: ["EST_04_FIGURA"],
  appearance_failures: ["EST_04_FIGURA"],
  appearance_details: [{ element_id: "EST_04_FIGURA", aspect: "color_proportion", note: "el dorado ocupa la mitad de la figura" }],
});
assert.deepEqual(conDetalle.appearanceDetails, [{ element_id: "EST_04_FIGURA", aspect: "color_proportion", note: "el dorado ocupa la mitad de la figura" }]);
assert.throws(() => parseVisionObservation({ appearance_details: [{ element_id: "EST_04_FIGURA", aspect: "colour", note: "x" }] }), "un aspecto fuera del enum se rechaza");
assert.throws(() => parseVisionObservation({ appearance_details: [{ element_id: "EST_04_FIGURA", aspect: "finish", note: "x".repeat(161) }] }), "una nota más larga que 160 se rechaza");

// El veredicto no cambia: el detalle explica un fallo que ya existía.
const sinDetalle = evaluateSceneQa(escena, { presentElementIds: ["EST_04_FIGURA"], appearanceFailures: ["EST_04_FIGURA"] });
const conDetalleReporte = evaluateSceneQa(escena, conDetalle);
assert.equal(sinDetalle.pass, false);
assert.deepEqual(sinDetalle.appearance_details, []);
assert.deepEqual(conDetalleReporte.retry_reasons, sinDetalle.retry_reasons);
assert.equal(conDetalleReporte.appearance_details.length, 1);
// Un id que la escena no espera no puede colarse al prompt de reintento.
assert.deepEqual(evaluateSceneQa(escena, { presentElementIds: ["EST_04_FIGURA"], appearanceDetails: [{ element_id: "EST_99_INVENTADA", aspect: "form", note: "x" }] }).appearance_details, []);
console.log("[PASS] QA visual: appearance_details opcional, validado y sin ids inventados");
