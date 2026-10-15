import { generarPasosPlan } from "@/lib/ia/guiado/generar-pasos-plan";
import type { WidgetGuiado } from "@/lib/ia/guiado/widgets";
import type { PlanGuiado } from "./ajuste/ajuste-plan-guiado";
import type { Mensaje } from "./estado-guardado";

type WidgetPlan = Extract<WidgetGuiado, { tipo: "plan" }>;

export function planDelMensaje(mensaje: Mensaje | undefined): WidgetPlan | undefined {
  return mensaje?.widgets?.find((item): item is WidgetPlan => item.tipo === "plan");
}

export function totalDePlan(plan: PlanGuiado): number {
  try { return generarPasosPlan(plan).total; } catch { return 0; }
}
