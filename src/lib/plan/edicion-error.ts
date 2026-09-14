/**
 * Expected, customer-facing failure of `/api/plan-editar`. `causa` is a stable
 * code the browser or a harness can branch on; the message stays human.
 *
 * It lives outside the route file so plan-editing helpers can raise it without
 * importing route modules.
 */
export type CausaEdicionPlan = "VARIANTE_NO_ADMITIDA" | "VARIANTE_REFERENCIA_NO_ENCONTRADA";

export class PlanEditError extends Error {
  readonly status: number;
  readonly causa?: CausaEdicionPlan;

  constructor(status: number, message: string, causa?: CausaEdicionPlan) {
    super(message);
    this.name = "PlanEditError";
    this.status = status;
    this.causa = causa;
  }
}
