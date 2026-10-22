import { parseDirectionOffers, type DirectionOffer } from "@/lib/asesor/directions-contract";

export const ADVISOR_CONVERSATION_STORAGE_KEY = "asesor.conversationId";

export type AdvisorMessage = { id: string; role: "user" | "assistant"; content: string };
export type AdvisorProgress = { complete: boolean; completed: number; required: number; missing: string[] };
export type AdvisorDirection = DirectionOffer;
export type AdvisorComposerCard =
  | { kind: "direction"; id: string; title: string; description: string; content: string }
  | { kind: "package"; id: string; title: string; description: string; content: string };

export type AdvisorSnapshot = {
  conversationId: string;
  messages: AdvisorMessage[];
  progress: AdvisorProgress;
  briefVersion: number;
  directionOffers: DirectionOffer[];
  selectedDirectionId: string | null;
  state?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseAdvisorSnapshot(value: unknown): AdvisorSnapshot | null {
  if (!isRecord(value) || !isRecord(value.conversation) || typeof value.conversation.id !== "string"
    || !Array.isArray(value.messages) || !isRecord(value.progress) || typeof value.progress.complete !== "boolean"
    || !Number.isSafeInteger(value.progress.completed) || !Number.isSafeInteger(value.progress.required)
    || !Array.isArray(value.progress.missing) || !value.progress.missing.every((item) => typeof item === "string")
    || !Number.isSafeInteger(value.briefVersion) || (value.briefVersion as number) < 0) return null;

  const messages: AdvisorMessage[] = [];
  for (const message of value.messages) {
    if (!isRecord(message) || typeof message.id !== "string" || (message.role !== "user" && message.role !== "assistant") || typeof message.content !== "string") return null;
    messages.push({ id: message.id, role: message.role, content: message.content });
  }
  const state = isRecord(value.state) ? value.state : null;
  const directionOffers = state ? parseDirectionOffers(state.directionOffers) ?? [] : [];
  return {
    conversationId: value.conversation.id,
    messages,
    progress: { complete: value.progress.complete, completed: value.progress.completed as number, required: value.progress.required as number, missing: value.progress.missing as string[] },
    briefVersion: value.briefVersion as number,
    directionOffers,
    selectedDirectionId: state && typeof state.selectedDirectionId === "string"
      && directionOffers.some(({ id }) => id === state.selectedDirectionId)
      ? state.selectedDirectionId
      : null,
    state,
  };
}

export function parseCreatedConversation(value: unknown): { conversationId: string; progress: AdvisorProgress; briefVersion: number } | null {
  if (!isRecord(value) || !isRecord(value.conversation) || typeof value.conversation.id !== "string"
    || !isRecord(value.progress) || typeof value.progress.complete !== "boolean"
    || !Number.isSafeInteger(value.progress.completed) || !Number.isSafeInteger(value.progress.required)
    || !Array.isArray(value.progress.missing) || !value.progress.missing.every((item) => typeof item === "string")
    || !Number.isSafeInteger(value.briefVersion) || (value.briefVersion as number) < 0) return null;
  return {
    conversationId: value.conversation.id,
    progress: { complete: value.progress.complete, completed: value.progress.completed as number, required: value.progress.required as number, missing: value.progress.missing as string[] },
    briefVersion: value.briefVersion as number,
  };
}
