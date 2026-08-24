/**
 * Pruebas de los contratos Zod V2 del dominio de escena (Tarea 01.1 —
 * `PLAN_ARQUITECTURA_ESCENA_COMPLETA_RAG.md`, sección 7 / "Plan 01,
 * Tarea 01.1" en la sección 11).
 *
 * Verifica dos cosas:
 *   1. Que fixtures válidos construidos a propósito (representativos de los
 *      escenarios E2E de `src/lib/scene/__fixtures__/wedding-intents.ts`,
 *      pero expresados directamente contra los contratos Zod reales para no
 *      acoplar esos fixtures — deliberadamente reducidos, ver su cabecera —
 *      al esquema formal) PASAN la validación.
 *   2. Que los casos inválidos exigidos por la Tarea 01.1 SON RECHAZADOS por
 *      Zod con un mensaje de error claro: IDs de slot duplicados, peso
 *      inválido, slot con view_id inexistente, fuente no permitida, y un
 *      `SceneCoverageReport` "COMPLETE" con brechas obligatorias no vacías.
 *
 * Mismo estilo de test runner casero (`[PASS]`/`[FAIL]`, contador final,
 * `process.exit(1)` si algo falla) que `scripts/test-scene-invariants.ts`.
 */

import assert from "node:assert/strict";
import {
  CatalogItemV3Schema,
  CommercialOfferV1Schema,
  EventIntentV2Schema,
  NonCommercialReferenceClassSchema,
  ResolvedScenePlanV2StubSchema,
  SceneCoverageReportSchema,
  ScenePlanV2StubSchema,
  SceneProgramV1Schema,
  SceneQaReportStubSchema,
  SceneSpecV2StubSchema,
  SlotCandidateSchema,
  SupplyBindingSchema,
  SupplySourceClassSchema,
  type CatalogItemV3,
  type CommercialOfferV1,
  type EventIntentV2,
  type SceneCoverageReport,
  type SceneProgramV1,
  type SlotCandidate,
} from "../src/lib/scene/tipos";
import {
  canonicalJsonStringify,
  computeCoverageReportHash,
  computeIntentHash,
  computePlanHash,
  computeProgramHash,
  computeQaHash,
  computeQuoteHash,
  computeSceneSpecHash,
  computeSelectionHash,
} from "../src/lib/scene/hashes";

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

/** Espera que `schema.parse(value)` lance ZodError conteniendo `messageSubstring` en algún issue. */
function expectZodRejection(
  parse: () => void,
  messageSubstring?: string
): void {
  try {
    parse();
  } catch (error) {
    assert.ok(
      error instanceof Error && error.name === "ZodError",
      `se esperaba un ZodError, se obtuvo ${error instanceof Error ? error.name : error}`
    );
    if (messageSubstring) {
      const message = (error as Error).message;
      assert.ok(
        message.includes(messageSubstring),
        `se esperaba un mensaje conteniendo "${messageSubstring}", se obtuvo: ${message}`
      );
    }
    return;
  }
  throw new Error("se esperaba que Zod rechazara el valor, pero lo aceptó");
}

// ---------------------------------------------------------------------------
// Fixtures válidos construidos inline (proyección directa de EventIntentV2)
// ---------------------------------------------------------------------------

/** Réplica del escenario E2E-1 de wedding-intents.ts, expresada como EventIntentV2 real. */
const VALID_EVENT_INTENT: EventIntentV2 = {
  schema_version: "event-intent-v2",
  event_type: "wedding",
  event_scope: "ceremony",
  requested_views: ["ceremony"],
  complexity_requested: "balanced_scene",
  budget_cop: 150_000,
  event_date: "2026-11-14",
  event_location: { country: "CO", city: "Bogotá" },
  venue: { environment: "outdoor", existing_asset_refs: [] },
  palette: ["blanco", "dorado"],
  style_terms: ["jardín", "romántico"],
  hard_constraints: [],
};

const VALID_VIEWS = [
  { view_id: "ceremony_view", view_type: "ceremony" as const, zones: ["ceremony_focal", "ceremony_aisle", "guest_seating"] },
];

function buildValidProgram(): SceneProgramV1 {
  return {
    schema_version: "scene-program-v1",
    recipe_id: "wedding_ceremony_garden",
    recipe_version: 1,
    intent_hash: computeIntentHash(VALID_EVENT_INTENT),
    views: VALID_VIEWS,
    slots: [
      {
        slot_id: "focal-structure",
        view_id: "ceremony_view",
        zone: "ceremony_focal",
        function: "altar_frame",
        requirement: "required",
        weight: 5,
        min_instances: 1,
        max_instances: 1,
        allowed_sources: ["catalog_sale", "catalog_rental", "venue_existing"],
        dependencies: [],
        spatial_constraints: [],
      },
      {
        slot_id: "focal-decor",
        view_id: "ceremony_view",
        zone: "ceremony_focal",
        function: "focal_decor",
        requirement: "required",
        weight: 4,
        min_instances: 1,
        max_instances: 3,
        allowed_sources: ["catalog_sale"],
        dependencies: ["focal-structure"],
        spatial_constraints: [
          { relation: "attached_to", target_slot_id: "focal-structure" },
        ],
      },
      {
        slot_id: "aisle-delimitation",
        view_id: "ceremony_view",
        zone: "ceremony_aisle",
        function: "aisle_runner",
        requirement: "required",
        weight: 3,
        min_instances: 1,
        max_instances: 1,
        allowed_sources: ["catalog_sale", "catalog_rental", "venue_existing"],
        dependencies: [],
        spatial_constraints: [],
      },
    ],
  };
}

const VALID_CATALOG_ITEM: CatalogItemV3 = {
  item_id: "ITEM-ALTAR-0001",
  category_v3: "altar_frame",
  media_refs: [{ id: "MEDIA-1", role: "identity", source_url_hash: "abc123" }],
  scene_functions: [{ function: "altar_frame", confidence: 0.92, evidence: "title+tags" }],
  compatibility: { indoor_outdoor: ["outdoor"] },
};

const VALID_OFFER: CommercialOfferV1 = {
  offer_id: "OFR-ALTAR-0001",
  item_id: "ITEM-ALTAR-0001",
  source_ref: { source_id: "SRC-1", snapshot_id: "SNAP-1", verified_at: "2026-08-22T09:00:00.000Z" },
  source_class: "catalog_sale",
  status: "PRICED",
  availability: { status: "available", checked_at: "2026-08-22T09:00:00.000Z" },
  price_components: [{ type: "unit_sale", amount_cop: 380000 }],
};

function buildValidCandidate(): SlotCandidate {
  return {
    slot_id: "focal-structure",
    item: VALID_CATALOG_ITEM,
    offer: VALID_OFFER,
    supply_binding: { kind: "sale", item_id: "ITEM-ALTAR-0001", offer_id: "OFR-ALTAR-0001", snapshot_id: "SNAP-1" },
    retrieval: { lexical: 0.8, semantic: 0.75, rerank: 0.9 },
    eligibility: { pass: true, reasons: ["source verified", "dimensions compatible"] },
    estimated_cost_cop: 380000,
  };
}

function buildValidCoverageReportComplete(): SceneCoverageReport {
  return {
    requested_profile: "balanced_scene",
    achieved_profile: "balanced_scene",
    weighted_coverage: 1,
    required_covered: ["focal-structure", "focal-decor", "aisle-delimitation"],
    required_gaps: [],
    waivers: [],
    optional_covered: [],
    distinct_families: ["altar_frame", "focal_decor", "aisle_runner"],
    status: "COMPLETE",
  };
}

function buildValidCoverageReportPartial(): SceneCoverageReport {
  return {
    requested_profile: "balanced_scene",
    achieved_profile: "focal_only",
    weighted_coverage: 0.4,
    required_covered: ["focal-structure"],
    required_gaps: [
      { slot_id: "aisle-delimitation", reason: "sin oferta comercial verificable", suggested_source_type: "catalog_rental" },
    ],
    waivers: [],
    optional_covered: [],
    distinct_families: ["altar_frame"],
    status: "PARTIAL",
  };
}

// ---------------------------------------------------------------------------
// 1. Casos válidos
// ---------------------------------------------------------------------------

test("EventIntentV2 — acepta un fixture válido (proyección de E2E-1)", () => {
  const parsed = EventIntentV2Schema.parse(VALID_EVENT_INTENT);
  assert.equal(parsed.event_scope, "ceremony");
  assert.equal(parsed.budget_cop, 150_000);
});

test("SceneProgramV1 — acepta un programa válido con vistas, slots y dependencias consistentes", () => {
  const program = buildValidProgram();
  const parsed = SceneProgramV1Schema.parse(program);
  assert.equal(parsed.slots.length, 3);
});

test("NonCommercialReferenceClass — acepta exactamente los valores de provenance.ts", () => {
  assert.equal(NonCommercialReferenceClassSchema.parse("editorial_reference"), "editorial_reference");
  assert.equal(NonCommercialReferenceClassSchema.parse("test_only"), "test_only");
});

test("SupplySourceClass — acepta las cuatro clases de fuente de la sección 6.1", () => {
  for (const value of ["catalog_sale", "catalog_rental", "venue_existing", "context_non_quotable"]) {
    assert.equal(SupplySourceClassSchema.parse(value), value);
  }
});

test("SupplyBinding — acepta las cuatro variantes (sale/rental/venue_existing/context_non_quotable)", () => {
  SupplyBindingSchema.parse({ kind: "sale", item_id: "I-1", offer_id: "O-1", snapshot_id: "S-1" });
  SupplyBindingSchema.parse({ kind: "rental", item_id: "I-2", offer_id: "O-2", snapshot_id: "S-2", periods: 2 });
  SupplyBindingSchema.parse({ kind: "venue_existing", evidence_ref: "photo-region-1" });
  SupplyBindingSchema.parse({ kind: "context_non_quotable", context_kind: "natural_vegetation" });
});

test("SlotCandidate — acepta un candidato válido con item + offer + supply_binding coherentes", () => {
  const parsed = SlotCandidateSchema.parse(buildValidCandidate());
  assert.equal(parsed.eligibility.pass, true);
});

test("SceneCoverageReport — acepta COMPLETE con required_gaps vacío", () => {
  const parsed = SceneCoverageReportSchema.parse(buildValidCoverageReportComplete());
  assert.equal(parsed.status, "COMPLETE");
});

test("SceneCoverageReport — acepta PARTIAL con required_gaps no vacío", () => {
  const parsed = SceneCoverageReportSchema.parse(buildValidCoverageReportPartial());
  assert.equal(parsed.status, "PARTIAL");
  assert.equal(parsed.required_gaps.length, 1);
});

test("CatalogItemV3 / CommercialOfferV1 — aceptan fixtures válidos (stubs de la sección 7.3)", () => {
  CatalogItemV3Schema.parse(VALID_CATALOG_ITEM);
  CommercialOfferV1Schema.parse(VALID_OFFER);
});

test("Stubs ScenePlanV2/ResolvedScenePlanV2/SceneSpecV2/QaReport — aceptan valores mínimos coherentes", () => {
  const programHash = computeProgramHash(buildValidProgram());
  const plan = ScenePlanV2StubSchema.parse({
    schema_version: "scene-plan-v2",
    program_hash: programHash,
    selected_candidates: [
      {
        slot_id: "focal-structure",
        item_id: "ITEM-ALTAR-0001",
        offer_id: "OFR-ALTAR-0001",
        supply_binding: { kind: "sale", item_id: "ITEM-ALTAR-0001", offer_id: "OFR-ALTAR-0001", snapshot_id: "SNAP-1" },
      },
    ],
  });
  const planHash = computePlanHash(plan);
  const resolved = ResolvedScenePlanV2StubSchema.parse({
    schema_version: "resolved-scene-plan-v2",
    plan_hash: planHash,
    status: "APPROVED",
    known_total_cop: 380000,
  });
  const quoteHash = computeQuoteHash(resolved);
  const spec = SceneSpecV2StubSchema.parse({
    schema_version: "scene-spec-v2",
    scene_plan_hash: quoteHash,
    view_id: "ceremony_view",
    instances: [],
  });
  const specHash = computeSceneSpecHash(spec);
  const qa = SceneQaReportStubSchema.parse({
    schema_version: "scene-qa-v2",
    scene_spec_hash: specHash,
    passed: true,
  });
  assert.equal(typeof computeQaHash(qa), "string");
});

// ---------------------------------------------------------------------------
// 2. Casos inválidos exigidos por la Tarea 01.1
// ---------------------------------------------------------------------------

test("SceneProgramV1 — RECHAZA IDs de slot duplicados", () => {
  const program = buildValidProgram();
  program.slots[1] = { ...program.slots[1], slot_id: program.slots[0].slot_id };
  expectZodRejection(() => SceneProgramV1Schema.parse(program), "slot_id duplicado");
});

test("SceneSlot — RECHAZA peso negativo", () => {
  const program = buildValidProgram();
  program.slots[0] = { ...program.slots[0], weight: -1 };
  expectZodRejection(() => SceneProgramV1Schema.parse(program));
});

test("SceneSlot — RECHAZA peso fuera de rango (> 10)", () => {
  const program = buildValidProgram();
  program.slots[0] = { ...program.slots[0], weight: 25 };
  expectZodRejection(() => SceneProgramV1Schema.parse(program));
});

test("SceneProgramV1 — RECHAZA slot con view_id inexistente", () => {
  const program = buildValidProgram();
  program.slots[0] = { ...program.slots[0], view_id: "reception_view_no_declarada" };
  expectZodRejection(() => SceneProgramV1Schema.parse(program), "no existe en program.views");
});

test("SceneSlot — RECHAZA allowed_sources vacío", () => {
  const program = buildValidProgram();
  program.slots[0] = { ...program.slots[0], allowed_sources: [] };
  expectZodRejection(() => SceneProgramV1Schema.parse(program));
});

test("SceneSlot — RECHAZA una fuente no permitida (fuera del enum SupplySourceClass)", () => {
  const program = buildValidProgram();
  (program.slots[0] as unknown as { allowed_sources: string[] }).allowed_sources = [
    "manual_invented_source",
  ];
  expectZodRejection(() => SceneProgramV1Schema.parse(program));
});

test("SceneCoverageReport — RECHAZA status COMPLETE con required_gaps no vacío", () => {
  const invalidReport = {
    ...buildValidCoverageReportComplete(),
    required_gaps: [{ slot_id: "aisle-delimitation", reason: "sin oferta comercial verificable" }],
  };
  expectZodRejection(
    () => SceneCoverageReportSchema.parse(invalidReport),
    "es inconsistente con 1 required_gaps pendiente"
  );
});

test("SupplyBinding — RECHAZA context_kind fuera del subconjunto permitido (centerpiece disfrazado de contexto)", () => {
  expectZodRejection(() =>
    SupplyBindingSchema.parse({ kind: "context_non_quotable", context_kind: "centerpiece" })
  );
});

test("SpatialConstraint (vía SceneSlot) — RECHAZA una restricción sin target_slot_id ni target_zone", () => {
  const program = buildValidProgram();
  program.slots[1] = {
    ...program.slots[1],
    spatial_constraints: [{ relation: "attached_to" }],
  };
  expectZodRejection(() => SceneProgramV1Schema.parse(program));
});

test("SceneProgramV1 — RECHAZA dependencies apuntando a un slot_id inexistente", () => {
  const program = buildValidProgram();
  program.slots[1] = { ...program.slots[1], dependencies: ["slot-que-no-existe"] };
  expectZodRejection(
    () => SceneProgramV1Schema.parse(program),
    "no corresponde a ningún slot_id del programa"
  );
});

// ---------------------------------------------------------------------------
// 3. Hashes canónicos — determinismo
// ---------------------------------------------------------------------------

test("computeIntentHash — es determinista para el mismo intent (mismo orden de claves)", () => {
  const hashA = computeIntentHash(VALID_EVENT_INTENT);
  const hashB = computeIntentHash({ ...VALID_EVENT_INTENT });
  assert.equal(hashA, hashB);
  assert.equal(hashA.length, 64); // sha256 hex
});

test("computeIntentHash — es determinista aunque cambie el orden de las claves del objeto", () => {
  const reordered: EventIntentV2 = {
    hard_constraints: VALID_EVENT_INTENT.hard_constraints,
    style_terms: VALID_EVENT_INTENT.style_terms,
    palette: VALID_EVENT_INTENT.palette,
    venue: VALID_EVENT_INTENT.venue,
    event_location: VALID_EVENT_INTENT.event_location,
    event_date: VALID_EVENT_INTENT.event_date,
    budget_cop: VALID_EVENT_INTENT.budget_cop,
    complexity_requested: VALID_EVENT_INTENT.complexity_requested,
    requested_views: VALID_EVENT_INTENT.requested_views,
    event_scope: VALID_EVENT_INTENT.event_scope,
    event_type: VALID_EVENT_INTENT.event_type,
    schema_version: VALID_EVENT_INTENT.schema_version,
  };
  assert.equal(computeIntentHash(VALID_EVENT_INTENT), computeIntentHash(reordered));
});

test("computeIntentHash — cambia si cambia el contenido (p. ej. budget_cop)", () => {
  const changed: EventIntentV2 = { ...VALID_EVENT_INTENT, budget_cop: 200_000 };
  assert.notEqual(computeIntentHash(VALID_EVENT_INTENT), computeIntentHash(changed));
});

test("computeProgramHash / computeSelectionHash — deterministas y sensibles a snapshot_id (sección 6.4)", () => {
  const program = buildValidProgram();
  const programHash = computeProgramHash(program);
  assert.equal(programHash, computeProgramHash(buildValidProgram()));

  const selectionBefore = computeSelectionHash({
    program_hash: programHash,
    selected: [
      {
        slot_id: "focal-structure",
        item_id: "ITEM-ALTAR-0001",
        offer_id: "OFR-ALTAR-0001",
        supply_binding: { kind: "sale", item_id: "ITEM-ALTAR-0001", offer_id: "OFR-ALTAR-0001", snapshot_id: "SNAP-1" },
      },
    ],
  });
  const selectionAfterOfferChange = computeSelectionHash({
    program_hash: programHash,
    selected: [
      {
        slot_id: "focal-structure",
        item_id: "ITEM-ALTAR-0001",
        offer_id: "OFR-ALTAR-0001",
        // Mismo item/offer, snapshot_id cambiado -> debe invalidar el hash (sección 6.4).
        supply_binding: { kind: "sale", item_id: "ITEM-ALTAR-0001", offer_id: "OFR-ALTAR-0001", snapshot_id: "SNAP-2" },
      },
    ],
  });
  assert.notEqual(selectionBefore, selectionAfterOfferChange);
});

test("canonicalJsonStringify — produce el mismo string sin importar el orden de las claves", () => {
  const a = canonicalJsonStringify({ b: 1, a: 2, c: { y: 1, x: 2 } });
  const b = canonicalJsonStringify({ a: 2, c: { x: 2, y: 1 }, b: 1 });
  assert.equal(a, b);
});

test("computeCoverageReportHash — cambia entre un reporte COMPLETE y uno PARTIAL", () => {
  const hashComplete = computeCoverageReportHash(buildValidCoverageReportComplete());
  const hashPartial = computeCoverageReportHash(buildValidCoverageReportPartial());
  assert.notEqual(hashComplete, hashPartial);
});

// ---------------------------------------------------------------------------
// Resumen
// ---------------------------------------------------------------------------

console.log(`\n[SUMMARY] ${passCount} pasaron, ${failCount} fallaron (de ${passCount + failCount} pruebas)`);

if (failCount > 0) {
  process.exit(1);
}
