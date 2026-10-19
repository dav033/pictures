import { abrirContextoPlan, type ContextoPlan } from "./aprobacion";
import { PlanEditError } from "./edicion-error";

/**
 * **Un plan, un dueño de las cantidades** (REQ-007). Un plan armado por el motor 3D lleva un token con backend
 * `globos3d`; las rutas que re-resuelven con Python (`/api/generate`, `/api/plan-editar`) no pueden tocarlo: si lo
 * aceptaran, Python contaría otra cosa y el plan que el cliente aprobó ya no sería el que se dibuja o se edita. Se
 * rechaza con un 409 claro. La regla contraria vive en las rutas del motor (`/api/guiada/motor/*`): rechazan `python`.
 */
export const CODIGO_PLAN_DEL_MOTOR_3D = "PLAN_DEL_MOTOR_3D";
export const MENSAJE_PLAN_DEL_MOTOR_3D = "Este plan lo armó el motor 3D y esta ruta es del motor de Python: no puede dibujarlo ni editarlo. Hazlo desde las acciones del propio plan.";

export function contextoDelMotor3d(contexto: ContextoPlan | null): boolean {
  return contexto?.backend === "globos3d";
}

export function esTokenDelMotor3d(token: string | undefined): boolean {
  return contextoDelMotor3d(abrirContextoPlan(token));
}

/** Rechaza un token del motor 3D en una ruta de Python: 409 con causa estable. */
export function rechazarTokenDelMotor3d(token: string | undefined): void {
  if (esTokenDelMotor3d(token)) throw new PlanEditError(409, MENSAJE_PLAN_DEL_MOTOR_3D, CODIGO_PLAN_DEL_MOTOR_3D);
}
