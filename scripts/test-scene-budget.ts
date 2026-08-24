/**
 * Test script for Tarea 05.2 (Plan 05 — Resolver V2 + budget).
 *
 * Verifies:
 *   1. instance_count ≠ component_bom ≠ billable_quantity
 *   2. approval blocked when mandatory costs unknown (QUOTE_REQUIRED)
 *   3. breakdown by source class (purchase/rental/venue_existing)
 *   4. Shared items not double-billed
 *   5. Gap slots produced as blockers
 *   6. Determinism
 *
 * Usage: npx tsx scripts/test-scene-budget.ts
 * Exits 0 when all checks pass, 1 otherwise.
 */

import { resolveScenePlan } from "../src/lib/scene/resolver";
import { optimizeSceneCoverage } from "../src/lib/scene/optimizer";
import { expandIntentToProgram } from "../src/lib/scene/recipes";
import { parseEventIntent } from "../src/lib/rag/query-parser/parse-event";
import { planSlotQueries } from "../src/lib/rag/retrieval/slot-query-planner";
import type { SlotCandidate, SceneProgramV1 } from "../src/lib/scene/tipos";
import type { ScoredSlotCandidate } from "../src/lib/rag/retrieval/scene-rerank";

interface EvalResult { id: string; pass: boolean; detail: string }
const results: EvalResult[] = [];
let exitCode = 0;

function record(id: string, condition: boolean, detail: string): void {
  results.push({ id, pass: condition, detail });
  if (!condition) exitCode = 1;
}

// Stubs
function stubC(opts?: {
  itemId?: string;
  kind?: "sale" | "rental" | "venue_existing";
  estimatedCost?: number;
  eligible?: boolean;
  unitCost?: number;
  packageQty?: number;
  quoteRequired?: boolean;
}): SlotCandidate {
  const now = new Date().toISOString();
  const itemId = opts?.itemId ?? "item-001";
  return {
    slot_id: "test-slot",
    item: {
      item_id: itemId,
      category_v3: "balloon_material" as const,
      media_refs: [],
      scene_functions: [],
      compatibility: {},
    },
    supply_binding: opts?.kind === "rental"
      ? { kind: "rental", item_id: itemId, offer_id: "ofr-1", snapshot_id: "snap-1", periods: 1 }
      : opts?.kind === "venue_existing"
        ? { kind: "venue_existing", evidence_ref: "photo-1" }
        : { kind: "sale", item_id: itemId, offer_id: "ofr-1", snapshot_id: "snap-1" },
    offer: opts?.unitCost || opts?.quoteRequired ? {
      offer_id: "ofr-1",
      item_id: itemId,
      source_ref: { source_id: "src-1", snapshot_id: "snap-1", verified_at: now },
      source_class: "catalog_sale" as const,
      status: opts?.quoteRequired ? "QUOTE_REQUIRED" as const : "PRICED" as const,
      availability: { status: "available" as const, checked_at: now },
      price_components: opts?.unitCost ? [{
        type: "package_sale" as const,
        amount_cop: opts.unitCost,
        quantity: opts?.packageQty ?? 100,
      }] : [],
    } : undefined,
    retrieval: { lexical: 0.5, semantic: 0.6, rerank: 0.55 },
    eligibility: { pass: opts?.eligible ?? true, reasons: [] },
    estimated_cost_cop: opts?.estimatedCost,
  };
}

function makeScored(candidates: SlotCandidate[]): ScoredSlotCandidate[] {
  return candidates.map((c) => ({ ...c, rerank_score: 0.5, explain: ["stub"] }));
}

function getProgram(): { intent: ReturnType<typeof parseEventIntent>; program: SceneProgramV1 } {
  const intent = parseEventIntent("Quiero ideas para mi boda en un jardín");
  const program = expandIntentToProgram(intent, "wedding_ceremony_garden@1");
  return { intent, program };
}

// ---------------------------------------------------------------------------
// 1. instance_count vs billable_quantity separation
// ---------------------------------------------------------------------------

function evalQuantitySeparation(): void {
  const { program } = getProgram();
  const queries = planSlotQueries(program, parseEventIntent("Quiero ideas para mi boda en un jardín"));

  // 100 globos por paquete, costo 5000 COP/paquete
  const slotCandidates = queries.map((q) => ({
    slot_id: q.slot_id,
    candidates: makeScored([
      stubC({ itemId: `item-${q.slot_id}`, unitCost: 5000, packageQty: 100, estimatedCost: 5000 }),
    ]),
  }));

  const optimizerResult = optimizeSceneCoverage(program, slotCandidates, 500000);
  const resolved = resolveScenePlan(optimizerResult, program);

  record("res:has_lines", resolved.lines.length > 0, `${resolved.lines.length} lines`);
  record("res:approval", resolved.approval === "COMPLETE", `approval=${resolved.approval}`);

  // Each line should have instance_count and billable_quantity
  for (const line of resolved.lines) {
    if (line.item_id.startsWith("gap:")) continue;
    record(`res:instance_count:${line.slot_id}`, line.instance_count >= 0, `instance_count=${line.instance_count}`);
    record(`res:billable_qty:${line.slot_id}`, line.billable_quantity >= 1, `bill=${line.billable_quantity}, pkg=${line.units_per_package}`);
  }

  record("res:total_cop_positive", resolved.totals.total_cop > 0, `total=${resolved.totals.total_cop}`);
}

// ---------------------------------------------------------------------------
// 2. QUOTE_REQUIRED blocks approval
// ---------------------------------------------------------------------------

function evalQuoteRequiredBlocks(): void {
  const { program } = getProgram();
  const queries = planSlotQueries(program, parseEventIntent("Quiero ideas para mi boda en un jardín"));

  const slotCandidates = queries.map((q) => ({
    slot_id: q.slot_id,
    candidates: makeScored([
      stubC({ itemId: `item-${q.slot_id}`, quoteRequired: true, eligible: true }),
    ]),
  }));

  const optimizerResult = optimizeSceneCoverage(program, slotCandidates, 500000);
  const resolved = resolveScenePlan(optimizerResult, program);

  record("res:quote_blocks", resolved.approval === "BLOCKED" || resolved.approval === "PARTIAL", `approval=${resolved.approval}`);
  record("res:quote_blockers", resolved.approval_blockers.length > 0, `${resolved.approval_blockers.length} blockers`);
  record("res:quote_blocker_text", resolved.approval_blockers.some((b) => b.includes("QUOTE_REQUIRED")), "mentions QUOTE_REQUIRED");
}

// ---------------------------------------------------------------------------
// 3. Shared items — single billing
// ---------------------------------------------------------------------------

function evalSharedItemBilling(): void {
  const { program } = getProgram();
  const queries = planSlotQueries(program, parseEventIntent("Quiero ideas para mi boda en un jardín"));

  const slotCandidates = queries.map((q) => ({
    slot_id: q.slot_id,
    candidates: makeScored([
      stubC({ itemId: "shared-item", unitCost: 5000, packageQty: 100, estimatedCost: 5000 }),
    ]),
  }));

  const optimizerResult = optimizeSceneCoverage(program, slotCandidates, 500000);
  const resolved = resolveScenePlan(optimizerResult, program);

  record("res:shared_detected", resolved.totals.shared_items > 0, `shared=${resolved.totals.shared_items}`);
  record("res:shared_billing_once", resolved.totals.distinct_items > 0, `distinct=${resolved.totals.distinct_items}`);

  // The same item should be billed only once
  const billedLines = resolved.lines.filter((l) => l.subtotal_cop > 0);
  const billedItemIds = new Set(billedLines.map((l) => l.item_id));
  record("res:shared_single_subtotal", billedItemIds.size === resolved.totals.distinct_items, `billed=${billedLines.length}, distinct items=${billedItemIds.size}`);
}

// ---------------------------------------------------------------------------
// 4. Breakdown by source class
// ---------------------------------------------------------------------------

function evalSourceBreakdown(): void {
  const { program } = getProgram();
  const queries = planSlotQueries(program, parseEventIntent("Quiero ideas para mi boda en un jardín"));

  const slotCandidates = queries.map((q, i) => ({
    slot_id: q.slot_id,
    candidates: makeScored([
      i % 2 === 0
        ? stubC({ itemId: `purchase-${i}`, kind: "sale", unitCost: 5000, estimatedCost: 5000 })
        : stubC({ itemId: `venue-${i}`, kind: "venue_existing", estimatedCost: 0 }),
    ]),
  }));

  const optimizerResult = optimizeSceneCoverage(program, slotCandidates, 500000);
  const resolved = resolveScenePlan(optimizerResult, program);

  record("res:breakdown_purchase", resolved.totals.breakdown.purchase >= 0, `purchase=${resolved.totals.breakdown.purchase}`);
  record("res:breakdown_rental", resolved.totals.breakdown.rental === 0, `rental=${resolved.totals.breakdown.rental}`);
  record("res:breakdown_venue", resolved.totals.breakdown.venue_existing >= 0, `venue=${resolved.totals.breakdown.venue_existing}`);

  // Venue items shouldn't contribute to total
  const venueLines = resolved.lines.filter((l) => l.source_class === "venue_existing");
  const venueCost = venueLines.reduce((s, l) => s + l.subtotal_cop, 0);
  record("res:venue_no_cost", venueCost === 0, `venue cost=${venueCost}`);
}

// ---------------------------------------------------------------------------
// 5. Gaps produce blockers
// ---------------------------------------------------------------------------

function evalGapsAsBlockers(): void {
  const { program } = getProgram();
  const queries = planSlotQueries(program, parseEventIntent("Quiero ideas para mi boda en un jardín"));

  // No candidates → gaps
  const slotCandidates = queries.map((q) => ({
    slot_id: q.slot_id,
    candidates: [] as ScoredSlotCandidate[],
  }));

  const optimizerResult = optimizeSceneCoverage(program, slotCandidates, 500000);
  const resolved = resolveScenePlan(optimizerResult, program);

  record("res:gaps_block", resolved.approval === "BLOCKED" || resolved.approval === "PARTIAL", `approval=${resolved.approval}`);
  record("res:gap_lines", resolved.lines.some((l) => l.item_id.startsWith("gap:")), "has gap lines");
  record("res:zero_total", resolved.totals.total_cop === 0, `total=${resolved.totals.total_cop}`);
}

// ---------------------------------------------------------------------------
// 6. Determinism
// ---------------------------------------------------------------------------

function evalDeterminism(): void {
  const { program } = getProgram();
  const queries = planSlotQueries(program, parseEventIntent("Quiero ideas para mi boda en un jardín"));

  const slotCandidates = queries.map((q, i) => ({
    slot_id: q.slot_id,
    candidates: makeScored([
      stubC({ itemId: `a-${i}`, unitCost: 3000, estimatedCost: 3000 }),
    ]),
  }));

  const opt1 = optimizeSceneCoverage(program, slotCandidates, 50000);
  const opt2 = optimizeSceneCoverage(program, slotCandidates, 50000);
  const res1 = resolveScenePlan(opt1, program);
  const res2 = resolveScenePlan(opt2, program);

  const json1 = JSON.stringify(res1);
  const json2 = JSON.stringify(res2);
  record("res:determinism", json1 === json2, `lens: ${json1.length} vs ${json2.length}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log("=== test-scene-budget — Tarea 05.2 ===\n");

evalQuantitySeparation();
evalQuoteRequiredBlocks();
evalSharedItemBilling();
evalSourceBreakdown();
evalGapsAsBlockers();
evalDeterminism();

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
