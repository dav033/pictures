import type { BriefChange, EventBrief } from "./contracts";

/** Customer-facing labels; the brief, the summary and the chat's "cambio anotado" share them. */
export const PRIORITY_LABELS: Record<NonNullable<EventBrief["organiserPriority"]>, string> = {
  impress: "Impresionar", personalise: "Personalizarla", simple: "Algo sencillo", best_price: "El mejor precio",
};

export const EVENT_KIND_LABELS: Record<NonNullable<EventBrief["eventKind"]>, string> = {
  birthday: "Cumpleaños", corporate: "Evento corporativo", school: "Evento escolar", wedding: "Boda", social: "Evento social", other: "Otro",
};

/** Facts whose change matters to a decorator; a first value is not a change, only a later different one. */
const TRACKED_FIELDS = {
  eventKind: "Tipo de evento", eventName: "Evento", honoreeName: "Homenajeado/a", honoreeAge: "Edad", date: "Fecha", startTime: "Hora de inicio",
  guestCount: "Invitados", venueType: "Tipo de lugar", venueName: "Lugar", city: "Ciudad", theme: "Temática", colors: "Colores", style: "Estilo",
  budget: "Presupuesto", budgetRange: "Presupuesto", organiserPriority: "Lo más importante", companyName: "Empresa", schoolName: "Institución",
} as const satisfies Partial<Record<keyof EventBrief, string>>;

/** Changes to these facts invalidate the Happia package fit (see save_event_fields). */
const PACKAGE_FIT_FIELDS = new Set(["eventKind", "theme", "city", "guestCount"]);
const MAX_CHANGES = 30;

export function briefChangeLabel(field: string): string {
  return (TRACKED_FIELDS as Record<string, string>)[field] ?? field;
}

function displayValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (Array.isArray(value)) return value.join(", ");
  if (field === "organiserPriority") return PRIORITY_LABELS[value as keyof typeof PRIORITY_LABELS] ?? String(value);
  if (field === "eventKind") return EVENT_KIND_LABELS[value as keyof typeof EVENT_KIND_LABELS] ?? String(value);
  if (field === "budget" && typeof value === "number") return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(value);
  return String(value);
}

/** The same fact written differently ("$300.000–$600.000" vs "$300.000 - $600.000", "Frozen" vs "frozen") is not a change. */
export function sameFact(a: string, b: string): boolean {
  const canonical = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  return canonical(a) === canonical(b);
}

/** Server-owned diff between two brief states: each tracked fact that had a value and now has a different one. */
export function diffBrief(before: EventBrief, after: EventBrief, turnId: string | null): BriefChange[] {
  const changes: BriefChange[] = [];
  for (const field of Object.keys(TRACKED_FIELDS) as (keyof typeof TRACKED_FIELDS)[]) {
    const from = displayValue(field, before[field]);
    const to = displayValue(field, after[field]);
    if (!from || from === to || (to !== "" && sameFact(from, to))) continue;
    changes.push({ field, from: from.slice(0, 500), to: (to || "sin definir").slice(0, 500), turnId, impact: PACKAGE_FIT_FIELDS.has(field) ? "Se recalcula la propuesta de Happia" : null });
  }
  return changes;
}

export function appendBriefChanges(existing: BriefChange[], added: BriefChange[]): BriefChange[] {
  return [...existing, ...added].slice(-MAX_CHANGES);
}

export function formatBriefChange(change: Pick<BriefChange, "field" | "from" | "to">): string {
  return `${briefChangeLabel(change.field)}: ${change.from} → ${change.to}`;
}

/** What the customer said about money: an amount, a quick-pick band, or an explicit "prefiero no decir". */
export function budgetDisplay(brief: Pick<EventBrief, "budget" | "budgetRange" | "budgetUndisclosed" | "currency">): string | null {
  if (brief.budgetRange) return brief.budgetRange;
  if (brief.budget !== null) return brief.currency === "COP" ? displayValue("budget", brief.budget) : `${brief.currency} ${brief.budget}`;
  return brief.budgetUndisclosed ? "Prefiere no decirlo" : null;
}
