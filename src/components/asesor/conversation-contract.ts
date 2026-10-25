import { z } from "zod";
import { formatBriefChange } from "@/lib/asesor/brief-changes";

export const ADVISOR_CONVERSATION_STORAGE_KEY = "asesor.conversationId";

export type AdvisorPhoto = { id: string; mimeType: string; byteSize: number; kind: "inspiration" | "venue"; confirmed: boolean | null; preference: "like" | "dislike" | "neutral" };
export type AdvisorMessage = { id: string; role: "user" | "assistant"; content: string; attachments?: AdvisorPhoto[]; inputMode?: "voice" };
export type AdvisorProgress = { complete: boolean; completed: number; required: number; missing: string[]; step?: "event" | "preferences" | "start_time" | "proposal" | "contact" | "summary"; ask?: "priority" | "budget" };
export type AdvisorComposerCard = {
  kind: "direction" | "package";
  id: string;
  title: string;
  description: string;
  content: string;
  imageUrl?: string;
  source?: string;
  price?: string;
};
export type AdvisorSummary = { version: number; text: string };
/** Header line built from the brief: "Cumpleaños de Sofía" and its facts ("10 sep · 15 invitados · Barranquilla"). */
export type AdvisorHeadline = { title: string | null; facts: string[]; city: string | null };
/** A change the server recorded, linked to the reply of the turn that made it. */
export type AdvisorChange = { turnId: string | null; text: string; impact: string | null };
export type AdvisorProposal = z.infer<typeof packageSchema>;
export type AdvisorUiState = {
  cards: AdvisorComposerCard[];
  summary: AdvisorSummary | null;
  approved: boolean;
  headline: AdvisorHeadline;
  changes: AdvisorChange[];
  proposal: AdvisorProposal | null;
  directionChosen: boolean;
};

export type AdvisorSnapshot = {
  conversationId: string;
  messages: AdvisorMessage[];
  progress: AdvisorProgress;
  briefVersion: number;
} & AdvisorUiState;

const recordSchema = z.record(z.string(), z.unknown());
const progressSchema = z.object({ complete: z.boolean(), completed: z.number().int().nonnegative(), required: z.number().int().positive(), missing: z.array(z.string()), step: z.enum(["event", "preferences", "start_time", "proposal", "contact", "summary"]).optional(), ask: z.enum(["priority", "budget"]).optional() }).strict();
const photoSchema = z.object({
  id: z.string().min(1), mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]), byteSize: z.number().int().positive().max(6 * 1024 * 1024),
  kind: z.enum(["inspiration", "venue"]), confirmed: z.boolean().nullable(), preference: z.enum(["like", "dislike", "neutral"]),
}).strict();
const messageSchema = z.object({ id: z.string().min(1), role: z.enum(["user", "assistant"]), content: z.string(), attachments: z.array(photoSchema).optional(), inputMode: z.literal("voice").optional() }).strict();
const directionSchema = z.object({
  id: z.string().min(1), title: z.string().min(1), description: z.string().min(1), photoUrl: z.string().startsWith("/").refine((value) => !value.startsWith("//")),
  provenance: z.object({ kind: z.enum(["real", "illustrative_example"]), label: z.string().nullable() }),
  themedItems: z.discriminatedUnion("status", [
    z.object({ status: z.literal("available"), items: z.array(z.object({ id: z.string(), name: z.string(), price: z.number().finite().nonnegative(), source: z.enum(["package", "service"]) })) }),
    z.object({ status: z.enum(["no_verified_matches", "unavailable"]) }),
  ]),
});
const packageSchema = z.object({
  packageId: z.string().min(1), name: z.string().min(1), baseGuests: z.number().int().positive(), guestCount: z.number().int().positive().nullable(),
  estimate: z.object({
    status: z.enum(["available", "unavailable"]), subtotalCop: z.number().finite().nonnegative().nullable(),
    basis: z.literal("before_vat_and_commission"), source: z.enum(["happia_api", "postgres", "seeded_last_good"]),
    fetchedAt: z.string().nullable(), snapshotAgeSeconds: z.number().int().nonnegative().nullable(), notice: z.string().min(1),
  }).strict(),
  coverage: z.object({ event: z.enum(["matches", "unknown"]), theme: z.enum(["matches", "unknown"]), city: z.enum(["matches", "unknown"]), guests: z.enum(["matches_base", "differs_from_base", "unknown"]) }).strict(),
  disclosures: z.array(z.string()),
  categories: z.array(z.string()).optional(),
}).strict();
const headlineBriefSchema = z.object({
  eventKind: z.string().nullable().optional(), eventName: z.string().nullable().optional(), honoreeName: z.string().nullable().optional(),
  companyName: z.string().nullable().optional(), schoolName: z.string().nullable().optional(), date: z.string().nullable().optional(),
  startTime: z.string().nullable().optional(), guestCount: z.number().nullable().optional(), city: z.string().nullable().optional(),
}).passthrough();
const changeSchema = z.object({ field: z.string(), from: z.string(), to: z.string(), turnId: z.string().nullable(), impact: z.string().nullable() }).passthrough();
const stateSchema = z.object({
  directionOffers: z.array(directionSchema), standardPackage: packageSchema.nullable(),
  summary: z.object({ version: z.number().int().positive(), text: z.string().min(1), briefVersion: z.number().int().nonnegative() }).nullable(),
  approval: z.object({ summaryVersion: z.number().int().positive(), confirmedAt: z.string() }).nullable(),
  brief: headlineBriefSchema.optional(),
  changes: z.array(changeSchema).optional(),
  selectedDirectionId: z.string().nullable().optional(),
}).passthrough();

const EVENT_TITLES: Record<string, string> = { birthday: "Cumpleaños", corporate: "Evento corporativo", school: "Evento escolar", wedding: "Boda", social: "Celebración", other: "Celebración" };

const dayMonth = new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", timeZone: "UTC" });
/** "2026-12-10" → "10 de dic"; free-text dates ("el 10 de diciembre") are shown as given. */
function shortDate(value: string | null | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return value ?? null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : dayMonth.format(date).replace(".", "");
}

function headlineFrom(brief: z.infer<typeof headlineBriefSchema> | undefined): AdvisorHeadline {
  if (!brief) return { title: null, facts: [], city: null };
  const owner = brief.eventKind === "corporate" ? brief.companyName : brief.eventKind === "school" ? brief.schoolName : brief.honoreeName;
  const kind = brief.eventKind ? EVENT_TITLES[brief.eventKind] ?? null : null;
  const title = brief.eventName ?? (kind && owner ? `${kind} de ${owner}` : kind);
  const facts = [shortDate(brief.date), brief.startTime, brief.guestCount ? `${brief.guestCount} invitados` : null, brief.city]
    .filter((fact): fact is string => typeof fact === "string" && fact.trim() !== "");
  return { title: title ?? null, facts, city: brief.city ?? null };
}

const copFormat = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

function cardsFromState(value: unknown): AdvisorUiState | null {
  const parsed = stateSchema.safeParse(value);
  if (!parsed.success) return null;
  const cards: AdvisorComposerCard[] = parsed.data.directionOffers.map((offer) => {
    const items = offer.themedItems.status === "available" ? offer.themedItems.items : [];
    const descriptions = [offer.description, offer.provenance.label ?? (offer.provenance.kind === "illustrative_example" ? "Ejemplo ilustrativo; no es una propuesta confirmada." : "Foto de referencia"),
      ...items.map((item) => `${item.name}: ${copFormat.format(item.price)} COP (${item.source === "package" ? "paquete" : "servicio"})`),
      ...(offer.themedItems.status === "unavailable" ? ["Precios no disponibles"] : offer.themedItems.status === "no_verified_matches" ? ["Sin productos verificados para esta idea"] : [])];
    return { kind: "direction", id: offer.id, title: offer.title, description: descriptions.join(" · "), content: `Me interesa esta dirección: ${offer.title} (${offer.id}).`, imageUrl: offer.photoUrl,
      ...(items[0] ? { source: items[0].source === "package" ? "Catálogo Happia · paquete" : "Catálogo Happia · servicio", price: `${copFormat.format(items[0].price)} COP` } : {}) };
  });
  const proposal = parsed.data.standardPackage;
  if (proposal) {
    const estimate = proposal.estimate;
    const freshness = estimate.fetchedAt
      ? `Catálogo consultado: ${estimate.fetchedAt}${estimate.snapshotAgeSeconds === null ? "" : ` (hace ${estimate.snapshotAgeSeconds} segundos)`}`
      : "Fecha de consulta del catálogo no disponible";
    cards.push({ kind: "package", id: proposal.packageId, title: proposal.name,
      description: [
        estimate.status === "available" && estimate.subtotalCop !== null ? `Estimado: ${copFormat.format(estimate.subtotalCop)} COP antes de IVA y comisión.` : "Precio estimado no disponible.",
        estimate.notice,
        freshness,
        ...proposal.disclosures,
      ].join(" "),
      content: `Me interesa el paquete ${proposal.name}.`, source: estimate.source === "seeded_last_good" ? "Último catálogo verificado" : "Catálogo Happia",
      ...(estimate.status === "available" && estimate.subtotalCop !== null ? { price: `${copFormat.format(estimate.subtotalCop)} COP` } : {}) });
  }
  const summary = parsed.data.summary ? { version: parsed.data.summary.version, text: parsed.data.summary.text } : null;
  const changes = (parsed.data.changes ?? []).map((change) => ({ turnId: change.turnId, text: formatBriefChange(change), impact: change.impact }));
  return { cards, summary, approved: summary !== null && parsed.data.approval?.summaryVersion === summary.version, headline: headlineFrom(parsed.data.brief), changes, proposal, directionChosen: Boolean(parsed.data.selectedDirectionId) };
}

function parseProgress(value: unknown): AdvisorProgress | null {
  const parsed = progressSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function parseMessages(value: unknown): AdvisorMessage[] | null {
  if (!Array.isArray(value)) return null;
  const parsed = z.array(messageSchema).safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseAdvisorSnapshot(value: unknown): AdvisorSnapshot | null {
  if (!recordSchema.safeParse(value).success || typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const snapshot = value as Record<string, unknown>;
  if (typeof snapshot.conversation !== "object" || snapshot.conversation === null || Array.isArray(snapshot.conversation)) return null;
  const conversationId = Reflect.get(snapshot.conversation, "id");
  const messages = parseMessages(snapshot.messages);
  const progress = parseProgress(snapshot.progress);
  const uiState = cardsFromState(snapshot.state);
  if (typeof conversationId !== "string" || !messages || !progress || !uiState || !Number.isSafeInteger(snapshot.briefVersion) || (snapshot.briefVersion as number) < 0) return null;
  return { conversationId, messages, progress, briefVersion: snapshot.briefVersion as number, ...uiState };
}

export function parseCreatedConversation(value: unknown): ({ conversationId: string; progress: AdvisorProgress; briefVersion: number } & AdvisorUiState) | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const conversation = Reflect.get(value, "conversation");
  const conversationId = typeof conversation === "object" && conversation !== null ? Reflect.get(conversation, "id") : null;
  const progress = parseProgress(Reflect.get(value, "progress"));
  const uiState = cardsFromState(Reflect.get(value, "state"));
  const briefVersion = Reflect.get(value, "briefVersion");
  if (typeof conversationId !== "string" || !progress || !uiState || !Number.isSafeInteger(briefVersion) || (briefVersion as number) < 0) return null;
  return { conversationId, progress, briefVersion: briefVersion as number, ...uiState };
}

type AdvisorEventState = { progress: AdvisorProgress; briefVersion: number } & AdvisorUiState;
export function parseAdvisorEvent(value: unknown): { type: "text"; delta: string } | ({ type: "state" } & AdvisorEventState) | ({ type: "final"; messageId: string } & AdvisorEventState) | ({ type: "error"; message: string } & AdvisorEventState) | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  if (event.type === "text" && typeof event.delta === "string") return { type: "text", delta: event.delta };
  if (event.type !== "tool" && event.type !== "final" && event.type !== "error") return null;
  const progress = parseProgress(event.progress);
  const uiState = cardsFromState(event.state);
  if (!progress || !uiState || !Number.isSafeInteger(event.briefVersion) || (event.briefVersion as number) < 0) return null;
  const common = { progress, briefVersion: event.briefVersion as number, ...uiState };
  if (event.type === "tool") return { type: "state", ...common };
  if (event.type === "final" && typeof event.messageId === "string") return { type: "final", messageId: event.messageId, ...common };
  if (event.type === "error" && typeof event.message === "string") return { type: "error", message: event.message, ...common };
  return null;
}
