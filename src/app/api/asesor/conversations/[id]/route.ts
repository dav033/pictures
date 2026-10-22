import { requireAdvisorRole } from "@/lib/asesor/auth";
import { createAsesorRepository } from "@/lib/asesor/repository";
import { parseEventBriefState } from "@/lib/asesor/contracts";
import { calculateBriefProgress } from "@/lib/asesor/progress";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = requireAdvisorRole(request);
  if (session instanceof Response) return session;
  const { id } = await context.params;
  try {
    const repo = createAsesorRepository();
    const { id: accountId } = await repo.upsertAccount(`advisor:${session.role}`);
    const conversation = await repo.getConversation(id);
    if (!conversation || conversation.accountId !== accountId) return Response.json({ code: "CONVERSATION_NOT_FOUND" }, { status: 404 });
    const [messages, brief] = await Promise.all([repo.listMessages(id), repo.latestBrief(id)]);
    const state = parseEventBriefState(brief?.state);
    return Response.json({ conversation, messages: messages.map(({ id: messageId, role, content, attachments }) => ({ id: messageId, role, content, attachments: attachments.map(({ id, mimeType, byteSize, kind, confirmed, preference }) => ({ id, mimeType, byteSize, kind, confirmed, preference })) })), state, progress: calculateBriefProgress(state.brief), briefVersion: brief?.version ?? 0 });
  } catch {
    return Response.json({ code: "ADVISOR_STORAGE_UNAVAILABLE" }, { status: 503 });
  }
}
