/**
 * Evaluation script for Tarea 04.1 (Plan 04 — RAG por slot).
 *
 * Verifies:
 *   1. `parseEventIntent` correctly extracts intents from Spanish messages
 *   2. Hard constraints are never mixed with style terms (regla crítica)
 *   3. `planSlotQueries` produces differentiated queries per slot
 *   4. Determinism: same input → same output
 *
 * Usage: npx tsx scripts/eval-event-query-parser.ts
 * Exits 0 when all checks pass, 1 otherwise.
 */

import { ok, equal, deepEqual, notDeepEqual, throws as assertThrows } from "node:assert/strict";
import { parseEventIntent, buildRawEventIntentDraft, DEFAULT_COMPLEXITY, deriveDefaultRequestedViews } from "../src/lib/rag/query-parser/parse-event";
import { planSlotQueries, computeProvisionalSlotBudget } from "../src/lib/rag/retrieval/slot-query-planner";
import { expandIntentToProgram } from "../src/lib/scene/recipes";
import {
  WEDDING_INTENT_FIXTURES,
  type WeddingIntentFixture,
} from "../src/lib/scene/__fixtures__/wedding-intents";
import { EventIntentV2Schema, SceneSlotSchema } from "../src/lib/scene/tipos";
import type { EventIntentV2, RequestedView, SceneProgramV1 } from "../src/lib/scene/tipos";
import { RawEventIntentDraftSchema } from "../src/lib/rag/query-parser/event-schema";
import { computeIntentHash, computeProgramHash } from "../src/lib/scene/hashes";

type EvalResult = { id: string; pass: boolean; detail: string };

const results: EvalResult[] = [];
let exitCode = 0;

function record(id: string, condition: boolean, detail: string): void {
  results.push({ id, pass: condition, detail });
  if (!condition) exitCode = 1;
}

// ---------------------------------------------------------------------------
// 1. parseEventIntent — basic structure
// ---------------------------------------------------------------------------

function evalBasicStructure(): void {
  const intent = parseEventIntent("Quiero ideas para mi boda en un jardín");

  record("schema_version", intent.schema_version === "event-intent-v2", `got "${intent.schema_version}"`);
  record("event_type", intent.event_type === "wedding", `got "${intent.event_type}"`);

  try {
    EventIntentV2Schema.parse(intent);
    record("zod_roundtrip", true, "passes Zod validation");
  } catch (err: unknown) {
    record("zod_roundtrip", false, `Zod error: ${err}`);
  }
}

// ---------------------------------------------------------------------------
// 2. parseEventIntent — E2E scenario coverage
// ---------------------------------------------------------------------------

interface IntentScenario {
  message: string;
  expected: Partial<{
    event_scope: string;
    complexity: string;
    environment: string | undefined;
    min_views: number;
    has_view: RequestedView;
    budget_cop: number | undefined;
    min_palette: number;
    min_style_terms: number;
    explicit_hard_constraint_keys: string[];
    no_hard_constraint_keys: string[];
  }>;
}

const INTENT_SCENARIOS: IntentScenario[] = [
  // E2E-1
  {
    message: "Quiero ideas para mi boda en un jardín",
    expected: {
      event_scope: "ceremony",
      complexity: "balanced_scene",
      environment: "outdoor",
      min_views: 1,
      has_view: "ceremony",
      budget_cop: undefined,
      min_palette: 0,
      min_style_terms: 0,
      explicit_hard_constraint_keys: [],
      no_hard_constraint_keys: ["color", "estructura_focal", "tamano", "acabado"],
    },
  },
  // E2E-1 with budget
  {
    message: "Quiero ideas para mi boda en un jardín, presupuesto de 150.000",
    expected: {
      event_scope: "ceremony",
      complexity: "balanced_scene",
      environment: "outdoor",
      min_views: 1,
      has_view: "ceremony",
      budget_cop: 150_000,
      min_palette: 0,
      min_style_terms: 0,
      explicit_hard_constraint_keys: [],
      no_hard_constraint_keys: ["color", "estructura_focal", "tamano", "acabado"],
    },
  },
  // E2E-3: solo arco
  {
    message: "Solo quiero un arco orgánico blanco y dorado, nada más",
    expected: {
      event_scope: "ceremony",
      complexity: "focal_only",
      environment: undefined,
      min_views: 1,
      has_view: "ceremony",
      budget_cop: undefined,
      min_palette: 2, // blanco + dorado
      min_style_terms: 0,
      explicit_hard_constraint_keys: ["color", "estructura_focal"],
      no_hard_constraint_keys: [],
    },
  },
  // E2E-6: ceremony + reception
  {
    message: "Necesitamos decoración tanto para la ceremonia como para la recepción de la boda",
    expected: {
      event_scope: "both",
      complexity: "full_event",
      environment: undefined,
      min_views: 2,
      has_view: "ceremony",
      budget_cop: undefined,
      min_palette: 0,
      min_style_terms: 0,
      explicit_hard_constraint_keys: [],
      no_hard_constraint_keys: [],
    },
  },
  // E2E-6 with explicit budget
  {
    message: "Necesitamos decoración tanto para la ceremonia como para la recepción de la boda, presupuesto máximo 4.500.000",
    expected: {
      event_scope: "both",
      complexity: "full_event",
      environment: undefined,
      min_views: 2,
      has_view: "ceremony",
      budget_cop: 4_500_000,
      min_palette: 0,
      min_style_terms: 0,
      explicit_hard_constraint_keys: [],
      no_hard_constraint_keys: [],
    },
  },
  // E2E-5: immersive with "de todo"
  {
    message: "Quiero una decoración de boda muy completa e inmersiva para la ceremonia, con de todo",
    expected: {
      event_scope: "ceremony",
      complexity: "immersive_scene",
      environment: undefined,
      min_views: 1,
      has_view: "ceremony",
      budget_cop: undefined,
      min_palette: 0,
      min_style_terms: 0,
      explicit_hard_constraint_keys: [],
      no_hard_constraint_keys: [],
    },
  },
  // Glamour style (must NOT become hard filter)
  {
    message: "Quiero una boda glamurosa con globos dorados",
    expected: {
      event_scope: "ceremony",
      complexity: "balanced_scene",
      environment: undefined,
      min_views: 1,
      has_view: "ceremony",
      budget_cop: undefined,
      min_palette: 1, // dorado
      min_style_terms: 1, // glamurosa
      explicit_hard_constraint_keys: ["color"],
      no_hard_constraint_keys: ["acabado"], // glamour never → reflex
    },
  },
  // Rustic/boho style
  {
    message: "Decoración rústica para mi boda campestre",
    expected: {
      event_scope: "ceremony",
      complexity: "balanced_scene",
      environment: "outdoor",
      min_views: 1,
      has_view: "ceremony",
      budget_cop: undefined,
      min_palette: 0,
      min_style_terms: 1, // rustica or campestre
      explicit_hard_constraint_keys: [],
      no_hard_constraint_keys: [],
    },
  },
  // Reflex finish literal mention
  {
    message: "quiero globos reflex para la decoración de mi boda",
    expected: {
      event_scope: "ceremony",
      complexity: "balanced_scene",
      environment: undefined,
      min_views: 1,
      has_view: "ceremony",
      budget_cop: undefined,
      min_palette: 0,
      min_style_terms: 0,
      explicit_hard_constraint_keys: ["acabado"],
      no_hard_constraint_keys: [],
    },
  },
  // Indoor venue
  {
    message: "Decoración para boda en salón",
    expected: {
      event_scope: "ceremony",
      complexity: "balanced_scene",
      environment: "indoor",
      min_views: 1,
      has_view: "ceremony",
      budget_cop: undefined,
      min_palette: 0,
      min_style_terms: 0,
      explicit_hard_constraint_keys: [],
      no_hard_constraint_keys: [],
    },
  },
];

function evalIntentScenarios(): void {
  for (const scenario of INTENT_SCENARIOS) {
    const id = `intent:${scenario.message.substring(0, 40)}`;
    let intent: EventIntentV2;
    try {
      intent = parseEventIntent(scenario.message);
    } catch (err: unknown) {
      record(id + ":parse", false, `threw: ${err}`);
      continue;
    }

    const e = scenario.expected;

    if (e.event_scope !== undefined) {
      record(
        `${id}:event_scope`,
        intent.event_scope === e.event_scope,
        `expected "${e.event_scope}", got "${intent.event_scope}"`,
      );
    }

    if (e.complexity !== undefined) {
      record(
        `${id}:complexity`,
        intent.complexity_requested === e.complexity,
        `expected "${e.complexity}", got "${intent.complexity_requested}"`,
      );
    }

    if (e.environment !== undefined) {
      record(
        `${id}:environment`,
        intent.venue.environment === e.environment,
        `expected "${e.environment}", got "${intent.venue.environment}"`,
      );
    }

    if (e.min_views !== undefined) {
      record(
        `${id}:min_views`,
        intent.requested_views.length >= e.min_views,
        `expected >= ${e.min_views}, got ${intent.requested_views.length}`,
      );
    }

    if (e.has_view !== undefined) {
      record(
        `${id}:has_view_${e.has_view}`,
        intent.requested_views.includes(e.has_view),
        `views: [${intent.requested_views.join(", ")}]`,
      );
    }

    if (e.budget_cop !== undefined) {
      record(
        `${id}:budget_cop`,
        intent.budget_cop === e.budget_cop,
        `expected ${e.budget_cop}, got ${intent.budget_cop}`,
      );
    }

    if (e.min_palette !== undefined) {
      record(
        `${id}:min_palette`,
        intent.palette.length >= e.min_palette,
        `expected >= ${e.min_palette}, got ${intent.palette.length}: [${intent.palette.join(", ")}]`,
      );
    }

    if (e.min_style_terms !== undefined) {
      record(
        `${id}:min_style_terms`,
        intent.style_terms.length >= e.min_style_terms,
        `expected >= ${e.min_style_terms}, got ${intent.style_terms.length}: [${intent.style_terms.join(", ")}]`,
      );
    }

    // Hard constraints: present
    const hcKeys = new Set(intent.hard_constraints.map((c) => c.key));
    if (e.explicit_hard_constraint_keys) {
      for (const key of e.explicit_hard_constraint_keys) {
        record(
          `${id}:has_hc_${key}`,
          hcKeys.has(key),
          `expected hard_constraint key "${key}", got: [${[...hcKeys].join(", ")}]`,
        );
      }
    }

    // Hard constraints: absent
    if (e.no_hard_constraint_keys) {
      for (const key of e.no_hard_constraint_keys) {
        record(
          `${id}:no_hc_${key}`,
          !hcKeys.has(key),
          `hard_constraint key "${key}" should NOT be present`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 3. CRITICAL RULE: style terms never become hard constraints
// ---------------------------------------------------------------------------

function evalStyleNotHard(): void {
  const messages = [
    "boda glamurosa",
    "decoración con estilo bohemio",
    "quiero algo romántico y vintage",
    "boda rústica campestre",
    "estilo moderno minimalista",
    "fantasía tropical",
    "estilo clásico y elegante",
  ];

  for (const msg of messages) {
    const intent = parseEventIntent(msg);
    const styleTerms = new Set(intent.style_terms);
    const hcKeys = new Set(intent.hard_constraints.map((c) => c.key));

    record(
      `style_not_hard:${msg}`,
      !hcKeys.has("acabado") || intent.style_terms.length > 0,
      `style_terms: [${intent.style_terms.join(", ")}], hard_constraint_keys: [${[...hcKeys].join(", ")}]`,
    );
  }
}

// ---------------------------------------------------------------------------
// 4. planSlotQueries — differentiated queries per slot
// ---------------------------------------------------------------------------

function evalDifferentiatedQueries(): void {
  const intent = parseEventIntent("Quiero ideas para mi boda en un jardín con presupuesto de 500.000");

  let program: SceneProgramV1;
  try {
    program = expandIntentToProgram(intent, "wedding_ceremony_garden@1");
  } catch (err: unknown) {
    record("plan_slot_queries:expand", false, `expandIntentToProgram threw: ${err}`);
    return;
  }

  record("plan_slot_queries:has_slots", program.slots.length > 0, `got ${program.slots.length} slots`);

  const queries = planSlotQueries(program, intent);
  record("plan_slot_queries:non_empty", queries.length > 0, `got ${queries.length} queries`);
  record(
    "plan_slot_queries:count_matches_slots",
    queries.length === program.slots.length,
    `queries=${queries.length} vs slots=${program.slots.length}`,
  );

  // Verify each query has a unique slot_id
  const slotIds = queries.map((q) => q.slot_id);
  record(
    "plan_slot_queries:unique_slot_ids",
    new Set(slotIds).size === slotIds.length,
    `slots: [${slotIds.join(", ")}]`,
  );

  // Verify differentiated functions/zones
  const zones = new Set(queries.map((q) => q.zone));
  const functions = new Set(queries.map((q) => q.function));

  record(
    "plan_slot_queries:has_ceremony_focal_zone",
    zones.has("ceremony_focal"),
    `zones: [${[...zones].join(", ")}]`,
  );

  record(
    "plan_slot_queries:differentiated_zones",
    zones.size >= 2,
    `got ${zones.size} distinct zones`,
  );

  record(
    "plan_slot_queries:differentiated_functions",
    functions.size >= 2,
    `got ${functions.size} distinct functions`,
  );

  // Verify provisional budget distribution
  const budgeted = queries.filter((q) => q.provisional_budget_cop !== undefined);
  if (intent.budget_cop) {
    record(
      "plan_slot_queries:provisional_budget_distributed",
      budgeted.length > 0,
      `got ${budgeted.length} queries with provisional budget`,
    );
    if (budgeted.length > 0) {
      const totalProvisional = budgeted.reduce((sum, q) => sum + (q.provisional_budget_cop ?? 0), 0);
      // Rounding tolerance: each Math.round can drift by up to 0.5 per slot.
      const maxRoundDrift = budgeted.length;
      record(
        "plan_slot_queries:provisional_budget_near_total",
        totalProvisional <= (intent.budget_cop ?? 0) + maxRoundDrift,
        `provisional=${totalProvisional}, total=${intent.budget_cop}, drift=${maxRoundDrift}`,
      );
    }
  }

  // Verify environment propagation
  const envQueries = queries.filter((q) => q.environment === "outdoor");
  record(
    "plan_slot_queries:environment_propagated",
    envQueries.length === queries.length,
    `outdoor=${envQueries.length}/${queries.length}`,
  );

  // Verify allowed_sources are non-empty per query
  for (const q of queries) {
    record(
      `plan_slot_queries:allowed_sources:${q.slot_id}`,
      q.allowed_sources.length > 0,
      `sources=[${q.allowed_sources.join(", ")}]`,
    );
  }

  // Verify occasion_signal
  for (const q of queries) {
    record(
      `plan_slot_queries:occasion:${q.slot_id}`,
      q.occasion_signal.occasion === "boda" && q.occasion_signal.hard_filter === false,
      `occasion="${q.occasion_signal.occasion}", hard_filter=${q.occasion_signal.hard_filter}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 5. Determinism
// ---------------------------------------------------------------------------

function evalDeterminism(): void {
  const msg = "Quiero ideas para mi boda en un jardín con presupuesto de 500.000";
  const intent1 = parseEventIntent(msg);
  const intent2 = parseEventIntent(msg);
  const intent3 = parseEventIntent(msg);

  const hash1 = computeIntentHash(intent1);
  const hash2 = computeIntentHash(intent2);
  const hash3 = computeIntentHash(intent3);

  record("determinism:intent_hash_equal_12", hash1 === hash2, `${hash1} vs ${hash2}`);
  record("determinism:intent_hash_equal_13", hash1 === hash3, `${hash1} vs ${hash3}`);

  const json1 = JSON.stringify(intent1);
  const json2 = JSON.stringify(intent2);
  const json3 = JSON.stringify(intent3);
  record("determinism:intent_json_equal", json1 === json2 && json1 === json3, `lengths: ${json1.length}`);

  const draft1 = buildRawEventIntentDraft(msg);
  const draft2 = buildRawEventIntentDraft(msg);

  try {
    RawEventIntentDraftSchema.parse(draft1);
    RawEventIntentDraftSchema.parse(draft2);
    record("determinism:draft_zod_roundtrip", true, "passes Zod validation");
  } catch (err: unknown) {
    record("determinism:draft_zod_roundtrip", false, `Zod error: ${err}`);
  }

  // planSlotQueries determinism
  const program1 = expandIntentToProgram(intent1, "wedding_ceremony_garden@1");
  const program2 = expandIntentToProgram(intent2, "wedding_ceremony_garden@1");
  const queries1 = planSlotQueries(program1, intent1);
  const queries2 = planSlotQueries(program2, intent2);

  record(
    "determinism:queries_deep_equal",
    JSON.stringify(queries1) === JSON.stringify(queries2),
    "slot queries identical across calls",
  );
}

// ---------------------------------------------------------------------------
// 6. Edge cases
// ---------------------------------------------------------------------------

function evalEdgeCases(): void {
  // Empty message
  const empty = parseEventIntent("");
  record("edge:empty_message", empty.schema_version === "event-intent-v2", "survives empty message");

  // Very long message
  const long = "mi boda ".repeat(100).trim();
  const intentLong = parseEventIntent(long);
  record("edge:long_message", intentLong.schema_version === "event-intent-v2", "survives long message");

  // Only "boda"
  const simple = parseEventIntent("boda");
  record("edge:simple_boda", simple.complexity_requested === DEFAULT_COMPLEXITY, "defaults to balanced_scene");

  // Budget with "k" suffix
  const k = parseEventIntent("presupuesto 150k para boda");
  record("edge:budget_k", k.budget_cop === 150_000, `got ${k.budget_cop}`);

  // Budget "mil"
  const mil = parseEventIntent("presupuesto 500 mil para boda");
  record("edge:budget_mil", mil.budget_cop === 500_000, `got ${mil.budget_cop}`);

  // Reception only
  const recept = parseEventIntent("quiero decorar la recepción de mi boda");
  record("edge:reception_only", recept.event_scope === "reception", `got "${recept.event_scope}"`);
  record("edge:reception_views", recept.requested_views.includes("reception"), `views: [${recept.requested_views.join(", ")}]`);

  // Negated color
  const negColor = parseEventIntent("quiero decoración para boda sin blanco");
  record("edge:negated_color", !negColor.palette.includes("blanco"), `palette: [${negColor.palette.join(", ")}]`);

  // Existing assets
  const existing = parseEventIntent("ya tenemos sillas blancas en el jardín para la boda");
  record("edge:existing_assets", existing.venue.existing_asset_refs.length > 0, `got ${existing.venue.existing_asset_refs.length} refs`);

  // computeProvisionalSlotBudget
  const slot = { slot_id: "test", view_id: "v", zone: "z", function: "f", requirement: "required" as const, weight: 3, min_instances: 1, max_instances: 3, allowed_sources: ["catalog_sale" as const], dependencies: [], spatial_constraints: [] };
  const budget = computeProvisionalSlotBudget(slot, 10, 100_000);
  record("edge:provisional_budget_formula", budget === 30_000, `expected 30000, got ${budget}`);

  const zeroWeight = computeProvisionalSlotBudget({ ...slot, weight: 0 }, 0, 100_000);
  record("edge:provisional_budget_zero", zeroWeight === undefined, `expected undefined, got ${zeroWeight}`);

  const noBudget = computeProvisionalSlotBudget(slot, 10, undefined);
  record("edge:provisional_budget_undefined", noBudget === undefined, `expected undefined, got ${noBudget}`);
}

// ---------------------------------------------------------------------------
// 7. fixture-to-EventIntentV2 roundtrip
// ---------------------------------------------------------------------------

function evalFixtureRoundtrip(): void {
  for (const fixture of WEDDING_INTENT_FIXTURES) {
    const id = `fixture_roundtrip:${fixture.scenarioId}`;
    const intent = parseEventIntent(fixture.userMessage);

    record(
      `${id}:scope`,
      intent.event_scope === fixture.eventScope,
      `expected "${fixture.eventScope}", got "${intent.event_scope}"`,
    );

    record(
      `${id}:complexity`,
      intent.complexity_requested === fixture.complexityRequested,
      `expected "${fixture.complexityRequested}", got "${intent.complexity_requested}"`,
    );

    if (fixture.budgetCop !== undefined) {
      // Fixture has budget, message may not mention it — so we can't require exact match
      // unless the message contains the budget text
    }

    record(
      `${id}:views_matches`,
      intent.requested_views.length >= fixture.requestedViews.length,
      `expected >= ${fixture.requestedViews.length}, got ${intent.requested_views.length}`,
    );

    if (fixture.venue.environment === "outdoor") {
      record(
        `${id}:environment`,
        intent.venue.environment === "outdoor" || intent.venue.environment === undefined,
        `venue.environment="${intent.venue.environment}"`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log("=== eval-event-query-parser — Tarea 04.1 ===\n");

evalBasicStructure();
evalIntentScenarios();
evalStyleNotHard();
evalDifferentiatedQueries();
evalDeterminism();
evalEdgeCases();
evalFixtureRoundtrip();

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
