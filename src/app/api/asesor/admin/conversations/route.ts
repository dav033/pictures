import { requireAdvisorRole } from "@/lib/asesor/auth";
import { listAdminConversationSnapshots } from "@/lib/asesor/admin";
import { createAsesorRepository } from "@/lib/asesor/repository";

export async function GET(request: Request) {
  const session = requireAdvisorRole(request, ["admin"]);
  if (session instanceof Response) return session;
  try {
    const conversations = await listAdminConversationSnapshots(createAsesorRepository());
    return Response.json({ conversations }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ code: "ADVISOR_STORAGE_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
