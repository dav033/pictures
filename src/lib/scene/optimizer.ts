/**
 * Optimizador global de cobertura de escena (Tarea 05.1 —
 * `PLAN_ARQUITECTURA_ESCENA_COMPLETA_RAG.md`, sección 9.4).
 *
 * Toma los candidatos recuperados por slot (ya rerankeados), aplica
 * restricciones duras (presupuesto, fuente, compatibilidad, dependencias) y
 * selecciona un conjunto global que maximiza el objetivo lexicográfico:
 *
 *   1. Cubrir todos los slots obligatorios.
 *   2. Maximizar cobertura ponderada.
 *   3. Alcanzar diversidad mínima de familias.
 *   4. Respetar coherencia visual y espacial.
 *   5. Minimizar costo y sobrantes de paquetes.
 *   6. Preferir evidencia y disponibilidad más fuertes.
 *
 * Score compuesto:
 *   score = 1000 * required_coverage
 *         + 100  * weighted_coverage
 *         + 20   * family_diversity
 *         + 10   * compatibility
 *         + 5    * source_confidence
 *         - normalized_cost
 *         - package_waste
 *
 * Determinista: mismo input → mismo output (mismo orden, mismas selecciones).
 */

import { areDependenciesSatisfied, checkEligibility, isSameItem } from "./compatibility";
import type { SceneProgramV1, SceneSlot, SlotCandidate } from "./tipos";
import type { ScoredSlotCandidate } from "../rag/retrieval/scene-rerank";
import type { SlotGapKind } from "../rag/retrieval/by-scene-slot";

// ---------------------------------------------------------------------------
// Tipos de salida
// ---------------------------------------------------------------------------

export type SceneSelection = {
  slot_id: string;
  candidate: SlotCandidate;
  /** Costo estimado en COP enteros del candidato en este slot. */
  estimated_cost_cop: number;
};

export type SceneOptimizerGap = {
  slot_id: string;
  kind: SlotGapKind | "INCOMPATIBLE" | "BUDGET" | "DEPENDENCY_FAILED" | "NO_ELIGIBLE_CANDIDATE";
  reason: string;
};

export type SceneOptimizerResult = {
  selections: SceneSelection[];
  gaps: SceneOptimizerGap[];
  /** Fracción de slots REQUIRED cubiertos (0-1). */
  required_coverage: number;
  /** Cobertura ponderada: suma de pesos de slots cubiertos / suma de pesos de todos los slots. */
  weighted_coverage: number;
  /** Número de familias semánticas distintas en la selección. */
  family_diversity: number;
  /** Costo total estimado en COP enteros. */
  estimated_total_cop: number;
  /** Score compuesto lexicográfico (más alto = mejor). */
  score: number;
};

// ---------------------------------------------------------------------------
// Pesos del score
// ---------------------------------------------------------------------------

const WC_REQUIRED = 1000;
const WC_WEIGHTED = 100;
const WC_FAMILY = 20;
const WC_COMPAT = 10;
const WC_SOURCE = 5;

// ---------------------------------------------------------------------------
// Familias semánticas
// ---------------------------------------------------------------------------

/**
 * Deriva la "familia" de un candidato a partir de `category_v3`.
 * La diversidad se mide como cantidad de familias distintas, nunca como
 * cantidad de SKU distintos.
 */
function candidateFamily(candidate: SlotCandidate): string {
  return candidate.item.category_v3;
}

// ---------------------------------------------------------------------------
// Orden de asignación: obligatorios primero, luego por peso descendente.
// ---------------------------------------------------------------------------

function slotPriority(slot: SceneSlot): number {
  switch (slot.requirement) {
    case "required":
      return 0;
    case "conditional":
      return 1;
    case "optional":
      return 2;
  }
}

function sortSlotsForAssignment(
  slots: readonly { slot: SceneSlot; candidates: ScoredSlotCandidate[] }[],
): { slot: SceneSlot; candidates: ScoredSlotCandidate[] }[] {
  return [...slots].sort((a, b) => {
    const priorityDiff = slotPriority(a.slot) - slotPriority(b.slot);
    if (priorityDiff !== 0) return priorityDiff;
    return b.slot.weight - a.slot.weight || a.slot.slot_id.localeCompare(b.slot.slot_id);
  });
}

// ---------------------------------------------------------------------------
// Optimizador principal
// ---------------------------------------------------------------------------

/**
 * Selecciona el mejor conjunto global de candidatos para cubrir los slots de
 * un programa de escena, respetando restricciones duras y maximizando el
 * objetivo lexicográfico de la sección 9.4.
 *
 * Algoritmo: greedy de una pasada sobre slots ordenados por prioridad.
 *   - Cada slot elige el mejor candidato elegible (compatibilidad, fuente,
 *     presupuesto) que no haya sido ya asignado a otro slot (paquetes
 *     compartibles) o, si es compartible, no se cobra dos veces.
 *   - Los slots REQUIRED sin candidato elegible generan un gap.
 *   - El presupuesto es un techo duro global: si el costo acumulado supera
 *     el techo, los slots restantes se marcan como BUDGET gap.
 *
 * Determinista: mismo input produce siempre el mismo output.
 */
export function optimizeSceneCoverage(
  program: SceneProgramV1,
  slotCandidates: Array<{
    slot_id: string;
    candidates: ScoredSlotCandidate[];
  }>,
  budgetCop?: number,
): SceneOptimizerResult {
  const selections: SceneSelection[] = [];
  const gaps: SceneOptimizerGap[] = [];
  const assignedSlotIds = new Set<string>();
  let remainingBudget = budgetCop;
  let estimatedTotal = 0;

  // Indexar slots del programa
  const slotMap = new Map(program.slots.map((s) => [s.slot_id, s]));
  const candidateMap = new Map(slotCandidates.map((sc) => [sc.slot_id, sc]));

  // Construir lista ordenada para asignación
  const assignmentSlots = program.slots
    .map((slot) => ({
      slot,
      candidates: candidateMap.get(slot.slot_id)?.candidates ?? [],
    }))
    .filter((entry) => slotMap.has(entry.slot.slot_id));

  const sorted = sortSlotsForAssignment(assignmentSlots);

  for (const { slot, candidates } of sorted) {
    // Verificar dependencias
    if (slot.dependencies.length > 0) {
      if (!areDependenciesSatisfied(slot.slot_id, slot.dependencies, assignedSlotIds)) {
        gaps.push({
          slot_id: slot.slot_id,
          kind: "DEPENDENCY_FAILED",
          reason: `Depende de slots no cubiertos: ${slot.dependencies.filter((d) => !assignedSlotIds.has(d)).join(", ")}`,
        });
        continue;
      }
    }

    // Buscar el mejor candidato elegible
    let bestCandidate: ScoredSlotCandidate | null = null;
    let anyFitsBudget = false; // alguno cabe en el presupuesto aunque falle por otra razón

    for (const candidate of candidates) {
      const cost = candidate.estimated_cost_cop ?? 0;

      // Track: ¿al menos un candidato cabe en el presupuesto restante?
      if (remainingBudget !== undefined && cost <= remainingBudget) {
        anyFitsBudget = true;
      }

      const alreadyAssigned = selections.some(
        (sel) => isSameItem(sel.candidate, candidate),
      );
      const effectiveCost = alreadyAssigned ? 0 : cost;

      if (remainingBudget !== undefined && effectiveCost > remainingBudget) continue;

      // Elegibilidad dura
      const eligibility = checkEligibility(
        candidate,
        slot.allowed_sources,
        undefined,
        remainingBudget,
      );

      if (!eligibility.pass) continue;

      bestCandidate = candidate;
      selections.push({
        slot_id: slot.slot_id,
        candidate,
        estimated_cost_cop: cost,
      });

      estimatedTotal += effectiveCost;
      if (remainingBudget !== undefined) remainingBudget -= effectiveCost;
      assignedSlotIds.add(slot.slot_id);
      break;
    }

    if (!bestCandidate) {
      if (candidates.length === 0) {
        gaps.push({
          slot_id: slot.slot_id,
          kind: "EMPTY_RESULTS",
          reason: `Sin candidatos recuperados para la función "${slot.function}" en la zona "${slot.zone}"`,
        });
      } else if (remainingBudget !== undefined && remainingBudget <= 0) {
        gaps.push({
          slot_id: slot.slot_id,
          kind: "BUDGET",
          reason: `Presupuesto agotado para cubrir slot "${slot.function}"`,
        });
      } else if (remainingBudget !== undefined && !anyFitsBudget) {
        gaps.push({
          slot_id: slot.slot_id,
          kind: "BUDGET",
          reason: `Presupuesto insuficiente: ${remainingBudget} COP restantes, ningún candidato cabe para "${slot.function}"`,
        });
      } else {
        gaps.push({
          slot_id: slot.slot_id,
          kind: "NO_ELIGIBLE_CANDIDATE",
          reason: `Ningún candidato elegible para "${slot.function}" (${candidates.length} candidatos, ninguno pasa filtros)`,
        });
      }
    }
  }

  // Calcular métricas de cobertura
  const coverageResult = computeCoverageMetrics(program, selections, gaps);

  return {
    selections,
    gaps,
    required_coverage: coverageResult.requiredCoverage,
    weighted_coverage: coverageResult.weightedCoverage,
    family_diversity: coverageResult.familyDiversity,
    estimated_total_cop: estimatedTotal,
    score: coverageResult.score,
  };
}

// ---------------------------------------------------------------------------
// Métricas de cobertura
// ---------------------------------------------------------------------------

type CoverageMetrics = {
  requiredCoverage: number;
  weightedCoverage: number;
  familyDiversity: number;
  score: number;
};

function computeCoverageMetrics(
  program: SceneProgramV1,
  selections: SceneSelection[],
  gaps: SceneOptimizerGap[],
): CoverageMetrics {
  const totalRequiredSlots = program.slots.filter((s) => s.requirement === "required").length;
  const coveredRequiredSlots = selections.filter(
    (sel) => program.slots.find((s) => s.slot_id === sel.slot_id)?.requirement === "required",
  ).length;

  const requiredCoverage = totalRequiredSlots > 0 ? coveredRequiredSlots / totalRequiredSlots : 1;

  const totalWeight = program.slots.reduce((sum, s) => sum + s.weight, 0);
  const coveredWeight = program.slots
    .filter((s) => selections.some((sel) => sel.slot_id === s.slot_id))
    .reduce((sum, s) => sum + s.weight, 0);
  const weightedCoverage = totalWeight > 0 ? coveredWeight / totalWeight : 0;

  const families = new Set(selections.map((sel) => candidateFamily(sel.candidate)));
  const familyDiversity = families.size;

  // Source confidence promedio
  const avgSourceConfidence = selections.length > 0
    ? selections.reduce((sum, sel) => {
        const kind = sel.candidate.supply_binding?.kind;
        switch (kind) {
          case "sale": return sum + 1;
          case "rental": return sum + 0.8;
          case "venue_existing": return sum + 0.9;
          case "context_non_quotable": return sum + 0.3;
          default: return sum;
        }
      }, 0) / selections.length
    : 0;

  // Score compuesto (sección 9.4)
  const normalizedCost = budgetNormalization(selections);
  const score =
    WC_REQUIRED * requiredCoverage +
    WC_WEIGHTED * weightedCoverage +
    WC_FAMILY * Math.min(familyDiversity / Math.max(program.slots.length, 1), 1) +
    WC_COMPAT * (gaps.length === 0 ? 1 : 0.5) +
    WC_SOURCE * avgSourceConfidence -
    normalizedCost;

  return { requiredCoverage, weightedCoverage, familyDiversity, score };
}

function budgetNormalization(selections: SceneSelection[]): number {
  const totalCost = selections.reduce((sum, s) => sum + s.estimated_cost_cop, 0);
  if (totalCost <= 0) return 0;
  // Normalized to 0-100 range approximately
  return Math.min(totalCost / 10000, 100);
}
