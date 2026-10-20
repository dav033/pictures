import { z } from "zod";
import { requireAdvisorRole } from "@/lib/asesor/auth";
import { createAsesorRepository } from "@/lib/asesor/repository";
import { isSameOriginRequest } from "@/lib/auth/request";
import { parseEventBriefState } from "@/lib/asesor/contracts";

const CreateSchema = z.object({ id: z.string().uuid().optional(), title: z.string().trim().max(160).optional() }).strict();
const accountKey = (role: "user" | "admin") => `advisor:${role}`;

export async function GET(request: Request) {
  const session = requireAdvisorRole(request);
  if (session instanceof Response) return session;
  try {
    const repo = createAsesorRepository();
    const { id } = await repo.upsertAccount(accountKey(session.role));
    const conversations = await repo.listConversations(id);
    return Response.json({ conversations });
  } catch {
    return Response.json({ code: "ADVISOR_STORAGE_UNAVAILABLE" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const session = requireAdvisorRole(request);
  if (session instanceof Response) return session;
  if (!isSameOriginRequest(request)) return Response.json({ code: "INVALID_ORIGIN" }, { status: 403 });
  let input: z.infer<typeof CreateSchema>;
  try { input = CreateSchema.parse(await request.json()); } catch { return Response.json({ code: "INVALID_INPUT" }, { status: 400 }); }
  try {
    const repo = createAsesorRepository();
    const { id: accountId } = await repo.upsertAccount(accountKey(session.role));
    const id = input.id ?? crypto.randomUUID();
    const created = await repo.createConversation(id, accountId, input.title);
    const conversation = await repo.getConversation(id);
    if (!created.inserted || !conversation || conversation.accountId !== accountId) return Response.json({ code: "CONVERSATION_CONFLICT" }, { status: 409 });
    await repo.mutateBrief(id, () => parseEventBriefState(null));
    return Response.json({ conversation, state: parseEventBriefState(null) }, { status: 201 });
  } catch {
    return Response.json({ code: "ADVISOR_STORAGE_UNAVAILABLE" }, { status: 503 });
  }
}
