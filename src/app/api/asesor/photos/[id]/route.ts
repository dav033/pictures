import { requireAdvisorRole } from "@/lib/asesor/auth";
import { createAsesorRepository } from "@/lib/asesor/repository";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = requireAdvisorRole(request);
  if (session instanceof Response) return session;
  const { id } = await context.params;
  try {
    const repo = createAsesorRepository();
    const photo = await repo.getAttachment(id);
    if (!photo) return Response.json({ code: "PHOTO_NOT_FOUND" }, { status: 404, headers: { "Cache-Control": "private, no-store" } });
    const { id: accountId } = await repo.upsertAccount(`advisor:${session.role}`);
    const ownsConversation = photo.accountId === accountId;
    const isAdminCustomerPhoto = session.role === "admin" && (await repo.getAdminConversation(photo.conversationId)) !== null;
    if (!ownsConversation && !isAdminCustomerPhoto) return Response.json({ code: "PHOTO_NOT_FOUND" }, { status: 404, headers: { "Cache-Control": "private, no-store" } });
    return new Response(new Uint8Array(photo.data), { headers: { "Content-Type": photo.mimeType, "Content-Length": String(photo.byteSize), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return Response.json({ code: "ADVISOR_STORAGE_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
