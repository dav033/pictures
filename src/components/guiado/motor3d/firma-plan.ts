import type { z } from "zod";
import type { PlanGuiadoSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import type { VistaArmada } from "@/lib/guiada-motor/armada-contrato";
import type { EstructuraOficialId } from "@/lib/plan/estructuras-oficiales";
import type { FirmaPlan } from "./gestor-vista";

type PlanGuiado = z.infer<typeof PlanGuiadoSchema>;

/**
 * Lo que un plan del motor 3D trae para pedir su vista (REQ-007, fase 3): el token y el hash, el motor y la espec firmada.
 * Un plan sin alguna de esas partes (guardado antes de la fase 3, o de Python) no tiene vista 3D: `null`.
 */
export function firmaDePlan(plan: PlanGuiado): FirmaPlan | null {
  const extra = plan as PlanGuiado & { motor?: { id?: unknown; version?: unknown }; espec?: unknown };
  const version = extra.motor?.version;
  if (extra.motor?.id !== "globos3d" || typeof version !== "string" || extra.espec === undefined || extra.espec === null) return null;
  return { approval_token: plan.approval_token, plan_hash: plan.plan_hash, motor: { id: "globos3d", version }, espec: extra.espec };
}

/** Lo que se cuelga de una pared o se ve plano: de frente, como se fotografía. Lo demás tiene volumen: tres cuartos. */
const DE_FRENTE: ReadonlySet<EstructuraOficialId> = new Set(["pared_densa", "pared_no_densa", "pared_organica", "guirnalda", "racimo_pared"]);

export const vistaDePieza = (oficial: EstructuraOficialId | null): VistaArmada => (oficial !== null && DE_FRENTE.has(oficial) ? "frente" : "tres-cuartos");

/** La cámara fija de toda la decoración: de frente solo si TODAS sus piezas son planas. */
export function vistaDelPlan(piezas: ReadonlyArray<{ oficial: EstructuraOficialId | null }>): VistaArmada {
  return piezas.length > 0 && piezas.every((pieza) => vistaDePieza(pieza.oficial) === "frente") ? "frente" : "tres-cuartos";
}
