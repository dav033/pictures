/**
 * Los chips «Cuánto cuesta» y «Aprender a hacerlo» tras elegir una idea son pasos enlatados: no necesitan al modelo.
 * Antes iban a /api/chat, donde el modelo proponía y Python armaba un plan NUEVO (115 globos) distinto del plan
 * exacto guardado de la idea (101/102): dos cifras para lo mismo y un turno pagado por un paso fijo (REQ-015, D2/D5).
 * Puro: sin React ni red, para probarlo sin navegador.
 */

export type OpcionEnlatada = "costear" | "comprar" | "aprender" | "contratar";

export type RutaOpcionIdea =
  /** Ya hay un plan: la acción se resuelve sobre su tarjeta. */
  | "accion-plan"
  /** Hay una idea elegida y aún no hay plan: se pide el plan exacto de la idea (sin modelo) y luego la acción. */
  | "plan-exacto-de-idea"
  /** Sin idea ni plan, o una opción que ya resuelve la vista por su cuenta: camino de siempre (/api/chat). */
  | "chat";

export function rutaOpcionIdea(opcion: OpcionEnlatada, contexto: { hayIdea: boolean; hayPlan: boolean; ideaEnElPlan: boolean }): RutaOpcionIdea {
  if (opcion !== "costear" && opcion !== "aprender") return "chat";
  if (contexto.hayPlan) return !contexto.hayIdea || contexto.ideaEnElPlan ? "accion-plan" : "chat";
  return contexto.hayIdea ? "plan-exacto-de-idea" : "chat";
}

/** La acción pendiente solo se ejecuta con un plan nuevo que ya incluye la idea que la pidió (nunca con un plan ajeno). */
export function planListoParaAccion(pendiente: { planPrevio: string | null; ideaId: string }, planActual: string | null, ideasDelPlan: readonly string[]): boolean {
  return planActual !== null && planActual !== pendiente.planPrevio && ideasDelPlan.includes(pendiente.ideaId);
}
