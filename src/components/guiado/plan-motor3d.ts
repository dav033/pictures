import type { z } from "zod";
import type { BriefGuiadoSchema, PlanGuiadoSchema, PropuestaComposicionSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { FalloPlanMotorSchema, RUTA_PLAN_MOTOR, RespuestaPlanMotorSchema, type CuerpoPlanMotor, type RazonFallback } from "@/lib/guiada-motor/plan-contrato";

type PlanGuiado = z.infer<typeof PlanGuiadoSchema>;
type Propuesta = z.infer<typeof PropuestaComposicionSchema>;
type Brief = z.infer<typeof BriefGuiadoSchema>;
type Red = typeof fetch;

/**
 * El plan de la vista guiada pedido al motor 3D (`/api/guiada/motor/plan`, REQ-007 fase 2). Nunca lanza: un plan que el
 * 3D no arma (o una red caída) dice su motivo y quien llama sigue por el camino de Python. Sin React, para probarlo sin
 * navegador.
 */
export type IntentoMotor3d =
  | { ok: true; plan: PlanGuiado; cotizacion: unknown; nuevas: string[]; globosIdea: number | null; exacto: boolean; avisos: string[] }
  | { ok: false; razon: RazonFallback | "red" | "servidor"; detalle: string; estado: number | null; detenido: boolean };

export async function pedirPlanAlMotor3d(cuerpo: CuerpoPlanMotor, signal: AbortSignal, red: Red = (...argumentos) => fetch(...argumentos)): Promise<IntentoMotor3d> {
  try {
    const respuesta = await red(RUTA_PLAN_MOTOR, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo), signal });
    const datos: unknown = await respuesta.json().catch(() => null);
    if (!respuesta.ok) {
      const fallo = FalloPlanMotorSchema.safeParse(datos);
      return fallo.success && fallo.data.fallback
        ? { ok: false, razon: fallo.data.fallback.razon, detalle: fallo.data.fallback.detalle ?? fallo.data.error, estado: respuesta.status, detenido: false }
        : { ok: false, razon: "servidor", detalle: fallo.success ? fallo.data.error : `estado ${respuesta.status}`, estado: respuesta.status, detenido: false };
    }
    const leida = RespuestaPlanMotorSchema.safeParse(datos);
    if (!leida.success) return { ok: false, razon: "servidor", detalle: "respuesta sin plan válido", estado: respuesta.status, detenido: false };
    return { ok: true, ...leida.data };
  } catch (causa) {
    return { ok: false, razon: "red", detalle: causa instanceof Error ? causa.message : String(causa), estado: null, detenido: signal.aborted };
  }
}

export const cuerpoDePropuesta = (propuesta: Propuesta, brief: Brief | undefined, base: PlanGuiado | null): CuerpoPlanMotor => ({
  desde: "propuesta", propuesta, ...(brief ? { brief } : {}), ...(base ? { base } : {}),
});
export const cuerpoDeIdea = (ideaId: string, base: PlanGuiado | null): CuerpoPlanMotor => ({ desde: "idea", idea_id: ideaId, ...(base ? { base } : {}) });
