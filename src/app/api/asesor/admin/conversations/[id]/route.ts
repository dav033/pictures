import { requireAdvisorRole } from "@/lib/asesor/auth";
import { getAdminConversationDetail } from "@/lib/asesor/admin";
import { createAsesorRepository } from "@/lib/asesor/repository";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = requireAdvisorRole(request, ["admin"]);
  if (session instanceof Response) return session;
  const { id } = await context.params;
  try {
    const conversation = await getAdminConversationDetail(createAsesorRepository(), id);
    if (!conversation) return Response.json({ code: "CONVERSATION_NOT_FOUND" }, { status: 404, headers: { "Cache-Control": "no-store" } });
    return Response.json({ conversation }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ code: "ADVISOR_STORAGE_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
