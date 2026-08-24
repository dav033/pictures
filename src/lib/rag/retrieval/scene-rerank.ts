/**
 * Reranker por slot de escena (Tarea 04.2 —
 * `PLAN_ARQUITECTURA_ESCENA_COMPLETA_RAG.md`, sección 9.2: "un reranker por
 * slot valora función, estilo, color, escala, fuente y precio").
 *
 * A diferencia del reranker V1 (`./rerank.ts`) que opera sobre roles de
 * presupuesto (`focal`, `soporte`, `relleno`, `acento`, `servicio`), este
 * reranker opera sobre slots de escena (`ceremony_focal`, `ceremony_aisle`,
 * `guest_seating`, etc.) y usa el contexto completo del `SlotQuery` (estilo,
 * paleta, ambiente, presupuesto provisional, fuentes permitidas) para
 * producir un score ajustado por slot.
 *
 * Los pesos están calibrados para el orden lexicográfico del optimizador
 * (sección 9.4): cobertura obligatoria → cobertura ponderada → diversidad →
 * coherencia visual → costo → evidencia.
 */

import type { SlotQuery } from "./slot-query-planner";
import type { SlotCandidate } from "@/lib/scene/tipos";

// ---------------------------------------------------------------------------
// Candidato de escena enriquecido post-rerank
// ---------------------------------------------------------------------------

export type ScoredSlotCandidate = SlotCandidate & {
  rerank_score: number;
  /** Frases explicables del score (sección 9.2: "razones de elegibilidad"). */
  explain: string[];
};

// ---------------------------------------------------------------------------
// Pesos calibrados (sección 9.4, orden lexicográfico)
// ---------------------------------------------------------------------------

const WEIGHT_FUNCTION_MATCH = 0.30;
const WEIGHT_STYLE_PREFERENCE = 0.18;
const WEIGHT_PALETTE_PREFERENCE = 0.15;
const WEIGHT_SOURCE_CONFIDENCE = 0.10;
const WEIGHT_PRICE_FIT = 0.12;
const WEIGHT_RETRIEVAL = 0.10;
const WEIGHT_ENVIRONMENT_COMPAT = 0.05;

// ---------------------------------------------------------------------------
// Cálculo de ajuste de precio al presupuesto del slot
// ---------------------------------------------------------------------------

/**
 * Premia candidatos que usan bien el presupuesto del slot sin excederlo.
 * Pico en ~70% del presupuesto: ni la opción más barata (que suele ser
 * la de peor calidad visual) ni al borde del techo (sin margen para
 * cantidades).
 */
function priceFitScore(estimatedCost: number | undefined, budget: number | undefined): number {
  if (estimatedCost === undefined || budget === undefined || budget <= 0) return 0.5;
  if (estimatedCost > budget) return 0; // Filtro duro ya debería descartarlo, defensivo
  const usage = estimatedCost / budget;
  return 1 - Math.abs(usage - 0.7) / 0.7;
}

/**
 * Confianza de la fuente: `catalog_sale` > `catalog_rental` > sin fuente.
 * Los productos sin oferta verificada reciben 0 de confianza de fuente.
 */
function sourceConfidenceScore(binding: SlotCandidate["supply_binding"]): number {
  if (!binding) return 0;
  switch (binding.kind) {
    case "sale":
      return 1.0;
    case "rental":
      return 0.8;
    case "venue_existing":
      return 0.9;
    case "context_non_quotable":
      return 0.4;
    default:
      return 0.3;
  }
}

/**
 * Compatibilidad con el ambiente (indoor/outdoor).
 * Si el slot no especifica ambiente, no penaliza ni premia.
 */
function environmentCompat(candidate: SlotCandidate, environment: "indoor" | "outdoor" | undefined): number {
  if (!environment) return 1;
  const compat = candidate.item.compatibility.indoor_outdoor;
  if (!compat || compat.length === 0) return 0.5; // desconocido → neutro
  return compat.includes(environment) ? 1 : 0.2;
}

// ---------------------------------------------------------------------------
// Punto de entrada público
// ---------------------------------------------------------------------------

/**
 * Rerankea los candidatos de UN slot usando el contexto completo del
 * `SlotQuery` (función, zona, estilo, paleta, ambiente, presupuesto,
 * fuentes). Devuelve los candidatos ordenados por `rerank_score`
 * descendente, cada uno con explicaciones en español.
 *
 * Determinista: mismo input produce siempre el mismo output (mismos scores,
 * mismas explicaciones, mismo orden para scores iguales — desempata por
 * item_id).
 */
export function rerankSlotCandidates(
  slot: SlotQuery,
  candidates: SlotCandidate[],
): ScoredSlotCandidate[] {
  if (candidates.length === 0) return [];

  const env = slot.environment;

  const scored = candidates.map((candidate, position) => {
    const explain: string[] = [];

    // 1. Función/zona (ya implícita en la consulta semántica — aquí se valora
    //    cuánto del score de recuperación viene de la relevancia funcional)
    const retrievalAvg = (candidate.retrieval.lexical + candidate.retrieval.semantic + candidate.retrieval.rerank) / 3;
    const retrievalNorm = Math.min(retrievalAvg / 2, 1); // Normalización simple
    const retrievalScore = WEIGHT_RETRIEVAL * retrievalNorm;

    // 2. Estilo (preferencia blanda — la paleta y style_terms del slot ya
    //    guiaron la consulta semántica, aquí se refuerza con los términos que
    //    matchearon en la recuperación)
    const hasStyleMatch = slot.style_preferences.style_terms.length > 0;
    const styleScore = hasStyleMatch
      ? WEIGHT_STYLE_PREFERENCE * retrievalNorm
      : 0;

    // 3. Paleta (misma lógica: la paleta ya guió la consulta semántica)
    const hasPalette = slot.style_preferences.palette.length > 0;
    const paletteScore = hasPalette
      ? WEIGHT_PALETTE_PREFERENCE * retrievalNorm
      : 0;

    // 4. Función/zona match — siempre se explica, incluso con señal débil
    const functionMatch = WEIGHT_FUNCTION_MATCH * retrievalNorm;
    explain.push(`busca cubrir la función "${slot.function}" en la zona "${slot.zone}"`);

    // 5. Precio
    const priceScore = WEIGHT_PRICE_FIT * priceFitScore(candidate.estimated_cost_cop, slot.provisional_budget_cop);
    if (candidate.estimated_cost_cop !== undefined && slot.provisional_budget_cop !== undefined) {
      if (candidate.estimated_cost_cop <= slot.provisional_budget_cop) {
        const pct = Math.round((candidate.estimated_cost_cop / slot.provisional_budget_cop) * 100);
        explain.push(`usa ${pct}% del presupuesto del slot`);
      }
    }

    // 6. Confianza de fuente
    const srcScore = WEIGHT_SOURCE_CONFIDENCE * sourceConfidenceScore(candidate.supply_binding);
    if (candidate.supply_binding?.kind === "sale") {
      explain.push("fuente de venta verificada");
    } else if (candidate.supply_binding?.kind === "rental") {
      explain.push("fuente de alquiler disponible");
    } else if (candidate.supply_binding?.kind === "venue_existing") {
      explain.push("elemento existente en el lugar, sin costo adicional");
    } else if (candidate.supply_binding?.kind === "context_non_quotable") {
      explain.push("contexto no cotizable del lugar");
    }

    // 7. Compatibilidad con ambiente
    const envScore = WEIGHT_ENVIRONMENT_COMPAT * environmentCompat(candidate, env);

    const totalScore = retrievalScore + styleScore + paletteScore + functionMatch + priceScore + srcScore + envScore;

    return {
      ...candidate,
      rerank_score: totalScore,
      explain,
    };
  });

  // Orden por score descendente, desempata por item_id (determinismo)
  return scored.sort((a, b) => {
    const diff = b.rerank_score - a.rerank_score;
    if (Math.abs(diff) > 1e-9) return diff > 0 ? 1 : -1;
    return a.item.item_id.localeCompare(b.item.item_id);
  });
}
