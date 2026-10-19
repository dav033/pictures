import type { RespuestaMotor } from "./tipos";

/**
 * Hasta cuándo un plan del 3D abierto sigue en el 3D con la bandera en `python` (P-045). La marcha atrás no le cambia el
 * precio a un plan que el cliente tiene, pero tampoco lo deja en el 3D para siempre: cada plan que sale de otro (un cambio,
 * una idea sumada, otra propuesta) se firma de nuevo y HEREDA la hora del primer plan de su línea (`ContextoPlan.origenEn`).
 * Pasado este límite, con la bandera en `python`, el 3D ya no lo rehace ni lo cambia y el cliente lee, antes, que se
 * recalcula. Con la bandera en `3d` no hay límite: el 3D es el motor vigente.
 */
export const LIMITE_CONTINUIDAD_3D_MS = 24 * 60 * 60 * 1000;

export function planDel3dVencido(bandera: RespuestaMotor, origenEn: number, ahora: number): boolean {
  return bandera.motor !== "3d" && ahora - origenEn > LIMITE_CONTINUIDAD_3D_MS;
}
