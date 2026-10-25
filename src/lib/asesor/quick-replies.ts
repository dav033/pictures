import { appendBriefChanges, diffBrief } from "./brief-changes";
import type { EventBrief, EventBriefState } from "./contracts";

export type QuickReply = { label: string; message: string };

/** Chips for "¿qué es lo más importante?". The exact messages are applied by the server, not inferred by the model. */
export const PRIORITY_REPLIES: Record<NonNullable<EventBrief["organiserPriority"]>, QuickReply> = {
  impress: { label: "Impresionar", message: "Lo más importante para mí es impresionar." },
  personalise: { label: "Personalizarla", message: "Lo más importante para mí es personalizarla." },
  simple: { label: "Algo sencillo", message: "Lo más importante para mí es algo sencillo." },
  best_price: { label: "El mejor precio", message: "Lo más importante para mí es el mejor precio." },
};

export const BUDGET_REPLIES: readonly QuickReply[] = [
  { label: "Hasta $300.000", message: "Para la decoración pensamos invertir hasta $300.000." },
  { label: "$300.000–$600.000", message: "Para la decoración pensamos invertir entre $300.000 y $600.000." },
  { label: "Más de $600.000", message: "Para la decoración pensamos invertir más de $600.000." },
];
export const BUDGET_UNDISCLOSED_REPLY: QuickReply = { label: "Prefiero no decir", message: "Prefiero no decir el presupuesto." };

function quickReplyPatch(text: string): Partial<EventBrief> | null {
  const message = text.trim();
  for (const [priority, reply] of Object.entries(PRIORITY_REPLIES)) {
    if (message === reply.message) return { organiserPriority: priority as keyof typeof PRIORITY_REPLIES };
  }
  const band = BUDGET_REPLIES.find((reply) => reply.message === message);
  if (band) return { budgetRange: band.label, budgetUndisclosed: false };
  if (message === BUDGET_UNDISCLOSED_REPLY.message) return { budgetRange: null, budgetUndisclosed: true };
  return null;
}

/** Applies a quick-pick chip deterministically; any other text is left to the model. Returns whether the brief changed. */
export function applyQuickReplyToState(state: EventBriefState, text: string, turnId: string | null): boolean {
  const patch = quickReplyPatch(text);
  if (!patch) return false;
  const next = { ...state.brief, ...patch };
  if (Object.entries(patch).every(([key, value]) => state.brief[key as keyof EventBrief] === value)) return false;
  state.changes = appendBriefChanges(state.changes, diffBrief(state.brief, next, turnId));
  state.brief = next;
  state.summary = null;
  state.approval = null;
  return true;
}
