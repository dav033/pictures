export const ADVISOR_CONVERSATION_STORAGE_KEY = "asesor.conversationId";

export type AdvisorPhoto = { id: string; mimeType: string; byteSize: number; kind: "inspiration" | "venue"; confirmed: boolean | null; preference: "like" | "dislike" | "neutral" };
export type AdvisorMessage = { id: string; role: "user" | "assistant"; content: string; attachments?: AdvisorPhoto[] };
export type AdvisorProgress = { complete: boolean; completed: number; required: number; missing: string[] };
export type AdvisorComposerCard =
  | { kind: "direction"; id: string; title: string; description: string; content: string }
  | { kind: "package"; id: string; title: string; description: string; content: string };

export type AdvisorSnapshot = {
  conversationId: string;
  messages: AdvisorMessage[];
  progress: AdvisorProgress;
  briefVersion: number;
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
    let attachments: AdvisorPhoto[] | undefined;
    if (message.attachments !== undefined) {
      if (!Array.isArray(message.attachments)) return null;
      attachments = [];
      for (const item of message.attachments) {
        if (!isRecord(item) || typeof item.id !== "string" || (item.mimeType !== "image/jpeg" && item.mimeType !== "image/png" && item.mimeType !== "image/webp")
          || !Number.isSafeInteger(item.byteSize) || (item.byteSize as number) < 1 || (item.byteSize as number) > 6 * 1024 * 1024
          || (item.kind !== "inspiration" && item.kind !== "venue") || (item.confirmed !== null && typeof item.confirmed !== "boolean")
          || (item.preference !== "like" && item.preference !== "dislike" && item.preference !== "neutral")) return null;
        attachments.push({ id: item.id, mimeType: item.mimeType, byteSize: item.byteSize as number, kind: item.kind, confirmed: item.confirmed, preference: item.preference });
      }
    }
    messages.push({ id: message.id, role: message.role, content: message.content, ...(attachments ? { attachments } : {}) });
  }
  return {
    conversationId: value.conversation.id,
    messages,
    progress: { complete: value.progress.complete, completed: value.progress.completed as number, required: value.progress.required as number, missing: value.progress.missing as string[] },
    briefVersion: value.briefVersion as number,
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
