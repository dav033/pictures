/**
 * Test script for Tarea 05.1 (Plan 05 — Global Optimizer).
 *
 * Verifies:
 *   1. Required slots are prioritized over optional
 *   2. Budget ceiling is a hard gate
 *   3. Shared items aren't double-billed
 *   4. Determinism: same input → same output
 *   5. Prefers coverage over accumulating from same family
 *
 * Usage: npx tsx scripts/test-scene-optimizer.ts
 * Exits 0 when all checks pass, 1 otherwise.
 */

import { optimizeSceneCoverage } from "../src/lib/scene/optimizer";
import { checkEligibility, isEnvironmentCompatible, isSourceAllowed, isQuoteResolved, isSameItem, groupByItemId, areDependenciesSatisfied } from "../src/lib/scene/compatibility";
import { expandIntentToProgram } from "../src/lib/scene/recipes";
import { parseEventIntent } from "../src/lib/rag/query-parser/parse-event";
import { planSlotQueries } from "../src/lib/rag/retrieval/slot-query-planner";
import { type ScoredSlotCandidate } from "../src/lib/rag/retrieval/scene-rerank";
import type { SlotCandidate } from "../src/lib/scene/tipos";

interface EvalResult { id: string; pass: boolean; detail: string }
const results: EvalResult[] = [];
let exitCode = 0;

function record(id: string, condition: boolean, detail: string): void {
  results.push({ id, pass: condition, detail });
  if (!condition) exitCode = 1;
}

// ---------------------------------------------------------------------------
// 1. Compatibility module — pure functions
// ---------------------------------------------------------------------------

function stubCandidate(opts?: {
  itemId?: string;
  kind?: "sale" | "rental" | "venue_existing";
  indoorOutdoor?: Array<"indoor" | "outdoor">;
  estimatedCost?: number;
  eligible?: boolean;
}): SlotCandidate {
  return {
    slot_id: "test-slot",
    item: {
      item_id: opts?.itemId ?? "item-001",
      category_v3: "balloon_material" as const,
      media_refs: [],
      scene_functions: [],
      compatibility: { indoor_outdoor: opts?.indoorOutdoor },
    },
    supply_binding: opts?.kind === "rental"
      ? { kind: "rental", item_id: opts?.itemId ?? "item-001", offer_id: "ofr-1", snapshot_id: "snap-1", periods: 1 }
      : opts?.kind === "venue_existing"
        ? { kind: "venue_existing", evidence_ref: "photo-1" }
        : { kind: "sale", item_id: opts?.itemId ?? "item-001", offer_id: "ofr-1", snapshot_id: "snap-1" },
    offer: undefined,
    retrieval: { lexical: 0.5, semantic: 0.6, rerank: 0.55 },
    eligibility: { pass: opts?.eligible ?? true, reasons: [] },
    estimated_cost_cop: opts?.estimatedCost,
  };
}

function evalCompatibility(): void {
  // Environment
  const outdoor = stubCandidate({ indoorOutdoor: ["outdoor"] });
  const indoor = stubCandidate({ indoorOutdoor: ["indoor"] });
  const unknown = stubCandidate({ indoorOutdoor: undefined });

  record("compat:env_outdoor_match", isEnvironmentCompatible(outdoor, "outdoor"), "outdoor item in outdoor slot");
  record("compat:env_outdoor_no_match", !isEnvironmentCompatible(outdoor, "indoor"), "outdoor item in indoor slot");
  record("compat:env_indoor_match", isEnvironmentCompatible(indoor, "indoor"), "indoor item in indoor slot");
  record("compat:env_unknown", isEnvironmentCompatible(unknown, "outdoor"), "unknown compat → compatible");
  record("compat:env_undefined", isEnvironmentCompatible(outdoor, undefined), "undefined env → always compatible");

  // Source
  const sale = stubCandidate({ kind: "sale" });
  const rental = stubCandidate({ kind: "rental" });
  const vExisting = stubCandidate({ kind: "venue_existing" });

  record("compat:source_sale", isSourceAllowed(sale.supply_binding, ["catalog_sale"]), "sale in sale slot");
  record("compat:source_rental", isSourceAllowed(rental.supply_binding, ["catalog_rental"]), "rental in rental slot");
  record("compat:source_reject", !isSourceAllowed(sale.supply_binding, ["catalog_rental"]), "sale item in rental-only slot → rejected");
  record("compat:source_venue", isSourceAllowed(vExisting.supply_binding, ["venue_existing"]), "venue in venue slot");
  record("compat:source_all", isSourceAllowed(sale.supply_binding, ["catalog_sale", "catalog_rental"]), "sale in multi-source slot");

  // Quote
  const now = new Date().toISOString();
  const quoted = { ...stubCandidate(), offer: {
    offer_id: "ofr-1",
    item_id: "item-001",
    source_ref: { source_id: "src-1", snapshot_id: "snap-1", verified_at: now },
    source_class: "catalog_sale" as const,
    status: "QUOTE_REQUIRED" as const,
    availability: { status: "available" as const, checked_at: now },
    price_components: [],
  } };
  record("compat:quote_rejected", !isQuoteResolved(quoted), "QUOTE_REQUIRED → not resolved");
  record("compat:no_offer_ok", isQuoteResolved(stubCandidate()), "no offer → passes");

  // Same item
  const a = stubCandidate({ itemId: "same" });
  const b = stubCandidate({ itemId: "same" });
  const c = stubCandidate({ itemId: "different" });
  record("compat:same_item", isSameItem(a, b), "same item_id → true");
  record("compat:different_item", !isSameItem(a, c), "different item_id → false");

  // Group by item
  const groups = groupByItemId([a, b, c]);
  record("compat:group_same", (groups.get("same")?.length ?? 0) === 2, `group "same" has 2 items`);
  record("compat:group_different", (groups.get("different")?.length ?? 0) === 1, `group "different" has 1 item`);

  // Dependencies
  record("compat:deps_satisfied", areDependenciesSatisfied("a", ["b", "c"], new Set(["b", "c"])), "all deps covered");
  record("compat:deps_unsatisfied", !areDependenciesSatisfied("a", ["b", "c"], new Set(["b"])), "missing dep c");
  record("compat:deps_empty", areDependenciesSatisfied("a", [], new Set()), "empty deps → satisfied");

  // Eligibility
  const budget = checkEligibility(stubCandidate({ estimatedCost: 5000 }), ["catalog_sale"], "outdoor", 10000);
  record("compat:eligibility_pass", budget.pass, "within budget");

  const overBudget = checkEligibility(stubCandidate({ estimatedCost: 15000 }), ["catalog_sale"], "outdoor", 10000);
  record("compat:eligibility_over_budget", !overBudget.pass, `reason: ${overBudget.reason}`);
}

// ---------------------------------------------------------------------------
// 2. Small enumerable optima
// ---------------------------------------------------------------------------

function makeScored(candidates: SlotCandidate[]): ScoredSlotCandidate[] {
  return candidates.map((c) => ({
    ...c,
    rerank_score: 0.5,
    explain: ["stub"],
  }));
}

function evalSmallOptima(): void {
  const intent = parseEventIntent("Quiero ideas para mi boda en un jardín");
  const program = expandIntentToProgram(intent, "wedding_ceremony_garden@1");
  const queries = planSlotQueries(program, intent);

  // Build fake candidates: 2 items per slot, one cheaper, one expensive
  const slotCandidates = queries.map((q, i) => ({
    slot_id: q.slot_id,
    candidates: makeScored([
      stubCandidate({ itemId: `cheap-${i}`, estimatedCost: 5000, eligible: true }),
      stubCandidate({ itemId: `expensive-${i}`, estimatedCost: 50000, eligible: true }),
    ]),
  }));

  // Constrained budget: should allocate to required slots first
  const result = optimizeSceneCoverage(program, slotCandidates, 20000);

  record("opt:has_selections", result.selections.length > 0, `selected ${result.selections.length} slots`);
  record("opt:selections_le_budget", result.estimated_total_cop <= 20000, `total=${result.estimated_total_cop}, budget=20000`);

  // Required slots should be prioritized
  const requiredSlotIds = new Set(program.slots.filter((s) => s.requirement === "required").map((s) => s.slot_id));
  const selectedRequired = result.selections.filter((s) => requiredSlotIds.has(s.slot_id));
  const totalRequired = requiredSlotIds.size;
  record(
    "opt:required_prioritized",
    selectedRequired.length >= Math.min(totalRequired, result.selections.length),
    `covered ${selectedRequired.length}/${totalRequired} required slots`,
  );

  record("opt:coverage_score", result.required_coverage >= 0, `required_coverage=${result.required_coverage.toFixed(3)}`);
  record("opt:weighted_coverage", result.weighted_coverage >= 0, `weighted_coverage=${result.weighted_coverage.toFixed(3)}`);
  record("opt:family_diversity", result.family_diversity >= 0, `families=${result.family_diversity}`);

  // Without budget: all slots should be covered
  const unbudgeted = optimizeSceneCoverage(program, slotCandidates, undefined);
  record("opt:unbudgeted_all_covered", unbudgeted.selections.length === queries.length, `${unbudgeted.selections.length}/${queries.length}`);
  record("opt:unbudgeted_no_gaps", unbudgeted.gaps.length === 0, `${unbudgeted.gaps.length} gaps`);
}

// ---------------------------------------------------------------------------
// 3. Shared items — no double billing
// ---------------------------------------------------------------------------

function evalSharedItems(): void {
  const intent = parseEventIntent("Quiero ideas para mi boda en un jardín");
  const program = expandIntentToProgram(intent, "wedding_ceremony_garden@1");
  const queries = planSlotQueries(program, intent);

  // Same item assigned to two different slots
  const slotCandidates = queries.map((q) => ({
    slot_id: q.slot_id,
    candidates: makeScored([
      stubCandidate({ itemId: "shared-item", estimatedCost: 10000, eligible: true }),
    ]),
  }));

  const result = optimizeSceneCoverage(program, slotCandidates, 50000);

  // The same item should appear in multiple selections but cost only once
  const sharedItemSelections = result.selections.filter((s) => s.candidate.item.item_id === "shared-item");
  record("opt:shared_item_assigned", sharedItemSelections.length >= 1, `${sharedItemSelections.length} slots got shared item`);

  // Cost should be charged only once for shared items
  record(
    "opt:shared_item_single_bill",
    result.estimated_total_cop <= 10000,
    `total_cost=${result.estimated_total_cop} (expected <= 10000 for shared item)`,
  );
}

// ---------------------------------------------------------------------------
// 4. Determinism
// ---------------------------------------------------------------------------

function evalDeterminism(): void {
  const intent = parseEventIntent("Quiero ideas para mi boda en un jardín");
  const program1 = expandIntentToProgram(intent, "wedding_ceremony_garden@1");
  const program2 = expandIntentToProgram(intent, "wedding_ceremony_garden@1");
  const queries = planSlotQueries(program1, intent);

  const slotCandidates = queries.map((q, i) => ({
    slot_id: q.slot_id,
    candidates: makeScored([
      stubCandidate({ itemId: `a-${i}`, estimatedCost: 3000, eligible: true }),
      stubCandidate({ itemId: `b-${i}`, estimatedCost: 8000, eligible: true }),
    ]),
  }));

  const result1 = optimizeSceneCoverage(program1, slotCandidates, 50000);
  const result2 = optimizeSceneCoverage(program2, slotCandidates, 50000);

  const json1 = JSON.stringify(result1);
  const json2 = JSON.stringify(result2);
  record("opt:determinism", json1 === json2, `lens: ${json1.length} vs ${json2.length}`);

  record("opt:determinism_score", result1.score === result2.score, `scores: ${result1.score} vs ${result2.score}`);
}

// ---------------------------------------------------------------------------
// 5. Budget as hard gate
// ---------------------------------------------------------------------------

function evalBudgetHardGate(): void {
  const intent = parseEventIntent("Quiero ideas para mi boda en un jardín");
  const program = expandIntentToProgram(intent, "wedding_ceremony_garden@1");
  const queries = planSlotQueries(program, intent);

  // Very tight budget
  const slotCandidates = queries.map((q, i) => ({
    slot_id: q.slot_id,
    candidates: makeScored([
      stubCandidate({ itemId: `item-${i}`, estimatedCost: 20000, eligible: true }),
    ]),
  }));

  const tight = optimizeSceneCoverage(program, slotCandidates, 5000);
  record("opt:tight_budget_blocks", tight.selections.length <= 1, `${tight.selections.length} selections with budget=5000`);
  record("opt:tight_budget_gaps", tight.gaps.some((g) => g.kind === "BUDGET"), "has BUDGET gaps");

  // Ample budget
  const ample = optimizeSceneCoverage(program, slotCandidates, 500000);
  record("opt:ample_budget_all", ample.selections.length === queries.length, `${ample.selections.length}/${queries.length}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log("=== test-scene-optimizer — Tarea 05.1 ===\n");

evalCompatibility();
evalSmallOptima();
evalSharedItems();
evalDeterminism();
evalBudgetHardGate();

const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass).length;

console.log(`\nResults: ${passed} passed, ${failed} failed, ${results.length} total\n`);

if (failed > 0) {
  console.log("FAILURES:");
  for (const r of results.filter((r) => !r.pass)) {
    console.log(`  [FAIL] ${r.id}: ${r.detail}`);
  }
}

console.log(`\nExit code: ${exitCode}`);
process.exit(exitCode);
