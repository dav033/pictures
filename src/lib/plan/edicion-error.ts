/**
 * Expected, customer-facing failure of `/api/plan-editar` and
 * `/api/plan-patron`. `causa` is a stable code the browser or a harness can
 * branch on; the message stays human.
 *
 * It lives outside the route file so plan-editing helpers can raise it without
 * importing route modules.
 */
export type CausaEdicionPlan =
  | "VARIANTE_NO_ADMITIDA"
  | "VARIANTE_REFERENCIA_NO_ENCONTRADA"
  /** "Quitar" on the only material of a structure: it can be replaced, not removed. */
  | "UNICO_MATERIAL"
  /** A balloon line replaced by a product that is not a balloon of the same shape. */
  | "REEMPLAZO_INCOMPATIBLE"
  /** The color pattern breaks a rule Python owns (ADR-0028 §4); `patron` says which. */
  | "PATRON_INVALIDO"
  /** Redistributing the colors of a piece whose pattern decides them (ADR-0028 §9). */
  | "PATRON_ACTIVO"
  /** The bouquet assembly breaks a rule Python owns (ADR-0030); `patron` says which. */
  | "ARMADO_INVALIDO";

/** What Python said about a rejected color pattern or bouquet assembly: a stable rule and a sentence for the decorator. */
export type RechazoPatron = { motivo: string; mensaje: string };

export class PlanEditError extends Error {
  readonly status: number;
  readonly causa?: CausaEdicionPlan;
  readonly patron?: RechazoPatron;

  constructor(status: number, message: string, causa?: CausaEdicionPlan, patron?: RechazoPatron) {
    super(message);
    this.name = "PlanEditError";
    this.status = status;
    this.causa = causa;
    this.patron = patron;
  }
}
