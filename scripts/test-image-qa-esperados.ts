import assert from "node:assert/strict";
import { describeExpectedQaElement } from "@/lib/ia/image-qa";
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
