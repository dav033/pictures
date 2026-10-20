import { requireAdvisorRole } from "@/lib/asesor/auth";
import { createAsesorRepository } from "@/lib/asesor/repository";
import { parseEventBriefState } from "@/lib/asesor/contracts";

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
    return Response.json({ conversation, messages: messages.map(({ id: messageId, role, content }) => ({ id: messageId, role, content })), state: parseEventBriefState(brief?.state) });
  } catch {
    return Response.json({ code: "ADVISOR_STORAGE_UNAVAILABLE" }, { status: 503 });
  }
}
