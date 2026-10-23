import { z } from "zod";

export const ADVISOR_CONVERSATION_STORAGE_KEY = "asesor.conversationId";

export type AdvisorPhoto = { id: string; mimeType: string; byteSize: number; kind: "inspiration" | "venue"; confirmed: boolean | null; preference: "like" | "dislike" | "neutral" };
export type AdvisorMessage = { id: string; role: "user" | "assistant"; content: string; attachments?: AdvisorPhoto[] };
export type AdvisorProgress = { complete: boolean; completed: number; required: number; missing: string[] };
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

export type AdvisorSnapshot = {
  conversationId: string;
  messages: AdvisorMessage[];
  progress: AdvisorProgress;
  briefVersion: number;
  cards: AdvisorComposerCard[];
  summary: AdvisorSummary | null;
  approved: boolean;
};

const recordSchema = z.record(z.string(), z.unknown());
const progressSchema = z.object({ complete: z.boolean(), completed: z.number().int().nonnegative(), required: z.number().int().positive(), missing: z.array(z.string()) }).strict();
const photoSchema = z.object({
  id: z.string().min(1), mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]), byteSize: z.number().int().positive().max(6 * 1024 * 1024),
  kind: z.enum(["inspiration", "venue"]), confirmed: z.boolean().nullable(), preference: z.enum(["like", "dislike", "neutral"]),
}).strict();
const messageSchema = z.object({ id: z.string().min(1), role: z.enum(["user", "assistant"]), content: z.string(), attachments: z.array(photoSchema).optional() }).strict();
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
    basis: z.literal("before_vat_and_commission"), source: z.enum(["postgres", "seeded_last_good"]),
    fetchedAt: z.string().nullable(), snapshotAgeSeconds: z.number().int().nonnegative().nullable(), notice: z.string().min(1),
  }).strict(),
  coverage: z.object({ event: z.enum(["matches", "unknown"]), theme: z.enum(["matches", "unknown"]), city: z.enum(["matches", "unknown"]), guests: z.enum(["matches_base", "differs_from_base", "unknown"]) }).strict(),
  disclosures: z.array(z.string()),
}).strict();
const stateSchema = z.object({
  directionOffers: z.array(directionSchema), standardPackage: packageSchema.nullable(),
  summary: z.object({ version: z.number().int().positive(), text: z.string().min(1), briefVersion: z.number().int().nonnegative() }).nullable(),
  approval: z.object({ summaryVersion: z.number().int().positive(), confirmedAt: z.string() }).nullable(),
}).passthrough();

const copFormat = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

function cardsFromState(value: unknown): { cards: AdvisorComposerCard[]; summary: AdvisorSummary | null; approved: boolean } | null {
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
      content: `Me interesa el paquete ${proposal.name}.`, source: estimate.source === "postgres" ? "Catálogo Happia" : "Último catálogo verificado",
      ...(estimate.status === "available" && estimate.subtotalCop !== null ? { price: `${copFormat.format(estimate.subtotalCop)} COP` } : {}) });
  }
  const summary = parsed.data.summary ? { version: parsed.data.summary.version, text: parsed.data.summary.text } : null;
  return { cards, summary, approved: summary !== null && parsed.data.approval?.summaryVersion === summary.version };
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

export function parseCreatedConversation(value: unknown): { conversationId: string; progress: AdvisorProgress; briefVersion: number; cards: AdvisorComposerCard[]; summary: AdvisorSummary | null; approved: boolean } | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const conversation = Reflect.get(value, "conversation");
  const conversationId = typeof conversation === "object" && conversation !== null ? Reflect.get(conversation, "id") : null;
  const progress = parseProgress(Reflect.get(value, "progress"));
  const uiState = cardsFromState(Reflect.get(value, "state"));
  const briefVersion = Reflect.get(value, "briefVersion");
  if (typeof conversationId !== "string" || !progress || !uiState || !Number.isSafeInteger(briefVersion) || (briefVersion as number) < 0) return null;
  return { conversationId, progress, briefVersion: briefVersion as number, ...uiState };
}

export function parseAdvisorEvent(value: unknown): { type: "text"; delta: string } | { type: "state"; progress: AdvisorProgress; briefVersion: number; cards: AdvisorComposerCard[]; summary: AdvisorSummary | null; approved: boolean } | { type: "final"; messageId: string; progress: AdvisorProgress; briefVersion: number; cards: AdvisorComposerCard[]; summary: AdvisorSummary | null; approved: boolean } | { type: "error"; message: string; progress: AdvisorProgress; briefVersion: number; cards: AdvisorComposerCard[]; summary: AdvisorSummary | null; approved: boolean } | null {
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
