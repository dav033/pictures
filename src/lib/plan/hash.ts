import { createHash } from "node:crypto";
import type { PlanDecoracion, PlanDecoracion1_1 } from "./tipos";

/**
 * `canonico` no distingue versión de plan: serializa cualquier estructura de
 * forma determinista (claves ordenadas), así que sujeto, partes, props,
 * anclas y relaciones de Plan 1.1 entran al hash automáticamente en cuanto
 * existen en el objeto — no hace falta enumerarlos a mano aquí (ver
 * PLAN-COMPOSICION-RICA-V001.md §6.1, "toda intención visual nueva" debe
 * alterar el hash).
 */
function canonico(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonico).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonico(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function planHash(plan: PlanDecoracion | PlanDecoracion1_1): string {
  return createHash("sha256").update(canonico(plan)).digest("hex");
}

/** Hash del snapshot que el cliente realmente aprobó: plan declarativo más
 * geometría, variantes, presentaciones, precios y total. Cambios de catálogo
 * entre la aprobación y la generación ya no pueden reutilizar el mismo hash. */
export function planHashResuelto(plan: PlanDecoracion | PlanDecoracion1_1, snapshot: unknown): string {
  return createHash("sha256").update(canonico({ plan, snapshot })).digest("hex");
}

export function planCanonico(plan: PlanDecoracion | PlanDecoracion1_1): string {
  return canonico(plan);
}
