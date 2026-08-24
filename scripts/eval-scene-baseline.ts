/**
 * Tarea 00.1 (Ola 0 — línea base) de PLAN_ARQUITECTURA_ESCENA_COMPLETA_RAG.md.
 *
 * Lee los fixtures deterministas de intención (`src/lib/scene/__fixtures__/wedding-intents.ts`)
 * y de capacidad de catálogo (`src/lib/scene/__fixtures__/catalog-capability-snapshots.ts`) y
 * emite un diagnóstico determinista en JSON que muestra, para cada uno de los 8 escenarios E2E
 * obligatorios de la sección 12 del plan: el perfil solicitado, si el catálogo alcanza para
 * cubrir las funciones/zonas obligatorias de una boda `balanced_scene` (focal, pasillo,
 * asientos, floral, iluminación), y el perfil realmente alcanzable.
 *
 * Objetivo explícito de este script: demostrar objetivamente que el escenario E2E-1 (catálogo
 * actual, 150.000 COP) falla por COBERTURA SEMÁNTICA insuficiente — no porque el PlanDecoracion
 * V1 resultante sea inválido — mientras que E2E-2 (mismo intento, catálogo rico verificado) sí
 * cubre esas mismas funciones.
 *
 * Este script es puro cálculo sobre fixtures en memoria:
 *  - no llama a Gemini, fal.ai ni ningún proveedor externo;
 *  - no abre conexión a PostgreSQL ni modifica ninguna base de datos;
 *  - produce el mismo JSON en corridas repetidas (no usa Date.now()/Math.random()).
 *
 * IMPORTANTE sobre los umbrales de presupuesto (`MIN_BUDGET_COP_BY_TIER`): son una heurística
 * gruesa de Ola 0, exclusivamente para separar "el catálogo no alcanza" de "el presupuesto no
 * alcanza" en estos fixtures. El cálculo de costo real, reconciliable al peso, es
 * responsabilidad del optimizador/resolver de la Ola 3 (Tarea 05.1/05.2) — este script no lo
 * sustituye.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import {
  CATALOG_CAPABILITY_SNAPSHOTS,
  SCENE_FUNCTIONS,
  capabilityFor,
  findCatalogSnapshot,
  findOfferLifecycleFixture,
  type CatalogCapabilitySnapshot,
  type SceneFunctionId,
} from "../src/lib/scene/__fixtures__/catalog-capability-snapshots";
import {
  WEDDING_INTENT_FIXTURES,
  type ComplexityProfileLite,
  type WeddingIntentFixture,
} from "../src/lib/scene/__fixtures__/wedding-intents";

// ---------------------------------------------------------------------------
// Escalera de perfiles (sección 5.1) y umbrales de presupuesto Ola 0.
// ---------------------------------------------------------------------------

const PROFILE_TIERS: Record<ComplexityProfileLite, number> = {
  focal_only: 0,
  balanced_scene: 1,
  immersive_scene: 2,
  full_event: 3,
};
const TIER_PROFILES: ComplexityProfileLite[] = ["focal_only", "balanced_scene", "immersive_scene", "full_event"];

/** Heurística Ola 0 — ver nota superior. */
const MIN_BUDGET_COP_BY_TIER: Record<number, number> = {
  0: 100_000,
  1: 150_000,
  2: 3_000_000,
  3: 4_000_000,
};

/** Familias/funciones mínimas exigidas por perfil (receta `wedding_ceremony_garden@1`, sección 5.4). */
const MIN_DISTINCT_FAMILIES_BY_TIER: Record<number, number> = {
  0: 1,
  1: 4,
  2: 6,
  3: 4,
};

type RequirementGroup = {
  id: string;
  label: string;
  candidateFunctions: SceneFunctionId[];
};

const FOCAL_STRUCTURE_GROUP: RequirementGroup = {
  id: "focal_structure",
  label: "Estructura o superficie focal (ceremony_focal)",
  candidateFunctions: ["altar_frame", "focal_backdrop"],
};
const FOCAL_DECOR_GROUP: RequirementGroup = {
  id: "focal_decor",
  label: "Decoración focal (ceremony_focal)",
  candidateFunctions: ["focal_decor", "floral_foliage_accent", "balloon_accent"],
};
const AISLE_GROUP: RequirementGroup = {
  id: "aisle",
  label: "Delimitación de pasillo (ceremony_aisle)",
  candidateFunctions: ["aisle_runner", "aisle_marker"],
};
const SEATING_GROUP: RequirementGroup = {
  id: "seating",
  label: "Asientos visibles (guest_seating)",
  candidateFunctions: ["guest_chair"],
};
const BOTANICAL_ACCENT_GROUP: RequirementGroup = {
  id: "botanical_accent",
  label: "Acento botánico dedicado (immersive_scene, focal/pasillo)",
  candidateFunctions: ["floral_foliage_accent"],
};
const AMBIENT_LIGHT_GROUP: RequirementGroup = {
  id: "ambient_light",
  label: "Iluminación ambiental (condicional por horario, ambient_overhead)",
  candidateFunctions: ["ambient_light"],
};
const RECEPTION_TABLE_GROUP: RequirementGroup = {
  id: "reception_table_surface",
  label: "Superficie de mesa (reception_guest_tables)",
  candidateFunctions: ["table_surface"],
};
const RECEPTION_LINEN_GROUP: RequirementGroup = {
  id: "reception_linen",
  label: "Mantelería (reception_guest_tables)",
  candidateFunctions: ["linen"],
};
const RECEPTION_CENTERPIECE_GROUP: RequirementGroup = {
  id: "reception_centerpiece",
  label: "Centro de mesa (reception_guest_tables)",
  candidateFunctions: ["centerpiece"],
};
const RECEPTION_SEATING_GROUP: RequirementGroup = {
  id: "reception_seating",
  label: "Asientos de recepción (reception_guest_tables)",
  candidateFunctions: ["guest_chair"],
};

/** Funciones que titulan el hallazgo pedido explícitamente: mobiliario, floral, iluminación. */
const CRITICAL_WEDDING_FUNCTION_CATEGORIES: Record<string, SceneFunctionId[]> = {
  mobiliario: ["guest_chair", "table_surface", "table_setting"],
  floral: ["floral_foliage_accent", "focal_decor", "centerpiece"],
  iluminacion: ["ambient_light", "floor_light"],
};

// ---------------------------------------------------------------------------
// Cobertura por función para un fixture dado.
// ---------------------------------------------------------------------------

type FunctionCoverage = {
  function: SceneFunctionId;
  covered: boolean;
  coveredBy: "catalog" | "venue_existing" | "none";
  verifiedOfferCount: number;
};

function computeFunctionCoverage(
  fixture: WeddingIntentFixture,
  snapshot: CatalogCapabilitySnapshot,
): Record<SceneFunctionId, FunctionCoverage> {
  const result = {} as Record<SceneFunctionId, FunctionCoverage>;
  for (const fn of SCENE_FUNCTIONS) {
    const verifiedOfferCount = capabilityFor(snapshot, fn)?.verifiedOfferCount ?? 0;
    const venueExisting = fixture.venue.existingAssets.some((asset) => asset.function === fn);
    const covered = verifiedOfferCount > 0 || venueExisting;
    result[fn] = {
      function: fn,
      covered,
      coveredBy: venueExisting ? "venue_existing" : verifiedOfferCount > 0 ? "catalog" : "none",
      verifiedOfferCount,
    };
  }
  return result;
}

function groupCovered(group: RequirementGroup, coverage: Record<SceneFunctionId, FunctionCoverage>): boolean {
  return group.candidateFunctions.some((fn) => coverage[fn]!.covered);
}

function distinctFamiliesCovered(coverage: Record<SceneFunctionId, FunctionCoverage>): number {
  return SCENE_FUNCTIONS.filter((fn) => coverage[fn]!.covered).length;
}

/** Grupos obligatorios de un perfil de ceremonia hasta el tier dado (sin full_event). */
function ceremonyGroupsForTier(tier: number, requiresAmbientLight: boolean): RequirementGroup[] {
  const groups: RequirementGroup[] = [];
  if (tier >= 0) groups.push(FOCAL_STRUCTURE_GROUP, FOCAL_DECOR_GROUP);
  if (tier >= 1) groups.push(AISLE_GROUP, SEATING_GROUP);
  if (tier >= 2) groups.push(BOTANICAL_ACCENT_GROUP);
  if (requiresAmbientLight) groups.push(AMBIENT_LIGHT_GROUP);
  return groups;
}

const RECEPTION_GROUPS: RequirementGroup[] = [
  RECEPTION_TABLE_GROUP,
  RECEPTION_LINEN_GROUP,
  RECEPTION_CENTERPIECE_GROUP,
  RECEPTION_SEATING_GROUP,
];

function ceremonyTierSatisfied(
  tier: number,
  fixture: WeddingIntentFixture,
  coverage: Record<SceneFunctionId, FunctionCoverage>,
): boolean {
  const groups = ceremonyGroupsForTier(tier, fixture.requiresAmbientLight);
  const groupsOk = groups.every((group) => groupCovered(group, coverage));
  const familiesOk = distinctFamiliesCovered(coverage) >= MIN_DISTINCT_FAMILIES_BY_TIER[Math.min(tier, 2)]!;
  return groupsOk && familiesOk;
}

function receptionCoreSatisfied(coverage: Record<SceneFunctionId, FunctionCoverage>): boolean {
  return RECEPTION_GROUPS.every((group) => groupCovered(group, coverage));
}

/**
 * Tier de catálogo alcanzable (0..3), acotado por el tier solicitado — el diagnóstico no
 * "sube de categoría" más allá de lo pedido, solo reporta si lo pedido (o algo menor) es
 * alcanzable con la cobertura disponible.
 */
function catalogAchievableTier(fixture: WeddingIntentFixture, coverage: Record<SceneFunctionId, FunctionCoverage>): number {
  const requestedTier = PROFILE_TIERS[fixture.complexityRequested];

  if (requestedTier === 3) {
    const ceremonyOk = fixture.requestedViews.includes("ceremony") ? ceremonyTierSatisfied(1, fixture, coverage) : true;
    const receptionOk = fixture.requestedViews.includes("reception") ? receptionCoreSatisfied(coverage) : true;
    if (fixture.requestedViews.length >= 2 && ceremonyOk && receptionOk) return 3;
    // Degradación: al menos la vista de ceremonia sola como balanced_scene.
    if (ceremonyTierSatisfied(1, fixture, coverage)) return 1;
    if (ceremonyTierSatisfied(0, fixture, coverage)) return 0;
    return -1;
  }

  for (let tier = requestedTier; tier >= 0; tier -= 1) {
    if (ceremonyTierSatisfied(tier, fixture, coverage)) return tier;
  }
  return -1;
}

function budgetAchievableTier(fixture: WeddingIntentFixture): number {
  const requestedTier = PROFILE_TIERS[fixture.complexityRequested];
  if (fixture.budgetCop === undefined) return requestedTier;
  for (let tier = requestedTier; tier >= 0; tier -= 1) {
    if (fixture.budgetCop >= MIN_BUDGET_COP_BY_TIER[tier]!) return tier;
  }
  return -1;
}

type ScenarioReport = {
  scenarioId: string;
  title: string;
  requestedProfile: ComplexityProfileLite;
  achievedProfile: ComplexityProfileLite | "BLOCKED";
  catalogSnapshotId: string;
  catalogSnapshotLabel: string;
  status: "COMPLETE" | "PARTIAL" | "BLOCKED";
  limitingFactor: "none" | "catalog_coverage" | "budget";
  distinctFamiliesCovered: number;
  requiredGroupGaps: Array<{ groupId: string; label: string; candidateFunctions: SceneFunctionId[]; reason: "NO_SOURCE" }>;
  criticalWeddingFunctionCoverage: Record<
    string,
    Array<{ function: SceneFunctionId; covered: boolean; coveredBy: FunctionCoverage["coveredBy"]; verifiedOfferCount: number }>
  >;
  offerLifecycle?: {
    offerLifecycleId: string;
    offerId: string;
    initialFingerprint: string;
    revisedFingerprint: string;
    fingerprintChanged: boolean;
    changeReason: string;
  };
  notes: string;
};

function offerFingerprint(payload: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}

function evaluateScenario(fixture: WeddingIntentFixture): ScenarioReport {
  const snapshot = findCatalogSnapshot(fixture.catalogSnapshotId);
  const coverage = computeFunctionCoverage(fixture, snapshot);
  const requestedTier = PROFILE_TIERS[fixture.complexityRequested];

  const catalogTier = catalogAchievableTier(fixture, coverage);
  const budgetTier = budgetAchievableTier(fixture);
  const achievedTierRaw = Math.min(requestedTier, catalogTier, budgetTier);

  let status: ScenarioReport["status"];
  let achievedProfile: ScenarioReport["achievedProfile"];
  if (achievedTierRaw < 0) {
    status = "BLOCKED";
    achievedProfile = "BLOCKED";
  } else if (achievedTierRaw === requestedTier) {
    status = "COMPLETE";
    achievedProfile = fixture.complexityRequested;
  } else {
    status = "PARTIAL";
    achievedProfile = TIER_PROFILES[achievedTierRaw]!;
  }

  const limitingFactor: ScenarioReport["limitingFactor"] =
    achievedTierRaw === requestedTier ? "none" : catalogTier <= budgetTier ? "catalog_coverage" : "budget";

  // Grupos requeridos al perfil SOLICITADO (no al alcanzado) para reportar brechas honestas.
  const requestedGroups: RequirementGroup[] =
    requestedTier === 3
      ? [...ceremonyGroupsForTier(1, fixture.requiresAmbientLight), ...RECEPTION_GROUPS]
      : ceremonyGroupsForTier(requestedTier, fixture.requiresAmbientLight);

  const requiredGroupGaps = requestedGroups
    .filter((group) => !groupCovered(group, coverage))
    .map((group) => ({
      groupId: group.id,
      label: group.label,
      candidateFunctions: group.candidateFunctions,
      reason: "NO_SOURCE" as const,
    }));

  const criticalWeddingFunctionCoverage: ScenarioReport["criticalWeddingFunctionCoverage"] = {};
  for (const [category, functions] of Object.entries(CRITICAL_WEDDING_FUNCTION_CATEGORIES)) {
    criticalWeddingFunctionCoverage[category] = functions.map((fn) => ({
      function: fn,
      covered: coverage[fn]!.covered,
      coveredBy: coverage[fn]!.coveredBy,
      verifiedOfferCount: coverage[fn]!.verifiedOfferCount,
    }));
  }

  let offerLifecycle: ScenarioReport["offerLifecycle"];
  if (fixture.offerLifecycleFixtureId) {
    const lifecycle = findOfferLifecycleFixture(fixture.offerLifecycleFixtureId);
    const initialFingerprint = offerFingerprint(lifecycle.initialOffer);
    const revisedFingerprint = offerFingerprint(lifecycle.revisedOffer);
    offerLifecycle = {
      offerLifecycleId: lifecycle.offerLifecycleId,
      offerId: lifecycle.offerId,
      initialFingerprint,
      revisedFingerprint,
      fingerprintChanged: initialFingerprint !== revisedFingerprint,
      changeReason: lifecycle.revisedOffer.changeReason,
    };
  }

  return {
    scenarioId: fixture.scenarioId,
    title: fixture.title,
    requestedProfile: fixture.complexityRequested,
    achievedProfile,
    catalogSnapshotId: snapshot.snapshotId,
    catalogSnapshotLabel: snapshot.label,
    status,
    limitingFactor,
    distinctFamiliesCovered: distinctFamiliesCovered(coverage),
    requiredGroupGaps,
    criticalWeddingFunctionCoverage,
    offerLifecycle,
    notes: fixture.notes,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  assert.equal(WEDDING_INTENT_FIXTURES.length >= 8, true, "se requieren al menos 8 escenarios fixture (sección 12 del plan)");
  assert.equal(CATALOG_CAPABILITY_SNAPSHOTS.length >= 2, true, "se requieren al menos 2 snapshots de catálogo (actual + rico)");

  const scenarios = WEDDING_INTENT_FIXTURES.map(evaluateScenario);

  const scenario1 = scenarios.find((scenario) => scenario.scenarioId === "E2E-1")!;
  const scenario2 = scenarios.find((scenario) => scenario.scenarioId === "E2E-2")!;

  // --- Aserción central de la Tarea 00.1: el catálogo actual NO cubre mobiliario/floral/iluminación.
  const scenario1UncoveredCritical = Object.values(scenario1.criticalWeddingFunctionCoverage)
    .flat()
    .filter((entry) => !entry.covered);
  assert.ok(
    scenario1UncoveredCritical.length > 0,
    "[REGRESIÓN] E2E-1 (catálogo actual) debería mostrar funciones críticas de boda sin cobertura (mobiliario/floral/iluminación)",
  );
  assert.notEqual(
    scenario1.status,
    "COMPLETE",
    "[REGRESIÓN] E2E-1 (catálogo actual, 150.000 COP) no debe reportarse como escena COMPLETE",
  );
  assert.equal(
    scenario1.limitingFactor,
    "catalog_coverage",
    "[REGRESIÓN] E2E-1 debe fallar por cobertura de catálogo, no por presupuesto — es el hallazgo central de la Tarea 00.1",
  );

  // --- Contraste requerido: el catálogo rico SÍ cubre esas mismas funciones para la misma intención.
  const scenario2UncoveredCritical = Object.values(scenario2.criticalWeddingFunctionCoverage)
    .flat()
    .filter((entry) => !entry.covered);
  assert.equal(
    scenario2UncoveredCritical.length,
    0,
    "[REGRESIÓN] E2E-2 (catálogo rico) debería cubrir todas las funciones críticas de mobiliario/floral/iluminación",
  );
  assert.equal(
    scenario2.status,
    "COMPLETE",
    "[REGRESIÓN] E2E-2 (catálogo rico, misma intención que E2E-1) debería alcanzar el perfil balanced_scene solicitado",
  );

  const scenario7 = scenarios.find((scenario) => scenario.scenarioId === "E2E-7")!;
  assert.ok(scenario7.offerLifecycle, "[REGRESIÓN] E2E-7 debe traer un fixture de ciclo de vida de oferta");
  assert.equal(
    scenario7.offerLifecycle!.fingerprintChanged,
    true,
    "[REGRESIÓN] E2E-7 debe demostrar que la huella de la oferta cambia tras la revisión (para invalidación de hash futura)",
  );

  const report = {
    schema: "scene-baseline-eval-v1",
    plan: "PLAN_ARQUITECTURA_ESCENA_COMPLETA_RAG.md",
    task: "00.1 — Fixtures de intención y catálogo",
    fixturesEvaluated: scenarios.length,
    catalogSnapshotsRegistered: CATALOG_CAPABILITY_SNAPSHOTS.map((snapshot) => ({
      snapshotId: snapshot.snapshotId,
      label: snapshot.label,
      totals: snapshot.totals,
      weddingTaggedProducts: snapshot.weddingTaggedProducts,
    })),
    headlineFinding: {
      scenarioId: "E2E-1",
      statement:
        "El catálogo actual (1.411 productos) no tiene cobertura comercial verificable para mobiliario, floristería " +
        "física ni iluminación física. La propuesta 'solo arco' para una boda en jardín balanced_scene falla por " +
        "cobertura semántica insuficiente, no por invalidez del PlanDecoracion V1.",
      status: scenario1.status,
      limitingFactor: scenario1.limitingFactor,
      uncoveredCriticalFunctions: scenario1UncoveredCritical.map((entry) => entry.function),
    },
    contrastFinding: {
      scenarioId: "E2E-2",
      statement: "La misma intención contra un catálogo rico verificado sí cubre focal, pasillo, asientos y acentos.",
      status: scenario2.status,
    },
    scenarios,
  };

  mkdirSync("reports", { recursive: true });
  const outputPath = "reports/eval-scene-baseline.json";
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  console.error(
    `[PASS] scene:eval-baseline — ${scenarios.length} escenarios evaluados; E2E-1 status=${scenario1.status} ` +
      `(limitingFactor=${scenario1.limitingFactor}); E2E-2 status=${scenario2.status}; reporte=${outputPath}`,
  );
}

try {
  main();
} catch (error) {
  console.error(`[FAIL] scene:eval-baseline — ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
