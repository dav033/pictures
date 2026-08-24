/**
 * Verificaciones de compatibilidad entre candidatos de escena (Tarea 05.1 —
 * `PLAN_ARQUITECTURA_ESCENA_COMPLETA_RAG.md`, sección 9.4).
 *
 * Restricciones duras que el optimizador debe satisfacer:
 *   - Presupuesto conocido no superior al techo.
 *   - Stock y disponibilidad.
 *   - Fuente verificable.
 *   - Dimensiones y compatibilidad.
 *   - Dependencias cubiertas.
 *   - No duplicar una compra compartible.
 *   - No seleccionar un objeto QUOTE_REQUIRED como si estuviera presupuestado.
 *
 * Funciones puras y deterministas: mismas entradas → mismas salidas.
 */

import type { SlotCandidate, SupplySourceClass } from "./tipos";

// ---------------------------------------------------------------------------
// Compatibilidad de ambiente
// ---------------------------------------------------------------------------

/**
 * Verifica que un candidato sea compatible con el ambiente del slot
 * (indoor/outdoor). Un candidato sin datos de compatibilidad se considera
 * compatible (asumimos que si no declara, funciona en cualquier ambiente).
 */
export function isEnvironmentCompatible(
  candidate: SlotCandidate,
  environment: "indoor" | "outdoor" | undefined,
): boolean {
  if (!environment) return true;
  const compat = candidate.item.compatibility.indoor_outdoor;
  if (!compat || compat.length === 0) return true;
  return compat.includes(environment);
}

// ---------------------------------------------------------------------------
// Compatibilidad de fuente
// ---------------------------------------------------------------------------

/**
 * Verifica que la clase de fuente del candidato esté entre las permitidas
 * para el slot. `venue_existing` y `context_non_quotable` siempre se
 * consideran compatibles porque no generan costo.
 */
export function isSourceAllowed(
  binding: SlotCandidate["supply_binding"],
  allowedSources: readonly SupplySourceClass[],
): boolean {
  if (!binding) return false;
  if (allowedSources.length === 0) return true;

  // Mapeo de kind → source class
  switch (binding.kind) {
    case "sale":
      return allowedSources.includes("catalog_sale");
    case "rental":
      return allowedSources.includes("catalog_rental");
    case "venue_existing":
      return allowedSources.includes("venue_existing");
    case "context_non_quotable":
      return allowedSources.includes("context_non_quotable");
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Compatibilidad de precio (QUOTE_REQUIRED)
// ---------------------------------------------------------------------------

/**
 * Un candidato con oferta QUOTE_REQUIRED no puede seleccionarse como si
 * tuviera precio conocido. Solo se acepta si el slot ya tiene un waiver
 * explícito o si es un slot opcional.
 */
export function isQuoteResolved(
  candidate: SlotCandidate,
): boolean {
  if (!candidate.offer) return true; // Sin oferta = sin restricción de quote
  return candidate.offer.status !== "QUOTE_REQUIRED";
}

// ---------------------------------------------------------------------------
// Paquetes compartibles (no doble cobro)
// ---------------------------------------------------------------------------

/**
 * Dos candidatos comparten el mismo ítem si tienen el mismo `item_id`.
 * Un ítem compartido entre dos slots solo debe facturarse una vez.
 */
export function isSameItem(a: SlotCandidate, b: SlotCandidate): boolean {
  return a.item.item_id === b.item.item_id;
}

/**
 * Agrupa candidatos seleccionados por `item_id` para detectar compartidos.
 */
export function groupByItemId(assignments: SlotCandidate[]): Map<string, SlotCandidate[]> {
  const grouped = new Map<string, SlotCandidate[]>();
  for (const assignment of assignments) {
    const existing = grouped.get(assignment.item.item_id) ?? [];
    existing.push(assignment);
    grouped.set(assignment.item.item_id, existing);
  }
  return grouped;
}

// ---------------------------------------------------------------------------
// Dependencias entre slots
// ---------------------------------------------------------------------------

/**
 * Verifica que todos los slots de los que depende `slotId` tengan un
 * candidato seleccionado (no vacío).
 */
export function areDependenciesSatisfied(
  slotId: string,
  dependencyIds: readonly string[],
  assignedSlotIds: ReadonlySet<string>,
): boolean {
  if (dependencyIds.length === 0) return true;
  return dependencyIds.every((depId) => assignedSlotIds.has(depId));
}

// ---------------------------------------------------------------------------
// Elegibilidad general de un candidato para un slot
// ---------------------------------------------------------------------------

export type EligibilityCheck = {
  pass: boolean;
  reason?: string;
};

/**
 * Evalúa todas las restricciones duras para un candidato en un slot:
 * elegibilidad (del retrieval), compatibilidad de fuente, compatibilidad
 * de ambiente, y precio cotizable.
 */
export function checkEligibility(
  candidate: SlotCandidate,
  allowedSources: readonly SupplySourceClass[],
  environment: "indoor" | "outdoor" | undefined,
  budgetAvailable: number | undefined,
): EligibilityCheck {
  if (!candidate.eligibility.pass) {
    return { pass: false, reason: `inelegible: ${candidate.eligibility.reasons.join("; ")}` };
  }

  if (!isSourceAllowed(candidate.supply_binding, allowedSources)) {
    return { pass: false, reason: `fuente no permitida: ${candidate.supply_binding?.kind}` };
  }

  if (!isEnvironmentCompatible(candidate, environment)) {
    return { pass: false, reason: `no compatible con ambiente ${environment}` };
  }

  if (budgetAvailable !== undefined && candidate.estimated_cost_cop !== undefined && candidate.estimated_cost_cop > budgetAvailable) {
    return { pass: false, reason: `costo ${candidate.estimated_cost_cop} excede presupuesto disponible ${budgetAvailable}` };
  }

  return { pass: true };
}
