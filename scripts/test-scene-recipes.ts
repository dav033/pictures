/**
 * Pruebas de la Tarea 01.2 (Registro de recetas) —
 * `PLAN_ARQUITECTURA_ESCENA_COMPLETA_RAG.md`, "Plan 01, Tarea 01.2" en la
 * sección 11.
 *
 * Verifica, contra los contratos Zod reales (`src/lib/scene/tipos.ts`) y la
 * receta real `wedding_ceremony_garden@1` (`src/lib/scene/recipes.ts` +
 * `src/lib/scene/recipes/wedding-ceremony-garden.v1.ts`):
 *
 *   1. `focal_only` — candidatos solo para la estructura focal ⇒ COMPLETE,
 *      sin exigir pasillo/asientos.
 *   2. `balanced_scene` — candidatos completos para focal+decor+pasillo+
 *      asientos, 4 familias distintas ⇒ COMPLETE en balanced_scene.
 *   3. `immersive_scene` — candidatos ricos (≥4 zonas visibles, ≥6
 *      familias) ⇒ COMPLETE en immersive_scene.
 *   4. Degradación explícita — intención `balanced_scene` con candidatos
 *      SOLO para el slot focal ⇒ `achieved_profile: "focal_only"`,
 *      `status: "PARTIAL"`, `required_gaps` no vacío, `requested_profile`
 *      conservado como `"balanced_scene"`.
 *   5. Verdad observable #1 — 10 candidatos en un solo slot vs. 4
 *      candidatos repartidos en 4 slots obligatorios distintos: coberturas
 *      MUY distintas, y la cantidad NUNCA gana sobre la distribución.
 *
 * Mismo estilo de test runner casero (`[PASS]`/`[FAIL]`, contador final,
 * `process.exit(1)` si algo falla) que `scripts/test-scene-contracts.ts` y
 * `scripts/test-scene-invariants.ts`.
 */

import assert from "node:assert/strict";
import { computeCoverageReport } from "../src/lib/scene/coverage";
import { expandIntentToProgram } from "../src/lib/scene/recipes";
import type { CatalogItemV3, EventIntentV2, SlotCandidate } from "../src/lib/scene/tipos";

// ---------------------------------------------------------------------------
// Mini test runner casero (mismo estilo que scripts/test-scene-invariants.ts)
// ---------------------------------------------------------------------------

let passCount = 0;
let failCount = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passCount += 1;
    console.log(`[PASS] ${name}`);
  } catch (error) {
    failCount += 1;
    console.error(`[FAIL] ${name}`);
    console.error(error instanceof Error ? error.message : error);
  }
}

// ---------------------------------------------------------------------------
// Fixtures compartidos
// ---------------------------------------------------------------------------

const RECIPE_ID = "wedding_ceremony_garden@1";

function makeIntent(overrides: Partial<EventIntentV2> = {}): EventIntentV2 {
  return {
    schema_version: "event-intent-v2",
    event_type: "wedding",
    event_scope: "ceremony",
    requested_views: ["ceremony"],
    complexity_requested: "balanced_scene",
    budget_cop: 150_000,
    venue: { environment: "outdoor", existing_asset_refs: [] },
    palette: ["blanco", "dorado"],
    style_terms: ["jardín"],
    hard_constraints: [],
    ...overrides,
  };
}

/** Vocabulario cerrado de `scene_functions[].function` (sección 5.3 / taxonomy/v3.ts), extraído por tipo indexado para no necesitar un import aparte. */
type SceneFunctionId = CatalogItemV3["scene_functions"][number]["function"];

function makeItem(itemId: string, categoryV3: CatalogItemV3["category_v3"], functionId: SceneFunctionId): CatalogItemV3 {
  return {
    item_id: itemId,
    category_v3: categoryV3,
    media_refs: [],
    scene_functions: [{ function: functionId, confidence: 0.9, evidence: "fixture" }],
    compatibility: {},
  };
}

/** Candidato elegible mínimo para un slot, con un item de la familia (`category_v3`) indicada. */
function eligibleCandidate(
  slotId: string,
  itemId: string,
  categoryV3: CatalogItemV3["category_v3"],
  functionId: SceneFunctionId
): SlotCandidate {
  return {
    slot_id: slotId,
    item: makeItem(itemId, categoryV3, functionId),
    supply_binding: { kind: "venue_existing", evidence_ref: `evidence-${itemId}` },
    retrieval: { lexical: 0.8, semantic: 0.8, rerank: 0.8 },
    eligibility: { pass: true, reasons: ["fixture: candidato elegible"] },
  };
}

// ---------------------------------------------------------------------------
// 1. focal_only — candidatos solo para la estructura focal
// ---------------------------------------------------------------------------

test("focal_only — candidatos SOLO para la estructura focal ⇒ COMPLETE, sin exigir pasillo/asientos", () => {
  const intent = makeIntent({ complexity_requested: "focal_only" });
  const program = expandIntentToProgram(intent, RECIPE_ID);

  // Solo la estructura/superficie focal es "required" en focal_only (ver
  // decisión de diseño en wedding-ceremony-garden.v1.ts): decoración,
  // pasillo, asientos, acento botánico deben quedar "optional"/"conditional".
  const requiredSlotIds = program.slots.filter((slot) => slot.requirement === "required").map((slot) => slot.slot_id);
  assert.deepEqual(requiredSlotIds, ["focal_structure_surface"]);

  const candidatesBySlot: Record<string, SlotCandidate[]> = {
    focal_structure_surface: [eligibleCandidate("focal_structure_surface", "ITEM-ARCO-001", "altar_frame", "altar_frame")],
  };

  const report = computeCoverageReport(program, candidatesBySlot, "focal_only");
  assert.equal(report.status, "COMPLETE");
  assert.equal(report.achieved_profile, "focal_only");
  assert.equal(report.requested_profile, "focal_only");
  assert.deepEqual(report.required_gaps, []);
  assert.deepEqual(report.required_covered, ["focal_structure_surface"]);
});

// ---------------------------------------------------------------------------
// 2. balanced_scene — candidatos completos, 4 familias distintas
// ---------------------------------------------------------------------------

test("balanced_scene — focal+decor+pasillo+asientos cubiertos, 4 familias distintas ⇒ COMPLETE", () => {
  const intent = makeIntent({ complexity_requested: "balanced_scene" });
  const program = expandIntentToProgram(intent, RECIPE_ID);

  const requiredSlotIds = program.slots.filter((slot) => slot.requirement === "required").map((slot) => slot.slot_id);
  assert.deepEqual(
    requiredSlotIds,
    ["focal_structure_surface", "focal_decor", "aisle_delimitation", "guest_seating_visible"]
  );

  const candidatesBySlot: Record<string, SlotCandidate[]> = {
    focal_structure_surface: [eligibleCandidate("focal_structure_surface", "ITEM-ARCO-001", "altar_frame", "altar_frame")],
    focal_decor: [eligibleCandidate("focal_decor", "ITEM-FLORAL-001", "floral_foliage", "focal_decor")],
    aisle_delimitation: [eligibleCandidate("aisle_delimitation", "ITEM-AISLE-001", "aisle_decor", "aisle_runner")],
    guest_seating_visible: [eligibleCandidate("guest_seating_visible", "ITEM-CHAIR-001", "furniture", "guest_chair")],
  };

  const report = computeCoverageReport(program, candidatesBySlot, "balanced_scene");
  assert.equal(report.status, "COMPLETE");
  assert.equal(report.achieved_profile, "balanced_scene");
  assert.deepEqual(report.required_gaps, []);
  assert.equal(report.distinct_families.length, 4);
});

// ---------------------------------------------------------------------------
// 3. immersive_scene — candidatos ricos (≥4 zonas visibles, ≥6 familias)
// ---------------------------------------------------------------------------

test("immersive_scene — candidatos ricos (≥4 zonas visibles, ≥6 familias) ⇒ COMPLETE en immersive_scene", () => {
  const intent = makeIntent({ complexity_requested: "immersive_scene" });
  const program = expandIntentToProgram(intent, RECIPE_ID);

  const requiredSlotIds = program.slots.filter((slot) => slot.requirement === "required").map((slot) => slot.slot_id);
  assert.deepEqual(
    requiredSlotIds,
    ["focal_structure_surface", "focal_decor", "aisle_delimitation", "guest_seating_visible", "botanical_accent"]
  );

  const candidatesBySlot: Record<string, SlotCandidate[]> = {
    focal_structure_surface: [eligibleCandidate("focal_structure_surface", "ITEM-ARCO-001", "altar_frame", "altar_frame")],
    focal_decor: [eligibleCandidate("focal_decor", "ITEM-BACKDROP-001", "backdrop_surface", "focal_decor")],
    aisle_delimitation: [eligibleCandidate("aisle_delimitation", "ITEM-AISLE-001", "aisle_decor", "aisle_runner")],
    guest_seating_visible: [eligibleCandidate("guest_seating_visible", "ITEM-CHAIR-001", "furniture", "guest_chair")],
    botanical_accent: [eligibleCandidate("botanical_accent", "ITEM-FLORAL-001", "floral_foliage", "floral_foliage_accent")],
    ambient_lighting: [eligibleCandidate("ambient_lighting", "ITEM-LIGHT-001", "ambient_lighting", "ambient_light")],
  };

  const report = computeCoverageReport(program, candidatesBySlot, "immersive_scene");
  assert.equal(report.status, "COMPLETE");
  assert.equal(report.achieved_profile, "immersive_scene");
  assert.deepEqual(report.required_gaps, []);

  // Sanity check adicional pedido por la Tarea 01.2: la escena rica realmente
  // alcanza ≥4 zonas visibles y ≥6 familias (sección 5.1), no solo "gaps vacíos".
  const coveredZones = new Set(
    program.slots
      .filter((slot) => Object.prototype.hasOwnProperty.call(candidatesBySlot, slot.slot_id))
      .map((slot) => slot.zone)
  );
  assert.ok(coveredZones.size >= 4, `se esperaban >=4 zonas visibles, hubo ${coveredZones.size}`);
  assert.ok(report.distinct_families.length >= 6, `se esperaban >=6 familias, hubo ${report.distinct_families.length}`);
});

// ---------------------------------------------------------------------------
// 4. Degradación explícita
// ---------------------------------------------------------------------------

test("degradación — balanced_scene con candidatos SOLO para el slot focal ⇒ focal_only/PARTIAL, requested_profile visible", () => {
  const intent = makeIntent({ complexity_requested: "balanced_scene" });
  const program = expandIntentToProgram(intent, RECIPE_ID);

  const candidatesBySlot: Record<string, SlotCandidate[]> = {
    focal_structure_surface: [eligibleCandidate("focal_structure_surface", "ITEM-ARCO-001", "altar_frame", "altar_frame")],
  };

  const report = computeCoverageReport(program, candidatesBySlot, "balanced_scene");

  assert.equal(report.requested_profile, "balanced_scene", "el reporte NO debe fingir que se pidió menos de lo pedido");
  assert.equal(report.achieved_profile, "focal_only");
  assert.equal(report.status, "PARTIAL");
  assert.ok(report.required_gaps.length > 0, "debe haber brechas obligatorias explicando qué falta");

  const gapSlotIds = report.required_gaps.map((gap) => gap.slot_id).sort();
  assert.deepEqual(gapSlotIds, ["aisle_delimitation", "focal_decor", "guest_seating_visible"]);
  for (const gap of report.required_gaps) {
    assert.ok(gap.reason.length > 0, `el gap de ${gap.slot_id} debe traer una razón legible`);
  }

  // achieved_profile nunca puede igualar o superar requested_profile cuando hay brechas.
  assert.notEqual(report.achieved_profile, report.requested_profile);
});

// ---------------------------------------------------------------------------
// 5. Verdad observable #1 — cantidad vs. distribución
// ---------------------------------------------------------------------------

test("verdad observable #1 — 10 candidatos en un solo slot NUNCA superan a 4 candidatos repartidos en 4 slots obligatorios", () => {
  const intent = makeIntent({ complexity_requested: "balanced_scene" });
  const program = expandIntentToProgram(intent, RECIPE_ID);

  // Escenario A: 10 candidatos, todos para el mismo slot focal.
  const tenInOneSlot: SlotCandidate[] = Array.from({ length: 10 }, (_, i) =>
    eligibleCandidate("focal_structure_surface", `ITEM-ARCO-${i}`, "altar_frame", "altar_frame")
  );
  const reportA = computeCoverageReport(
    program,
    { focal_structure_surface: tenInOneSlot },
    "balanced_scene"
  );

  // Escenario B: 4 candidatos, uno por cada uno de los 4 slots obligatorios de balanced_scene.
  const fourAcrossFourSlots: Record<string, SlotCandidate[]> = {
    focal_structure_surface: [eligibleCandidate("focal_structure_surface", "ITEM-ARCO-001", "altar_frame", "altar_frame")],
    focal_decor: [eligibleCandidate("focal_decor", "ITEM-FLORAL-001", "floral_foliage", "focal_decor")],
    aisle_delimitation: [eligibleCandidate("aisle_delimitation", "ITEM-AISLE-001", "aisle_decor", "aisle_runner")],
    guest_seating_visible: [eligibleCandidate("guest_seating_visible", "ITEM-CHAIR-001", "furniture", "guest_chair")],
  };
  const reportB = computeCoverageReport(program, fourAcrossFourSlots, "balanced_scene");

  // Mismo total de candidatos (10 vs 4... la comparación importante es la
  // DISTRIBUCIÓN, no el total): A tiene MÁS candidatos en total y sin
  // embargo debe lograr una cobertura estrictamente peor que B.
  assert.equal(reportA.achieved_profile, "focal_only");
  assert.equal(reportA.status, "PARTIAL");
  assert.equal(reportA.distinct_families.length, 1, "10 candidatos del mismo slot deben contar como UNA sola familia");

  assert.equal(reportB.achieved_profile, "balanced_scene");
  assert.equal(reportB.status, "COMPLETE");
  assert.equal(reportB.distinct_families.length, 4);

  // Aserción central: la cantidad (A: 10 candidatos) NUNCA alcanza un
  // perfil igual o mejor que la distribución (B: 4 candidatos repartidos).
  const PROFILE_RANK: Record<string, number> = { focal_only: 0, balanced_scene: 1, immersive_scene: 2, full_event: 3 };
  assert.ok(
    PROFILE_RANK[reportA.achieved_profile] < PROFILE_RANK[reportB.achieved_profile],
    `A (10 candidatos en 1 slot, achieved=${reportA.achieved_profile}) debe quedar estrictamente por debajo de ` +
      `B (4 candidatos en 4 slots, achieved=${reportB.achieved_profile})`
  );
  assert.ok(reportA.weighted_coverage < reportB.weighted_coverage);
});

// ---------------------------------------------------------------------------
// Determinismo de expandIntentToProgram
// ---------------------------------------------------------------------------

test("expandIntentToProgram — es determinista: misma intención + misma receta ⇒ mismo programa", () => {
  const intent = makeIntent({ complexity_requested: "immersive_scene" });
  const programA = expandIntentToProgram(intent, RECIPE_ID);
  const programB = expandIntentToProgram({ ...intent }, RECIPE_ID);
  assert.deepEqual(programA, programB);
});

// ---------------------------------------------------------------------------
// Resumen
// ---------------------------------------------------------------------------

console.log(`\n[SUMMARY] ${passCount} pasaron, ${failCount} fallaron (de ${passCount + failCount} pruebas)`);

if (failCount > 0) {
  process.exit(1);
}
