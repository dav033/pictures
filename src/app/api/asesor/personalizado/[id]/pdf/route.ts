import { requireAdvisorRole } from "@/lib/asesor/auth";
import { createAsesorRepository } from "@/lib/asesor/repository";
import { createPersonalizedPdf } from "@/lib/asesor/personalizado/pdf";
import { PERSONALIZED_TITLE, PersonalizedStateSchema } from "@/lib/asesor/personalizado/state";
import { z } from "zod";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = requireAdvisorRole(request);
  if (session instanceof Response) return session;
  const id = z.string().uuid().safeParse((await context.params).id);
  if (!id.success) return Response.json({ code: "NOT_FOUND" }, { status: 404 });
  try {
    const repo = createAsesorRepository();
    const account = await repo.upsertAccount(`advisor-personalized:${session.role}`);
    const conversation = await repo.getConversation(id.data);
    if (!conversation || conversation.accountId !== account.id || conversation.title !== PERSONALIZED_TITLE) return Response.json({ code: "NOT_FOUND" }, { status: 404 });
    const [saved, messages] = await Promise.all([repo.latestBrief(id.data), repo.listMessages(id.data)]);
    const state = PersonalizedStateSchema.parse(saved?.state);
    if (!state.approved || messages.findLast((message) => message.role === "user")?.id !== state.completedTurn) return Response.json({ code: "NOT_APPROVED" }, { status: 409 });
    const photos = messages.flatMap((message) => message.attachments).filter((photo) => state.approvedPhotoIds.includes(photo.id));
    const bytes = await createPersonalizedPdf(state.brief, photos);
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": "inline; filename=brief-personalizado.pdf", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    console.error("[personalized-pdf] failed", error instanceof Error ? error.name : "unknown");
    return Response.json({ code: "PDF_UNAVAILABLE" }, { status: 503 });
  }
}
