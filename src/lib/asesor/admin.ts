import "server-only";

import { readAdvisorSessionToken } from "./auth";
import { parseEventBriefState } from "./contracts";
import { calculateBriefProgress, calculateStateProgress } from "./progress";
import type { AdminConversationRow, AsesorRepository, StoredMessage } from "./repository";

export function getAdminPageAccess(token: string | undefined): "anonymous" | "forbidden" | "admin" {
  const session = readAdvisorSessionToken(token);
  if (!session) return "anonymous";
  return session.role === "admin" ? "admin" : "forbidden";
}

export type AdminConversationSnapshot = {
  id: string;
  title: string | null;
  updatedAt: string;
  status: "in_progress" | "brief_ready" | "approved";
  progress: Omit<ReturnType<typeof calculateBriefProgress>, "step">;
  lastQuestion: string | null;
};

export type AdminConversationDetail = AdminConversationSnapshot & {
  transcript: Array<{
    id: string;
    role: StoredMessage["role"];
    content: string;
    attachments: Array<{ id: string; mimeType: string; byteSize: number; kind: "inspiration" | "venue"; confirmed: boolean | null; preference: "like" | "dislike" | "neutral" }>;
  }>;
  brief: ReturnType<typeof parseEventBriefState>["brief"];
  approvedBrief: { version: number; text: string } | null;
};

function lastQuestion(content: string | null): string | null {
  if (!content) return null;
  const questions = content.match(/¿[^?\n]*\?|[^.!?\n]+\?/gu);
  return questions?.at(-1)?.trim() ?? null;
}

function projectConversation(conversation: AdminConversationRow): AdminConversationSnapshot {
  const state = parseEventBriefState(conversation.latestBrief?.state);
  const approved = state.approval !== null && state.summary?.version === state.approval.summaryVersion;
  return {
    id: conversation.id,
    title: conversation.title,
    updatedAt: conversation.updatedAt,
    status: approved ? "approved" : state.summary ? "brief_ready" : "in_progress",
    progress: calculateStateProgress(state),
    lastQuestion: lastQuestion(conversation.lastAssistantMessage),
  };
}

export async function listAdminConversationSnapshots(repository: Pick<AsesorRepository, "listAdminConversations">): Promise<AdminConversationSnapshot[]> {
  const conversations = await repository.listAdminConversations();
  return conversations.map(projectConversation);
}

export async function getAdminConversationDetail(repository: Pick<AsesorRepository, "getAdminConversation" | "listMessages">, id: string): Promise<AdminConversationDetail | null> {
  const conversation = await repository.getAdminConversation(id);
  if (!conversation) return null;
  const messages = await repository.listMessages(id);
  const state = parseEventBriefState(conversation.latestBrief?.state);
  const approved = state.approval !== null && state.summary?.version === state.approval.summaryVersion;
  return {
    ...projectConversation(conversation),
    transcript: messages.map(({ id: messageId, role, content, attachments }) => ({
      id: messageId,
      role,
      content,
      attachments: attachments.map(({ id: attachmentId, mimeType, byteSize, kind, confirmed, preference }) => ({ id: attachmentId, mimeType, byteSize, kind: kind ?? "inspiration", confirmed: confirmed ?? null, preference: preference ?? "neutral" })),
    })),
    brief: state.brief,
    approvedBrief: approved && state.summary ? { version: state.summary.version, text: state.summary.text } : null,
  };
}
