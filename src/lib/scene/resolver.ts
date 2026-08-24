/**
 * Resolver V2 de escena (Tarea 05.2 —
 * `PLAN_ARQUITECTURA_ESCENA_COMPLETA_RAG.md`, sección 05.2).
 *
 * Convierte la selección del optimizador en instancias físicas resolviendo
 * tres cantidades distintas (sección 2.4 del plan):
 *
 *   - `instance_count`: cuántas veces aparece esta instalación físicamente
 *     en la escena (p. ej. 1 arco, 2 marcadores de pasillo).
 *   - `component_bom`: lista de materiales que COMPONEN una instancia
 *     (p. ej. 150 globos, 1 estructura de soporte).
 *   - `billable_quantity`: cantidad facturable en unidades de paquete
 *     (p. ej. 3 paquetes de 50 globos, 1 kit de montaje).
 *
 * Normaliza compra, alquiler, servicio y elementos existentes (venue_existing).
 * El costo total usado para aprobación SALE EXCLUSIVAMENTE de este resolver.
 * Bloquea aprobación cuando costos obligatorios son desconocidos (QUOTE_REQUIRED
 * sin cotización, o precio faltante en venta/alquiler).
 *
 * Determinista: mismo input → mismo output.
 */

import { groupByItemId } from "./compatibility";
import type { SceneProgramV1, SlotCandidate } from "./tipos";
import type { SceneOptimizerResult } from "./optimizer";
import type { CommercialOfferStatus } from "../rag/catalog/scene-asset-schema";

// ---------------------------------------------------------------------------
// Tipos de salida
// ---------------------------------------------------------------------------

export type ResolvedItemLine = {
  /** slot_id al que pertenece esta línea. */
  slot_id: string;
  /** item_id del catálogo. */
  item_id: string;
  /** Cantidad de instancias físicas de este ítem en la escena (p. ej. 2 marcadores de pasillo). */
  instance_count: number;
  /** Materiales por instancia — para globos: cantidad de globos; para estructuras: componentes. Vacío si no aplica. */
  component_bom: ComponentBomItem[];
  /** Cantidad facturable — cuántas unidades de paquete/servicio se deben facturar. */
  billable_quantity: number;
  /** Unidades por paquete (para calcular billable_quantity). */
  units_per_package: number;
  /** Costo unitario (paquete/período/unidad) en COP enteros. */
  unit_cost_cop: number;
  /** Subtotal facturable en COP enteros. */
  subtotal_cop: number;
  /** Clase de fuente resuelta. */
  source_class: ResolvedSourceClass;
  /** Estado comercial de la oferta (si aplica). */
  offer_status?: CommercialOfferStatus;
};

export type ComponentBomItem = {
  description: string;
  quantity: number;
};

export type ResolvedSourceClass = "purchase" | "rental" | "venue_existing" | "context_non_quotable";

export type ResolvedScenePlan = {
  /** Schema version. */
  schema_version: "resolved-scene-plan-v2";
  /** Hash del programa de entrada. */
  program_hash: string;
  /** Líneas resueltas (una por slot_id + item_id único). */
  lines: ResolvedItemLine[];
  /** Estado de aprobación. */
  approval: SceneApprovalStatus;
  /** Totales financieros. */
  totals: SceneBudgetTotals;
  /** Brechas de aprobación (costos obligatorios desconocidos). */
  approval_blockers: string[];
};

export type SceneApprovalStatus =
  | "DRAFT"
  | "PARTIAL"
  | "COMPLETE"
  | "BLOCKED"
  | "APPROVED";

export type SceneBudgetTotals = {
  /** Total facturable en COP enteros. */
  total_cop: number;
  /** Desglose por clase de fuente. */
  breakdown: Record<ResolvedSourceClass, number>;
  /** Número de ítems distintos. */
  distinct_items: number;
  /** Número de ítems compartidos entre slots (sin doble cobro). */
  shared_items: number;
};

// ---------------------------------------------------------------------------
// Resolver principal
// ---------------------------------------------------------------------------

/**
 * Convierte la selección del optimizador en un plan resuelto con cantidades
 * separadas (`instance_count`, `component_bom`, `billable_quantity`) y costo
 * verificable.
 *
 * `min_instances` y `max_instances` vienen de `SceneSlot` en el programa.
 * Para esta primera versión, `instance_count` = `min_instances` (el mínimo
 * declarado por la receta), y `component_bom` queda vacío (los componentes
 * físicos se derivan en la fase de spec/geometría — Plan 07).
 */
export function resolveScenePlan(
  optimizerResult: SceneOptimizerResult,
  program: SceneProgramV1,
): ResolvedScenePlan {
  const selections = optimizerResult.selections;
  const gaps = optimizerResult.gaps;
  const approvalBlockers: string[] = [];

  // Agrupar por item_id para detectar compartidos
  const itemGroups = groupByItemId(selections.map((s) => s.candidate));

  // Construir mapa slot_id → slot
  const slotMap = new Map(program.slots.map((s) => [s.slot_id, s]));

  // Resolver cada selección
  const lines: ResolvedItemLine[] = [];
  const processedItemIds = new Set<string>();
  let sharedCount = 0;

  for (const selection of selections) {
    const slot = slotMap.get(selection.slot_id);
    const instanceCount = slot?.min_instances ?? 1;
    const candidate = selection.candidate;
    const binding = candidate.supply_binding;

    const sourceClass = mapBindingToSourceClass(binding);
    const isShared = itemGroups.get(candidate.item.item_id)!.length > 1;

    // Si es compartido y ya lo procesamos, solo registrar la línea sin costo
    if (isShared && processedItemIds.has(candidate.item.item_id)) {
      sharedCount++;
      lines.push({
        slot_id: selection.slot_id,
        item_id: candidate.item.item_id,
        instance_count: instanceCount,
        component_bom: [],
        billable_quantity: 0,
        units_per_package: 1,
        unit_cost_cop: 0,
        subtotal_cop: 0,
        source_class: sourceClass,
        offer_status: candidate.offer?.status,
      });
      continue;
    }

    processedItemIds.add(candidate.item.item_id);

    // Costo: solo para purchase/rental
    let unitCost = 0;
    let billableQty = 0;
    let unitsPerPkg = 1;

    if (sourceClass === "purchase" || sourceClass === "rental") {
      if (candidate.offer) {
        // Usar price_components de la oferta
        const mainPrice = candidate.offer.price_components.find(
          (pc) => pc.type === "unit_sale" || pc.type === "package_sale" || pc.type === "rental_period",
        );
        if (mainPrice) {
          unitCost = mainPrice.amount_cop;
          unitsPerPkg = mainPrice.quantity ?? 1;
          billableQty = Math.max(1, Math.ceil(instanceCount / unitsPerPkg));
        } else if (candidate.estimated_cost_cop !== undefined) {
          unitCost = candidate.estimated_cost_cop;
          billableQty = 1;
        }
      } else if (candidate.estimated_cost_cop !== undefined) {
        unitCost = candidate.estimated_cost_cop;
        billableQty = 1;
      }

      // Bloquear si no hay costo verificable
      if (unitCost <= 0) {
        approvalBlockers.push(
          `Item "${candidate.item.item_id}" (slot "${selection.slot_id}") no tiene costo verificable para ${sourceClass}`,
        );
      }

      // Bloquear si es QUOTE_REQUIRED
      if (candidate.offer?.status === "QUOTE_REQUIRED") {
        approvalBlockers.push(
          `Item "${candidate.item.item_id}" (slot "${selection.slot_id}") requiere cotización (QUOTE_REQUIRED)`,
        );
      }
    }

    lines.push({
      slot_id: selection.slot_id,
      item_id: candidate.item.item_id,
      instance_count: instanceCount,
      component_bom: [], // Plan 07 (geometría/spec)
      billable_quantity: billableQty,
      units_per_package: unitsPerPkg,
      unit_cost_cop: unitCost,
      subtotal_cop: unitCost * billableQty,
      source_class: sourceClass,
      offer_status: candidate.offer?.status,
    });
  }

  // Gap lines — marcar como sin costo
  for (const gap of gaps) {
    const slot = slotMap.get(gap.slot_id);
    if (slot) {
      lines.push({
        slot_id: gap.slot_id,
        item_id: `gap:${gap.slot_id}`,
        instance_count: 0,
        component_bom: [],
        billable_quantity: 0,
        units_per_package: 0,
        unit_cost_cop: 0,
        subtotal_cop: 0,
        source_class: "purchase", // placeholder
        offer_status: undefined,
      });
      approvalBlockers.push(
        `Slot "${slot.function}" (${gap.slot_id}) sin cobertura: ${gap.reason}`,
      );
    }
  }

  // Totales
  const breakdown: Record<ResolvedSourceClass, number> = {
    purchase: 0,
    rental: 0,
    venue_existing: 0,
    context_non_quotable: 0,
  };

  let totalCop = 0;
  for (const line of lines) {
    if (line.source_class === "purchase" || line.source_class === "rental") {
      breakdown[line.source_class] += line.subtotal_cop;
      totalCop += line.subtotal_cop;
    }
  }

  // Shared items that weren't double-billed
  const distinctItems = new Set(lines.filter((l) => l.subtotal_cop > 0).map((l) => l.item_id)).size;

  // Approval status
  let approval: SceneApprovalStatus;
  const hasRequiredGaps = gaps.some((g) => {
    const slot = slotMap.get(g.slot_id);
    return slot?.requirement === "required";
  });

  if (approvalBlockers.length > 0) {
    approval = hasRequiredGaps ? "BLOCKED" : "PARTIAL";
  } else if (gaps.length === 0) {
    approval = "COMPLETE";
  } else {
    approval = "PARTIAL";
  }

  return {
    schema_version: "resolved-scene-plan-v2",
    program_hash: "stub-hash", // El hash real lo calcula el llamador con computeProgramHash
    lines,
    approval,
    totals: {
      total_cop: totalCop,
      breakdown,
      distinct_items: distinctItems,
      shared_items: sharedCount,
    },
    approval_blockers: approvalBlockers,
  };
}

// ---------------------------------------------------------------------------
// Mapeo SupplyBinding → ResolvedSourceClass
// ---------------------------------------------------------------------------

function mapBindingToSourceClass(binding: SlotCandidate["supply_binding"]): ResolvedSourceClass {
  if (!binding) return "purchase";
  switch (binding.kind) {
    case "sale":
      return "purchase";
    case "rental":
      return "rental";
    case "venue_existing":
      return "venue_existing";
    case "context_non_quotable":
      return "context_non_quotable";
    default:
      return "purchase";
  }
}
