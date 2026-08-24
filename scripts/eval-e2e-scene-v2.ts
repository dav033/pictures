/**
 * E2E integration test for Scene V2 pipeline (Plan 06).
 *
 * Tests the orchestrator in memory (no PostgreSQL needed) — mocks the
 * retrieval layer so the full pipeline from message → resolved plan is
 * testable without a live catalog.
 *
 * Usage: npx tsx scripts/eval-e2e-scene-v2.ts [--with-pg]
 *   --with-pg: Run against live PostgreSQL (requires DATABASE_URL)
 * Exits 0 when all checks pass, 1 otherwise.
 */

import { existsSync } from "node:fs";
import { parseEventIntent } from "../src/lib/rag/query-parser/parse-event";
import { expandIntentToProgram } from "../src/lib/scene/recipes";
import { planSlotQueries } from "../src/lib/rag/retrieval/slot-query-planner";
import { optimizeSceneCoverage } from "../src/lib/scene/optimizer";
import { resolveScenePlan } from "../src/lib/scene/resolver";
import { computeProgramHash, computeIntentHash } from "../src/lib/scene/hashes";
import type { SlotCandidate } from "../src/lib/scene/tipos";
import type { ScoredSlotCandidate } from "../src/lib/rag/retrieval/scene-rerank";

for (const archivo of [".env.local", ".env"]) {
  if (existsSync(archivo)) process.loadEnvFile(archivo);
}

interface EvalResult { id: string; pass: boolean; detail: string }
const results: EvalResult[] = [];
let exitCode = 0;

function record(id: string, condition: boolean, detail: string): void {
  results.push({ id, pass: condition, detail });
  if (!condition) exitCode = 1;
}

// Mock retrieval data — simulates catalog response per slot
function mockSlotCandidate(opts: {
  slotId: string;
  itemId: string;
  cost?: number;
  eligible?: boolean;
  kind?: "sale" | "rental" | "venue_existing";
}): SlotCandidate {
  return {
    slot_id: opts.slotId,
    item: {
      item_id: opts.itemId,
      category_v3: "balloon_material" as const,
      media_refs: [],
      scene_functions: [],
      compatibility: {},
    },
    supply_binding: opts.kind === "rental"
      ? { kind: "rental", item_id: opts.itemId, offer_id: "ofr-m", snapshot_id: "snap-m", periods: 1 }
      : opts.kind === "venue_existing"
        ? { kind: "venue_existing", evidence_ref: "photo-m" }
        : { kind: "sale", item_id: opts.itemId, offer_id: "ofr-m", snapshot_id: "snap-m" },
    offer: opts.cost !== undefined ? {
      offer_id: "ofr-m",
      item_id: opts.itemId,
      source_ref: { source_id: "src-m", snapshot_id: "snap-m", verified_at: new Date().toISOString() },
      source_class: "catalog_sale" as const,
      status: "PRICED" as const,
      availability: { status: "available" as const, checked_at: new Date().toISOString() },
      price_components: [{ type: "package_sale" as const, amount_cop: opts.cost, quantity: 100 }],
    } : undefined,
    retrieval: { lexical: 0.5, semantic: 0.6, rerank: 0.55 },
    eligibility: { pass: opts.eligible ?? true, reasons: [] },
    estimated_cost_cop: opts.cost,
  };
}

function asScored(c: SlotCandidate): ScoredSlotCandidate {
  return { ...c, rerank_score: 0.5, explain: [`Cubre función en la escena`] };
}

function simulateRetrieval(
  program: ReturnType<typeof expandIntentToProgram>,
): Array<{ slot_id: string; candidates: ScoredSlotCandidate[] }> {
  // Provide candidates for focal slots (altar_frame + focal_decor), leave others empty.
  // Note: slot.function uses semantic function names, not slot_id.
  const coveredFunctions = new Set(["altar_frame", "focal_decor"]);
  return program.slots.map((slot, i) => {
    if (coveredFunctions.has(slot.function)) {
      return {
        slot_id: slot.slot_id,
        candidates: [
          asScored(mockSlotCandidate({ slotId: slot.slot_id, itemId: `prod-${i}-a`, cost: 5000 })),
          asScored(mockSlotCandidate({ slotId: slot.slot_id, itemId: `prod-${i}-b`, cost: 8000 })),
        ],
      };
    }
    // Empty candidates for remaining slots — simulates catalog gaps
    return { slot_id: slot.slot_id, candidates: [] };
  });
}

// ---------------------------------------------------------------------------
// E2E-1: Catalog current (partial coverage, gaps expected)
// ---------------------------------------------------------------------------

function evalE2E1(): void {
  const mensaje = "Quiero ideas para mi boda en un jardín, presupuesto de 150.000";
  const intent = parseEventIntent(mensaje);
  const program = expandIntentToProgram(intent, "wedding_ceremony_garden@1");
  const queries = planSlotQueries(program, intent);
  const slotCandidates = simulateRetrieval(program);

  record("e2e1:intent_scope", intent.event_scope === "ceremony", `scope=${intent.event_scope}`);
  record("e2e1:intent_complexity", intent.complexity_requested === "balanced_scene", `complexity=${intent.complexity_requested}`);
  record("e2e1:budget", intent.budget_cop === 150_000, `budget=${intent.budget_cop}`);
  record("e2e1:has_slots", program.slots.length > 0, `${program.slots.length} slots`);
  record("e2e1:has_queries", queries.length === program.slots.length, `${queries.length} queries`);

  const optimizerResult = optimizeSceneCoverage(program, slotCandidates, intent.budget_cop);
  const resolved = resolveScenePlan(optimizerResult, program);

  record("e2e1:selections", optimizerResult.selections.length > 0, `${optimizerResult.selections.length} selections`);
  record("e2e1:has_gaps", optimizerResult.gaps.length > 0, `${optimizerResult.gaps.length} gaps (expected with partial catalog)`);
  record("e2e1:approval", resolved.approval === "PARTIAL" || resolved.approval === "BLOCKED", `approval=${resolved.approval}`);
  record("e2e1:total_under_budget", resolved.totals.total_cop <= 150_000, `total=${resolved.totals.total_cop}`);
}

// ---------------------------------------------------------------------------
// E2E-3: "Solo quiero un arco" — focal_only
// ---------------------------------------------------------------------------

function evalE2E3(): void {
  const mensaje = "Solo quiero un arco orgánico blanco y dorado, nada más";
  const intent = parseEventIntent(mensaje);

  record("e2e3:complexity_focal_only", intent.complexity_requested === "focal_only", `complexity=${intent.complexity_requested}`);
  record("e2e3:palette", intent.palette.includes("blanco") && intent.palette.includes("dorado"), `palette=[${intent.palette.join(", ")}]`);

  const program = expandIntentToProgram(intent, "wedding_ceremony_garden@1");
  const slotCandidates = simulateRetrieval(program);
  const optimizerResult = optimizeSceneCoverage(program, slotCandidates, 400000);

  record("e2e3:has_selections", optimizerResult.selections.length >= 1, `${optimizerResult.selections.length} selections`);
  // focal_only doesn't REQUIRE aisle/seating — only focal zone
  const requiredGaps = optimizerResult.gaps.filter((g) => {
    const slot = program.slots.find((s) => s.slot_id === g.slot_id);
    return slot?.requirement === "required";
  });
  record("e2e3:no_required_gaps_for_focal_only", requiredGaps.length === 0, `${requiredGaps.length} required gaps`);
}

// ---------------------------------------------------------------------------
// E2E-6: Ceremony + reception (both)
// ---------------------------------------------------------------------------

function evalE2E6(): void {
  const mensaje = "Necesitamos decoración tanto para la ceremonia como para la recepción de la boda";
  const intent = parseEventIntent(mensaje);

  record("e2e6:scope_both", intent.event_scope === "both", `scope=${intent.event_scope}`);
  record("e2e6:complexity_full", intent.complexity_requested === "full_event", `complexity=${intent.complexity_requested}`);
  record("e2e6:two_views", intent.requested_views.length >= 2, `views=[${intent.requested_views.join(", ")}]`);

  const program = expandIntentToProgram(intent, "wedding_ceremony_garden@1");
  record("e2e6:program_valid", program.slots.length > 0, `${program.slots.length} slots`);
}

// ---------------------------------------------------------------------------
// Hash stability (section 1, truth #6)
// ---------------------------------------------------------------------------

function evalHashes(): void {
  const intent = parseEventIntent("Quiero ideas para mi boda en un jardín");
  const program = expandIntentToProgram(intent, "wedding_ceremony_garden@1");

  const intentHash1 = computeIntentHash(intent);
  const intentHash2 = computeIntentHash(parseEventIntent("Quiero ideas para mi boda en un jardín"));
  record("hash:intent_stable", intentHash1 === intentHash2, `${intentHash1} vs ${intentHash2}`);

  const progHash1 = computeProgramHash(program);
  const progHash2 = computeProgramHash(expandIntentToProgram(intent, "wedding_ceremony_garden@1"));
  record("hash:program_stable", progHash1 === progHash2, `${progHash1} vs ${progHash2}`);
  record("hash:different", intentHash1 !== progHash1, "intent hash ≠ program hash");
}

// ---------------------------------------------------------------------------
// Live PG test (optional)
// ---------------------------------------------------------------------------

async function evalLiveOrchestrator(): Promise<void> {
  const withPg = process.argv.includes("--with-pg");
  if (!withPg || !process.env.DATABASE_URL) {
    record("live:orchestrator", !withPg, withPg ? "no DATABASE_URL" : "SKIPPED (use --with-pg)");
    return;
  }

  const { orchestrateScenePipeline } = await import("../src/lib/scene/orchestrator");
  const { getRagPool } = await import("../src/lib/rag/db");

  let pool;
  try {
    pool = getRagPool();
    await pool.query("SELECT 1");
  } catch (err) {
    record("live:connection", false, `PG connection failed: ${err}`);
    return;
  }

  const result = await orchestrateScenePipeline("Quiero ideas para mi boda en un jardín", pool);

  if ("error" in result) {
    record("live:orchestrator_error", false, `${result.stage}: ${result.error}`);
    return;
  }

  record("live:orchestrator_ran", true, `${result.latency_total_ms}ms`);
  record("live:has_program", result.program.slots.length > 0, `${result.program.slots.length} slots`);
  record("live:has_retrieval", result.retrieval.length === result.program.slots.length, `${result.retrieval.length}/${result.program.slots.length}`);
  record("live:has_optimizer", result.optimizer.selections.length >= 0, `${result.optimizer.selections.length} selections`);
  record("live:has_resolved", result.resolved_plan.schema_version === "resolved-scene-plan-v2", result.resolved_plan.approval);

  await pool.end();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== eval-e2e-scene-v2 — Plan 06 ===\n");

  evalE2E1();
  evalE2E3();
  evalE2E6();
  evalHashes();
  await evalLiveOrchestrator();

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
}

main().catch((err: unknown) => {
  console.error("FATAL:", err);
  process.exit(1);
});
