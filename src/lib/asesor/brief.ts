import type { EventBrief, EventBriefState } from "./contracts";
import { parseEventBriefState } from "./contracts";
import type { createAsesorRepository } from "./repository";

export type BriefProjection = "full" | "vendor";
export type BriefPhoto = { id: string; mimeType: string; thumbnailUrl: string; kind: "inspiration" | "venue"; confirmed: boolean | null; preference: "like" | "dislike" | "neutral" };
export type BriefViewData = {
  projection: BriefProjection;
  summary: { version: number; text: string };
  brief: Partial<EventBrief>;
  approval: { summaryVersion: number; confirmedAt: string } | null;
  photos: BriefPhoto[];
};
type BriefRepository = Pick<ReturnType<typeof createAsesorRepository>, "upsertAccount" | "getConversation" | "latestBrief" | "listMessages">;
export type BriefLoadResult = { status: "ok"; data: BriefViewData } | { status: "not_found" | "not_approved" };

const VENDOR_EXCLUDED_FIELDS = new Set([
  "contactName", "contactPhone", "contactEmail", "contactPermission", "addressPermission",
  "address", "budget", "honoreeName",
]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function personalValues(brief: EventBrief): string[] {
  const budgetText = brief.budget === null ? [] : [
    String(brief.budget),
    new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 }).format(brief.budget),
    new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(brief.budget),
  ];
  return [brief.contactName, brief.contactPhone, brief.contactEmail, brief.address, brief.honoreeName, ...budgetText]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 1)
    .sort((left, right) => right.length - left.length);
}

function redactText(value: string, values: string[]): string {
  let redacted = value;
  for (const personalValue of values) {
    redacted = redacted.replace(new RegExp(escapeRegExp(personalValue), "gi"), "[dato privado]");
  }
  return redacted
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[dato privado]")
    .replace(/\b(?:COP|USD)\s*\$?\s*\d[\d.,]*/gi, "[dato privado]")
    .replace(/\$\s*\d[\d.,]*/g, "[dato privado]")
    .replace(/\b(?:\+?\d[\d\s().-]{7,}\d)\b/g, "[dato privado]");
}

function redactFreeText(value: unknown, personal: string[]): unknown {
  if (typeof value === "string") return redactText(value, personal);
  if (Array.isArray(value)) return value.map((item) => redactFreeText(item, personal));
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactFreeText(item, personal)]));
}

function vendorBrief(brief: EventBrief): Partial<EventBrief> {
  const personal = personalValues(brief);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(brief)) {
    if (VENDOR_EXCLUDED_FIELDS.has(key)) continue;
    // Model-writable values can echo private data in any field, including names and packages.
    result[key] = redactFreeText(value, personal);
  }
  return result as Partial<EventBrief>;
}

function summaryText(brief: Partial<EventBrief>): string {
  const fields: Array<[string, string | number | null | undefined]> = [
    ["Evento", brief.eventName ?? brief.eventKind],
    ["Fecha", brief.date],
    ["Hora", [brief.startTime, brief.endTime].filter(Boolean).join("–") || null],
    ["Invitados", brief.guestCount],
    ["Lugar", [brief.venueName, brief.venueType, brief.city, brief.department].filter(Boolean).join(", ") || null],
    ["Tema", brief.theme],
    ["Estilo", brief.style],
    ["Colores", brief.colors?.join(", ") || null],
    ["Prioridad", brief.organiserPriority],
    ["Solicitudes", brief.brandRequests],
    ["Notas", brief.notes],
    ["Paquete propuesto", brief.proposedPackage],
  ];
  return fields.filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([label, value]) => `${label}: ${value}`).join("\n");
}

export function createBriefProjection(
  state: EventBriefState,
  photos: BriefPhoto[],
  projection: BriefProjection,
): BriefViewData {
  const brief = projection === "full" ? { ...state.brief } : vendorBrief(state.brief);
  return {
    projection,
    summary: {
      version: state.summary?.version ?? state.summarySequence,
      text: summaryText(brief),
    },
    brief,
    approval: projection === "full" ? state.approval : null,
    photos: photos.map((photo) => ({ ...photo })),
  };
}

export async function loadApprovedBrief(input: {
  repository: BriefRepository;
  conversationId: string;
  accountId: string;
  projection: BriefProjection;
  thumbnail: (mimeType: string, data: Buffer) => Promise<string | null>;
}): Promise<BriefLoadResult> {
  const conversation = await input.repository.getConversation(input.conversationId);
  if (!conversation || conversation.accountId !== input.accountId) return { status: "not_found" };
  const [storedBrief, messages] = await Promise.all([
    input.repository.latestBrief(input.conversationId),
    input.repository.listMessages(input.conversationId),
  ]);
  const state = parseEventBriefState(storedBrief?.state);
  if (!state.summary || state.approval?.summaryVersion !== state.summary.version) return { status: "not_approved" };
  const photos: BriefPhoto[] = [];
  for (const message of messages) {
    for (const attachment of message.attachments) {
      if (!attachment.mimeType.startsWith("image/")) continue;
      const thumbnailUrl = await input.thumbnail(attachment.mimeType, attachment.data);
      if (thumbnailUrl) photos.push({ id: attachment.id, mimeType: attachment.mimeType, thumbnailUrl, kind: attachment.kind ?? "inspiration", confirmed: attachment.confirmed ?? null, preference: attachment.preference ?? "neutral" });
    }
  }
  return { status: "ok", data: createBriefProjection(state, photos, input.projection) };
}

export function createBriefGetHandler(dependencies: {
  authorize: (request: Request) => { role: "user" | "admin" } | Response;
  repository: () => BriefRepository;
  thumbnail: (mimeType: string, data: Buffer) => Promise<string | null>;
}) {
  return async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
    const session = dependencies.authorize(request);
    if (session instanceof Response) return session;
    const projection: BriefProjection = new URL(request.url).searchParams.get("projection") === "vendor" ? "vendor" : "full";
    const { id } = await context.params;
    try {
      const repository = dependencies.repository();
      const { id: accountId } = await repository.upsertAccount(`advisor:${session.role}`);
      const result = await loadApprovedBrief({ repository, conversationId: id, accountId, projection, thumbnail: dependencies.thumbnail });
      const headers = { "Cache-Control": "private, no-store" };
      if (result.status !== "ok") {
        const notFound = result.status === "not_found";
        return Response.json({ code: notFound ? "BRIEF_NOT_FOUND" : "BRIEF_NOT_APPROVED" }, { status: notFound ? 404 : 409, headers });
      }
      return Response.json(result.data, { headers });
    } catch {
      console.error("[asesor-brief] request failed");
      return Response.json({ code: "ADVISOR_STORAGE_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
    }
  };
}
