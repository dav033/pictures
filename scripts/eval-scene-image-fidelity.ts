/**
 * Evaluation script for Tarea 07.2 (Plan 07 — Prompt y QA visual V2).
 *
 * Verifies:
 *   1. SceneSpecV2 → prompt serializes correctly (no IDs visible)
 *   2. Visibility policies are respected
 *   3. Count policies are explicit
 *   4. Spatial relationships are described
 *   5. Determinism: same SceneSpecV2 → same prompt
 *
 * Usage: npx tsx scripts/eval-scene-image-fidelity.ts
 * Exits 0 when all checks pass, 1 otherwise.
 */

import { parseEventIntent } from "../src/lib/rag/query-parser/parse-event";
import { expandIntentToProgram } from "../src/lib/scene/recipes";
import { planSlotQueries } from "../src/lib/rag/retrieval/slot-query-planner";
import { optimizeSceneCoverage } from "../src/lib/scene/optimizer";
import { resolveScenePlan } from "../src/lib/scene/resolver";
import { buildSceneSpecV2, SceneSpecV2Schema, type SceneSpecV2 } from "../src/lib/ia/scene-spec-v2";
import { buildV2ImagePrompt, type V2PromptOutput } from "../src/lib/ia/prompt-v2";
import type { SlotCandidate, SceneProgramV1 } from "../src/lib/scene/tipos";
import type { ScoredSlotCandidate } from "../src/lib/rag/retrieval/scene-rerank";

interface EvalResult { id: string; pass: boolean; detail: string }
const results: EvalResult[] = [];
let exitCode = 0;

function record(id: string, condition: boolean, detail: string): void {
  results.push({ id, pass: condition, detail });
  if (!condition) exitCode = 1;
}

// ---------------------------------------------------------------------------
// Stubs — simulate a resolved plan with 3 visible items + 2 gaps
// ---------------------------------------------------------------------------

function stubC(itemId: string, slotId: string, sourceClass: "purchase" | "rental" | "venue_existing", cost?: number): SlotCandidate {
  const now = new Date().toISOString();
  return {
    slot_id: slotId,
    item: { item_id: itemId, category_v3: "balloon_material" as const, media_refs: [], scene_functions: [], compatibility: {} },
    supply_binding: sourceClass === "rental"
      ? { kind: "rental", item_id: itemId, offer_id: "ofr", snapshot_id: "snap", periods: 1 }
      : sourceClass === "venue_existing"
        ? { kind: "venue_existing", evidence_ref: "photo" }
        : { kind: "sale", item_id: itemId, offer_id: "ofr", snapshot_id: "snap" },
    offer: cost !== undefined ? {
      offer_id: "ofr", item_id: itemId,
      source_ref: { source_id: "src", snapshot_id: "snap", verified_at: now },
      source_class: "catalog_sale" as const, status: "PRICED" as const,
      availability: { status: "available" as const, checked_at: now },
      price_components: [{ type: "package_sale" as const, amount_cop: cost, quantity: 100 }],
    } : undefined,
    retrieval: { lexical: 0.5, semantic: 0.6, rerank: 0.55 },
    eligibility: { pass: true, reasons: [] },
    estimated_cost_cop: cost,
  };
}

function asScored(c: SlotCandidate): ScoredSlotCandidate {
  return { ...c, rerank_score: 0.5, explain: ["cubre función"] };
}

function setup(): { spec: SceneSpecV2; prompt: V2PromptOutput } {
  const intent = parseEventIntent("Quiero ideas para mi boda en un jardín");
  const program = expandIntentToProgram(intent, "wedding_ceremony_garden@1");
  const queries = planSlotQueries(program, intent);

  // Cover altar_frame, focal_decor, aisle_runner; leave rest as gaps
  const covered = new Set(["altar_frame", "focal_decor", "aisle_runner"]);
  const slotCandidates = queries.map((q) => covered.has(
    program.slots.find((s) => s.slot_id === q.slot_id)?.function ?? "",
  )
    ? { slot_id: q.slot_id, candidates: [asScored(stubC(`prod-${q.slot_id}`, q.slot_id, "purchase", 5000))] }
    : { slot_id: q.slot_id, candidates: [] as ScoredSlotCandidate[] },
  );

  const opt = optimizeSceneCoverage(program, slotCandidates, 150000);
  const plan = resolveScenePlan(opt, program);

  const spec = buildSceneSpecV2(plan, "ceremony_view", program.slots, { aspectRatio: "3:2" });
  const validated = SceneSpecV2Schema.parse(spec);
  const prompt = buildV2ImagePrompt(validated);

  return { spec: validated, prompt };
}

// ---------------------------------------------------------------------------
// 1. Basic structure
// ---------------------------------------------------------------------------

function evalBasicStructure(): void {
  const { spec, prompt } = setup();

  record("spec:schema_version", spec.schema_version === "scene-spec-v2", `version=${spec.schema_version}`);
  record("spec:view_id", spec.view_id === "ceremony_view", `view=${spec.view_id}`);
  record("spec:aspect_ratio", spec.aspect_ratio === "3:2", `ar=${spec.aspect_ratio}`);
  record("spec:has_items", spec.items.length > 0, `${spec.items.length} items`);

  record("prompt:has_positive", prompt.positive.length > 0, `${prompt.positive.length} chars`);
  record("prompt:has_negative", prompt.negative.length > 0, `${prompt.negative.length} negative lines`);
  record("prompt:has_required", prompt.required_elements.length > 0, `${prompt.required_elements.length} required`);
}

// ---------------------------------------------------------------------------
// 2. No internal IDs in the prompt
// ---------------------------------------------------------------------------

function evalNoIdsLeaked(): void {
  const { prompt } = setup();

  const fullText = prompt.positive + prompt.negative.join(" ");
  const hasSkuPattern = /\bSKU[-_]\w/i.test(fullText);
  record("fidelity:no_sku", !hasSkuPattern, "no SKU codes leaked");

  const hasItemId = /item_id[:\s]/.test(fullText);
  record("fidelity:no_item_id", !hasItemId, "no item_id key leaked");

  const hasProdId = /prod-/.test(fullText);
  record("fidelity:no_prod_id", !hasProdId, "no product IDs leaked");
}

// ---------------------------------------------------------------------------
// 3. Visibility policies
// ---------------------------------------------------------------------------

function evalVisibility(): void {
  const { spec } = setup();

  const visible = spec.items.filter((i) => i.visibility === "visible");
  record("fidelity:has_visible", visible.length > 0, `${visible.length} visible`);

  // All items should have a valid visibility policy
  for (const item of spec.items) {
    record(
      `fidelity:visibility:${item.slot_id}`,
      ["visible", "support_hidden", "context_preserved"].includes(item.visibility),
      `visibility=${item.visibility}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 4. Count policies
// ---------------------------------------------------------------------------

function evalCountPolicies(): void {
  const { spec } = setup();

  for (const item of spec.items) {
    record(
      `fidelity:count_policy:${item.slot_id}`,
      ["exact", "approximate", "representative"].includes(item.count_policy),
      `policy=${item.count_policy}, instances=${item.instance_count}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 5. Spatial relationships
// ---------------------------------------------------------------------------

function evalSpatialRelations(): void {
  const { prompt } = setup();

  const hasSpatial = /spatial:|attached to|aligned with|supported by|in front|behind|overhead/i.test(prompt.positive);
  record("fidelity:spatial_in_prompt", hasSpatial, "spatial relationships appear in prompt");

  // Check that relationships are NOT leaked as raw JSON
  const hasRawJson = /"relation"/.test(prompt.positive);
  record("fidelity:no_raw_json", !hasRawJson, "no raw JSON in prompt");
}

// ---------------------------------------------------------------------------
// 6. Source provenance in prompt
// ---------------------------------------------------------------------------

function evalSourceProvenance(): void {
  const { prompt } = setup();

  const hasCatalog = /catalog product/i.test(prompt.positive);
  record("fidelity:source_mentioned", hasCatalog, "source provenance in prompt");

  const hasVerified = /verified|quotable/i.test(prompt.positive);
  record("fidelity:verified_mentioned", hasVerified, "verified/quotable status in prompt");
}

// ---------------------------------------------------------------------------
// 7. Determinism
// ---------------------------------------------------------------------------

function evalDeterminism(): void {
  const { spec: spec1 } = setup();
  const prompt1 = buildV2ImagePrompt(spec1);

  const { spec: spec2 } = setup();
  const prompt2 = buildV2ImagePrompt(spec2);

  const json1 = JSON.stringify(prompt1);
  const json2 = JSON.stringify(prompt2);
  record("fidelity:determinism", json1 === json2, `prompt lens: ${json1.length} vs ${json2.length}`);
}

// ---------------------------------------------------------------------------
// 8. SceneSpecV2 Zod validation
// ---------------------------------------------------------------------------

function evalZodValidation(): void {
  const { spec } = setup();

  try {
    SceneSpecV2Schema.parse(spec);
    record("zod:roundtrip", true, "passes Zod validation");
  } catch (err: unknown) {
    record("zod:roundtrip", false, `Zod error: ${err}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log("=== eval-scene-image-fidelity — Tarea 07.2 ===\n");

evalBasicStructure();
evalNoIdsLeaked();
evalVisibility();
evalCountPolicies();
evalSpatialRelations();
evalSourceProvenance();
evalDeterminism();
evalZodValidation();

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
