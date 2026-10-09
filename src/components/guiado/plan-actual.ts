import type { z } from "zod";
import { PlanActualGuiadoSchema, type PlanActualGuiado, type PlanGuiadoSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { planActualDesdePlan } from "@/lib/ia/guiado/instruccion-plan";
import type { MotorGuiada } from "@/lib/guiada-motor/tipos";

/**
 * El plan vigente como lo ve el modelo del chat (`estadoGuiado.planActual`). Un plan del motor 3D trae su proyección EXACTA
 * (`planActualDesdeEspec`, que arma el servidor junto al plan); `planActualDesdePlan` es una lectura aproximada de un plan
 * de Python y solo se usa con esos planes — o con un plan 3D guardado antes de la fase 5, que todavía no la trae.
 */
export function planActualDelPlan(plan: z.infer<typeof PlanGuiadoSchema>, motor: MotorGuiada | undefined): PlanActualGuiado | null {
  if (motor === "3d") {
    const exacto = PlanActualGuiadoSchema.safeParse((plan as { planActual?: unknown }).planActual);
    if (exacto.success) return exacto.data;
  }
  return planActualDesdePlan(plan);
}
