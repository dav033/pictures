/**
 * Orquestador completo del pipeline de escena V2 (Plan 06.1 —
 * `PLAN_ARQUITECTURA_ESCENA_COMPLETA_RAG.md`, sección 11, Plan 06).
 *
 * `orchestrateScenePipeline(mensaje, pool)` ejecuta el pipeline completo:
 *   mensaje → EventIntentV2 → SceneProgramV1 → SlotQuery[] →
 *   SlotRetrievalResult[] → ScoredSlotCandidate[][] →
 *   SceneOptimizerResult → ResolvedScenePlan
 *
 * Cada paso es determinista y trazable. El costo total y la aprobación
 * salen exclusivamente del último paso (resolver).
 *
 * SHADOW MODE: cuando `SCENE_PLAN_V2_SHADOW=true`, el pipeline se ejecuta
 * pero no se expone al usuario. Sirve para comparar con V1 y registrar
 * métricas sin afectar la experiencia.
 */

import "server-only";
import type { Pool } from "pg";
import { parseEventIntent } from "../rag/query-parser/parse-event";
import { expandIntentToProgram, selectSceneRecipeId } from "./recipes";
import { planSlotQueries } from "../rag/retrieval/slot-query-planner";
import { retrieveCandidatesBySlot } from "../rag/retrieval/by-scene-slot";
import { rerankSlotCandidates } from "../rag/retrieval/scene-rerank";
import { optimizeSceneCoverage } from "./optimizer";
import { resolveScenePlan, type ResolvedScenePlan } from "./resolver";
import { computeProgramHash } from "./hashes";
import type { EventIntentV2, SceneProgramV1 } from "./tipos";
import type { SlotRetrievalResult } from "../rag/retrieval/by-scene-slot";
import type { ScoredSlotCandidate } from "../rag/retrieval/scene-rerank";
import type { SceneOptimizerResult } from "./optimizer";

// ---------------------------------------------------------------------------
// Resultado del pipeline
// ---------------------------------------------------------------------------

export type ScenePipelineResult = {
  /** Plan resuelto final (con costos, aprobación, brechas). */
  resolved_plan: ResolvedScenePlan;
  /** Intención extraída del mensaje. */
  intent: EventIntentV2;
  /** Programa de escena expandido. */
  program: SceneProgramV1;
  /** Resultado del optimizador (selecciones y gaps por slot). */
  optimizer: SceneOptimizerResult;
  /** Resultados crudos del retrieval por slot. */
  retrieval: SlotRetrievalResult[];
  /** Latencia total en ms. */
  latency_total_ms: number;
  /** Receta usada. */
  recipe_id: string;
};

export type ScenePipelineError = {
  error: string;
  stage: "parse" | "expand" | "plan" | "retrieve" | "optimize" | "resolve";
};

// ---------------------------------------------------------------------------
// Orquestador principal
// ---------------------------------------------------------------------------

/**
 * Ejecuta el pipeline completo de escena V2 desde un mensaje del cliente.
 *
 * `budget_cop` opcional: si el llamador ya tiene un presupuesto verificado
 * (p. ej. de un formulario anterior), lo pasa aquí para que el optimizador
 * lo use como techo duro sin depender de que el texto lo mencione.
 */
export async function orchestrateScenePipeline(
  mensaje: string,
  pool: Pool,
  opts?: {
    recipeId?: string;
    budgetCop?: number;
    concurrency?: number;
  },
): Promise<ScenePipelineResult | ScenePipelineError> {
  const t0 = performance.now();

  // 1. Parse intent
  let intent: EventIntentV2;
  try {
    intent = parseEventIntent(mensaje);
  } catch (err: unknown) {
    return { error: `parseEventIntent: ${err}`, stage: "parse" };
  }

  // Override budget if caller provides one
  if (opts?.budgetCop !== undefined && intent.budget_cop === undefined) {
    intent = { ...intent, budget_cop: opts.budgetCop };
  }

  // 2. Expand to program
  let program: SceneProgramV1;
  const recipeId = opts?.recipeId ?? selectSceneRecipeId(intent);
  try {
    program = expandIntentToProgram(intent, recipeId);
  } catch (err: unknown) {
    return { error: `expandIntentToProgram: ${err}`, stage: "expand" };
  }

  // 3. Plan slot queries
  let slotQueries;
  try {
    slotQueries = planSlotQueries(program, intent);
  } catch (err: unknown) {
    return { error: `planSlotQueries: ${err}`, stage: "plan" };
  }

  // 4. Retrieve candidates per slot
  let slotResults: SlotRetrievalResult[];
  try {
    slotResults = await retrieveCandidatesBySlot(pool, slotQueries, {
      concurrency: opts?.concurrency ?? 4,
    });
  } catch (err: unknown) {
    return { error: `retrieveCandidatesBySlot: ${err}`, stage: "retrieve" };
  }

  // 5. Rerank per slot
  const rerankedBySlot: Array<{ slot_id: string; candidates: ScoredSlotCandidate[] }> = [];
  for (const result of slotResults) {
    const slotQuery = slotQueries.find((q) => q.slot_id === result.slot_id);
    if (slotQuery && result.candidates.length > 0) {
      const scored = rerankSlotCandidates(slotQuery, result.candidates);
      rerankedBySlot.push({ slot_id: result.slot_id, candidates: scored });
    } else {
      rerankedBySlot.push({ slot_id: result.slot_id, candidates: [] });
    }
  }

  // 6. Optimize
  let optimizerResult: SceneOptimizerResult;
  try {
    optimizerResult = optimizeSceneCoverage(program, rerankedBySlot, intent.budget_cop);
  } catch (err: unknown) {
    return { error: `optimizeSceneCoverage: ${err}`, stage: "optimize" };
  }

  // 7. Resolve
  let resolvedPlan: ResolvedScenePlan;
  try {
    resolvedPlan = resolveScenePlan(optimizerResult, program);
    resolvedPlan = { ...resolvedPlan, program_hash: computeProgramHash(program) };
  } catch (err: unknown) {
    return { error: `resolveScenePlan: ${err}`, stage: "resolve" };
  }

  const t1 = performance.now();

  return {
    resolved_plan: resolvedPlan,
    intent,
    program,
    optimizer: optimizerResult,
    retrieval: slotResults,
    latency_total_ms: Math.round(t1 - t0),
    recipe_id: recipeId,
  };
}

// ---------------------------------------------------------------------------
// Shadow mode: ejecuta V2 y compara con V1 sin exponer al usuario
// ---------------------------------------------------------------------------

export type ShadowComparison = {
  v1_exists: boolean;
  v2_ran: boolean;
  v2_slots_covered: number;
  v2_total_slots: number;
  v2_gaps: number;
  v2_approved: boolean;
  latency_v2_ms: number;
  error?: string;
};

/**
 * Ejecuta el pipeline V2 en modo shadow: registra métricas, compara con V1,
 * pero siempre devuelve `null` como plan para que el llamador no lo exponga.
 */
export async function sceneShadowPipeline(
  mensaje: string,
  pool: Pool,
  v1StructureCount: number,
): Promise<ShadowComparison> {
  const result = await orchestrateScenePipeline(mensaje, pool);

  if ("error" in result) {
    return {
      v1_exists: v1StructureCount > 0,
      v2_ran: false,
      v2_slots_covered: 0,
      v2_total_slots: 0,
      v2_gaps: 0,
      v2_approved: false,
      latency_v2_ms: 0,
      error: result.error,
    };
  }

  return {
    v1_exists: v1StructureCount > 0,
    v2_ran: true,
    v2_slots_covered: result.optimizer.selections.length,
    v2_total_slots: result.program.slots.length,
    v2_gaps: result.optimizer.gaps.length,
    v2_approved: result.resolved_plan.approval === "COMPLETE" || result.resolved_plan.approval === "APPROVED",
    latency_v2_ms: result.latency_total_ms,
    error: result.resolved_plan.approval_blockers.length > 0
      ? result.resolved_plan.approval_blockers.join("; ")
      : undefined,
  };
}
