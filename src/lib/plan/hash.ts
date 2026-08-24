import { createHash } from "node:crypto";
import type { PlanDecoracion } from "./tipos";

function canonico(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonico).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonico(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function planHash(plan: PlanDecoracion): string {
  return createHash("sha256").update(canonico(plan)).digest("hex");
}

/** Hash del snapshot que el cliente realmente aprobó: plan declarativo más
 * geometría, variantes, presentaciones, precios y total. Cambios de catálogo
 * entre la aprobación y la generación ya no pueden reutilizar el mismo hash. */
export function planHashResuelto(plan: PlanDecoracion, snapshot: unknown): string {
  return createHash("sha256").update(canonico({ plan, snapshot })).digest("hex");
}

export function planCanonico(plan: PlanDecoracion): string {
  return canonico(plan);
}
