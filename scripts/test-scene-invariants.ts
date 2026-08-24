import assert from "node:assert/strict";
import {
  SceneInvariantViolationError,
  assertProgramBeforeProducts,
  assertNoRenderWithoutSource,
  assertEventViewCoverageSeparation,
  assertBudgetGateBeforeApproval,
  assertContextNonQuotableScope,
  assertVenueExistingHasEvidence,
  assertHashInvalidationOnOfferChange,
  type MinimalSupplyBinding,
  type MinimalSceneInstance,
  type MinimalScenePlan,
  type MinimalCoverageReport,
  type MinimalPipelineEvent,
  type MinimalHashSnapshot,
} from "../src/lib/scene/invariants";

// ---------------------------------------------------------------------------
// Mini test runner casero: sin dependencias externas, sin PostgreSQL, sin
// proveedores. Cada `test(...)` corre de forma aislada; una falla no aborta
// el resto. Al final se imprime el contador de pass/fail y se sale con
// process.exit(1) si algo falló.
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

/** Espera que `fn()` lance `SceneInvariantViolationError` con `rule` dada. */
function expectViolation(
  fn: () => void,
  rule: string,
  violationSubstring?: string
): SceneInvariantViolationError {
  try {
    fn();
  } catch (error) {
    assert.ok(
      error instanceof SceneInvariantViolationError,
      `se esperaba SceneInvariantViolationError, se obtuvo ${error}`
    );
    const violationError = error as SceneInvariantViolationError;
    assert.equal(violationError.rule, rule);
    assert.ok(violationError.violations.length > 0);
    if (violationSubstring) {
      assert.ok(
        violationError.violations.some((v) => v.includes(violationSubstring)),
        `se esperaba una violación conteniendo "${violationSubstring}", se obtuvo: ${violationError.violations.join(" | ")}`
      );
    }
    return violationError;
  }
  throw new Error(`se esperaba que la regla "${rule}" fallara, pero no lanzó`);
}

// ---------------------------------------------------------------------------
// 1. "Programa antes de productos" — assertProgramBeforeProducts
// ---------------------------------------------------------------------------

test("assertProgramBeforeProducts — positivo: programa antes de búsqueda de productos", () => {
  const events: MinimalPipelineEvent[] = [
    { step: "intent_captured", at: 0 },
    { step: "program_generated", at: 1 },
    { step: "product_search", at: 2 },
    { step: "candidate_selected", at: 3 },
  ];
  const result = assertProgramBeforeProducts(events);
  assert.equal(result.ok, true);
  assert.deepEqual(result.violations, []);
});

test("assertProgramBeforeProducts — negativo: búsqueda de productos antes del programa", () => {
  const events: MinimalPipelineEvent[] = [
    { step: "intent_captured", at: 0 },
    { step: "product_search", at: 1 },
    { step: "program_generated", at: 2 },
  ];
  expectViolation(
    () => assertProgramBeforeProducts(events),
    "program-before-products",
    "product_search"
  );
});

test("assertProgramBeforeProducts — negativo: búsqueda de productos sin programa en absoluto", () => {
  const events: MinimalPipelineEvent[] = [
    { step: "intent_captured", at: 0 },
    { step: "candidate_selected", at: 1 },
  ];
  expectViolation(
    () => assertProgramBeforeProducts(events),
    "program-before-products",
    "sin que exista un evento program_generated"
  );
});

// ---------------------------------------------------------------------------
// 2. "Sin fuente no se renderiza" — assertNoRenderWithoutSource
// ---------------------------------------------------------------------------

const saleBinding: MinimalSupplyBinding = {
  kind: "sale",
  item_id: "ITEM-1",
  offer_id: "OFFER-1",
  snapshot_id: "SNAP-1",
};

const rentalBinding: MinimalSupplyBinding = {
  kind: "rental",
  item_id: "ITEM-2",
  offer_id: "OFFER-2",
  snapshot_id: "SNAP-2",
  periods: 1,
};

const venueExistingBindingWithEvidence: MinimalSupplyBinding = {
  kind: "venue_existing",
  evidence_ref: "photo-region-42",
};

const contextBindingValid: MinimalSupplyBinding = {
  kind: "context_non_quotable",
  context_kind: "natural_vegetation",
};

test("assertNoRenderWithoutSource — positivo: todas las instancias tienen binding permitido", () => {
  const instances: MinimalSceneInstance[] = [
    { scene_instance_id: "SI-1", visibility: "visible", supply_binding: saleBinding },
    { scene_instance_id: "SI-2", visibility: "visible", supply_binding: rentalBinding },
    { scene_instance_id: "SI-3", visibility: "support_hidden", supply_binding: venueExistingBindingWithEvidence },
    { scene_instance_id: "SI-4", visibility: "context_preserved", supply_binding: contextBindingValid },
  ];
  const result = assertNoRenderWithoutSource(instances);
  assert.equal(result.ok, true);
});

test("assertNoRenderWithoutSource — negativo: instancia visible sin supply_binding", () => {
  const instances: MinimalSceneInstance[] = [
    { scene_instance_id: "SI-1", visibility: "visible", supply_binding: saleBinding },
    { scene_instance_id: "SI-5-INVENTADA", visibility: "visible", supply_binding: null },
  ];
  expectViolation(
    () => assertNoRenderWithoutSource(instances),
    "no-render-without-source",
    "SI-5-INVENTADA"
  );
});

// ---------------------------------------------------------------------------
// 3. "Evento y vista son niveles distintos" — assertEventViewCoverageSeparation
// ---------------------------------------------------------------------------

const viewZoneAllowlist: Record<string, string[]> = {
  ceremony_view: ["ceremony_focal", "ceremony_aisle", "guest_seating"],
  reception_view: ["reception_head_table", "reception_guest_tables"],
};

test("assertEventViewCoverageSeparation — positivo: cada vista se queda en su alcance", () => {
  const coverageReport: MinimalCoverageReport = {
    event_coverage: [
      { zone: "ceremony_focal", planned: true },
      { zone: "ceremony_aisle", planned: true },
      { zone: "guest_seating", planned: true },
      { zone: "reception_head_table", planned: true },
    ],
    view_coverage: [
      { view_id: "ceremony_view", zone: "ceremony_focal", slot_id: "SLOT-1" },
      { view_id: "ceremony_view", zone: "ceremony_aisle", slot_id: "SLOT-2" },
      { view_id: "reception_view", zone: "reception_head_table", slot_id: "SLOT-3" },
    ],
  };
  const result = assertEventViewCoverageSeparation(coverageReport, viewZoneAllowlist);
  assert.equal(result.ok, true);
});

test("assertEventViewCoverageSeparation — negativo: la vista de ceremonia intenta mostrar la recepción", () => {
  const coverageReport: MinimalCoverageReport = {
    event_coverage: [
      { zone: "ceremony_focal", planned: true },
      { zone: "reception_head_table", planned: true },
    ],
    view_coverage: [
      { view_id: "ceremony_view", zone: "ceremony_focal", slot_id: "SLOT-1" },
      { view_id: "ceremony_view", zone: "reception_head_table", slot_id: "SLOT-4" },
    ],
  };
  expectViolation(
    () => assertEventViewCoverageSeparation(coverageReport, viewZoneAllowlist),
    "event-view-coverage-separation",
    "fuera de su alcance permitido"
  );
});

test("assertEventViewCoverageSeparation — negativo: vista reclama zona no planificada a nivel evento", () => {
  const coverageReport: MinimalCoverageReport = {
    event_coverage: [{ zone: "ceremony_focal", planned: true }],
    view_coverage: [
      { view_id: "ceremony_view", zone: "guest_seating", slot_id: "SLOT-5" },
    ],
  };
  expectViolation(
    () => assertEventViewCoverageSeparation(coverageReport, viewZoneAllowlist),
    "event-view-coverage-separation",
    "no está planificada a nivel de evento"
  );
});

test("assertEventViewCoverageSeparation — negativo: estructuras no separadas (defensivo en runtime)", () => {
  const malformed = {
    event_coverage: undefined,
    view_coverage: [],
  } as unknown as MinimalCoverageReport;
  expectViolation(
    () => assertEventViewCoverageSeparation(malformed, viewZoneAllowlist),
    "event-view-coverage-separation",
    "deben ser estructuras separadas"
  );
});

// ---------------------------------------------------------------------------
// 4. "Precio desconocido bloquea aprobación final" — assertBudgetGateBeforeApproval
// ---------------------------------------------------------------------------

test("assertBudgetGateBeforeApproval — positivo: plan PARTIAL con QUOTE_REQUIRED puede mostrarse como estimación", () => {
  const plan: MinimalScenePlan = {
    status: "PARTIAL",
    budget_ceiling_cop: 500_000,
    known_total_cop: 200_000,
    lines: [
      { line_id: "L-1", status: "PRICED", required: true },
      { line_id: "L-2", status: "QUOTE_REQUIRED", required: true },
    ],
  };
  const result = assertBudgetGateBeforeApproval(plan);
  assert.equal(result.ok, true);
});

test("assertBudgetGateBeforeApproval — positivo: plan APPROVED con todo PRICED y dentro del techo", () => {
  const plan: MinimalScenePlan = {
    status: "APPROVED",
    budget_ceiling_cop: 500_000,
    known_total_cop: 480_000,
    lines: [
      { line_id: "L-1", status: "PRICED", required: true },
      { line_id: "L-2", status: "VENUE_EXISTING", required: false },
    ],
  };
  const result = assertBudgetGateBeforeApproval(plan);
  assert.equal(result.ok, true);
});

test("assertBudgetGateBeforeApproval — negativo: plan APPROVED con línea obligatoria QUOTE_REQUIRED", () => {
  const plan: MinimalScenePlan = {
    status: "APPROVED",
    budget_ceiling_cop: 500_000,
    known_total_cop: 200_000,
    lines: [{ line_id: "L-9", status: "QUOTE_REQUIRED", required: true }],
  };
  expectViolation(
    () => assertBudgetGateBeforeApproval(plan),
    "budget-gate-before-approval",
    "L-9"
  );
});

test("assertBudgetGateBeforeApproval — negativo: plan VERIFICADO por encima del techo", () => {
  const plan: MinimalScenePlan = {
    status: "VERIFICADO",
    budget_ceiling_cop: 300_000,
    known_total_cop: 350_000,
    lines: [{ line_id: "L-1", status: "PRICED", required: true }],
  };
  expectViolation(
    () => assertBudgetGateBeforeApproval(plan),
    "budget-gate-before-approval",
    "por encima del techo"
  );
});

// ---------------------------------------------------------------------------
// 6.4 anti-alucinación — assertContextNonQuotableScope
// ---------------------------------------------------------------------------

test("assertContextNonQuotableScope — positivo: context_kind permitido (vegetación natural)", () => {
  const result = assertContextNonQuotableScope(contextBindingValid);
  assert.equal(result.ok, true);
});

test("assertContextNonQuotableScope — positivo: bindings de otras clases no aplican la regla", () => {
  const result = assertContextNonQuotableScope(saleBinding);
  assert.equal(result.ok, true);
});

test("assertContextNonQuotableScope — negativo: centro de mesa disfrazado de contexto genérico", () => {
  const invalidBinding = {
    kind: "context_non_quotable",
    context_kind: "centerpiece",
  } as unknown as MinimalSupplyBinding;
  expectViolation(
    () => assertContextNonQuotableScope(invalidBinding),
    "context-non-quotable-scope",
    "centerpiece"
  );
});

// ---------------------------------------------------------------------------
// 6.4 anti-alucinación — assertVenueExistingHasEvidence
// ---------------------------------------------------------------------------

test("assertVenueExistingHasEvidence — positivo: venue_existing con evidencia", () => {
  const result = assertVenueExistingHasEvidence(venueExistingBindingWithEvidence);
  assert.equal(result.ok, true);
});

test("assertVenueExistingHasEvidence — negativo: venue_existing con evidence_ref vacío", () => {
  const invalidBinding: MinimalSupplyBinding = {
    kind: "venue_existing",
    evidence_ref: "   ",
  };
  expectViolation(
    () => assertVenueExistingHasEvidence(invalidBinding),
    "venue-existing-has-evidence"
  );
});

// ---------------------------------------------------------------------------
// 6.4 revalidación — assertHashInvalidationOnOfferChange
// ---------------------------------------------------------------------------

test("assertHashInvalidationOnOfferChange — positivo: hash válido cuyos snapshots siguen vigentes", () => {
  const previousHashes: MinimalHashSnapshot[] = [
    { hash_id: "selection_hash-1", status: "valid", offer_snapshot_ids: ["SNAP-1", "SNAP-2"] },
  ];
  const result = assertHashInvalidationOnOfferChange(previousHashes, ["SNAP-1", "SNAP-2", "SNAP-3"]);
  assert.equal(result.ok, true);
});

test("assertHashInvalidationOnOfferChange — positivo: hash ya marcado inválido, aunque su snapshot cambió", () => {
  const previousHashes: MinimalHashSnapshot[] = [
    { hash_id: "quote_hash-1", status: "invalid", offer_snapshot_ids: ["SNAP-OLD"] },
  ];
  const result = assertHashInvalidationOnOfferChange(previousHashes, ["SNAP-NEW"]);
  assert.equal(result.ok, true);
});

test("assertHashInvalidationOnOfferChange — negativo: hash sigue 'valid' pero el snapshot de oferta cambió", () => {
  const previousHashes: MinimalHashSnapshot[] = [
    { hash_id: "selection_hash-2", status: "valid", offer_snapshot_ids: ["SNAP-OLD"] },
  ];
  expectViolation(
    () => assertHashInvalidationOnOfferChange(previousHashes, ["SNAP-NEW"]),
    "hash-invalidation-on-offer-change",
    "selection_hash-2"
  );
});

// ---------------------------------------------------------------------------
// Resumen
// ---------------------------------------------------------------------------

console.log(`\n[SUMMARY] ${passCount} pasaron, ${failCount} fallaron (de ${passCount + failCount} pruebas)`);

if (failCount > 0) {
  process.exit(1);
}
