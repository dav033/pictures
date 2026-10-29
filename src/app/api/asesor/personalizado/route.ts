import { z } from "zod";
import { requireAdvisorRole } from "@/lib/asesor/auth";
import { createAsesorRepository } from "@/lib/asesor/repository";
import { isSameOriginRequest } from "@/lib/auth/request";
import { prepareAdvisorPhoto } from "@/lib/asesor/photos";
import { runPersonalizedTurn } from "@/lib/asesor/personalizado/agent";
import { approvePersonalizedBrief, completePersonalizedTurn, initialPersonalizedState, PERSONALIZED_TITLE, PersonalizedStateSchema } from "@/lib/asesor/personalizado/state";
import type { Mensaje } from "@sempertex/agente-core";

const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create") }).strict(),
  z.object({ action: z.literal("turn"), id: z.string().uuid(), turnId: z.string().uuid(), content: z.string().trim().min(1).max(12000), version: z.number().int().positive() }).strict(),
  z.object({ action: z.literal("approve"), id: z.string().uuid(), version: z.number().int().positive() }).strict(),
]);

async function owned(id: string, role: "user" | "admin") {
  const repo = createAsesorRepository();
  const account = await repo.upsertAccount(`advisor-personalized:${role}`);
  const conversation = await repo.getConversation(id);
  if (!conversation || conversation.accountId !== account.id || conversation.title !== PERSONALIZED_TITLE) return null;
  return { repo, conversation };
}

export async function GET(request: Request) {
  const session = requireAdvisorRole(request);
  if (session instanceof Response) return session;
  const id = z.string().uuid().safeParse(new URL(request.url).searchParams.get("id"));
  if (!id.success) return Response.json({ code: "INVALID_INPUT" }, { status: 400 });
  try {
    const item = await owned(id.data, session.role);
    if (!item) return Response.json({ code: "NOT_FOUND" }, { status: 404 });
    const [saved, messages] = await Promise.all([item.repo.latestBrief(id.data), item.repo.listMessages(id.data)]);
    const state = PersonalizedStateSchema.parse(saved?.state);
    if (state.completedTurn && state.assistantText && !messages.some((message) => message.id === `${state.completedTurn}:assistant`)) {
      await item.repo.appendMessage(id.data, { id: `${state.completedTurn}:assistant`, role: "assistant", content: state.assistantText });
      messages.push({ id: `${state.completedTurn}:assistant`, role: "assistant", content: state.assistantText, attachments: [] });
    }
    return Response.json({ id: id.data, state, version: saved?.version, messages: messages.map((m) => ({ id: m.id, role: m.role, content: m.content, attachments: m.attachments.map((a) => ({ id: a.id, mimeType: a.mimeType })) })) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return Response.json({ code: "STORAGE_UNAVAILABLE" }, { status: 503 }); }
}

export async function POST(request: Request) {
  const session = requireAdvisorRole(request);
  if (session instanceof Response) return session;
  if (!isSameOriginRequest(request)) return Response.json({ code: "INVALID_ORIGIN" }, { status: 403 });
  let value: unknown;
  try { value = await request.json(); } catch { return Response.json({ code: "INVALID_INPUT" }, { status: 400 }); }
  const parsed = inputSchema.safeParse(value);
  if (!parsed.success) return Response.json({ code: "INVALID_INPUT" }, { status: 400 });
  const input = parsed.data;
  try {
    if (input.action === "create") {
      const repo = createAsesorRepository();
      const account = await repo.upsertAccount(`advisor-personalized:${session.role}`);
      const id = crypto.randomUUID();
      await repo.createConversation(id, account.id, PERSONALIZED_TITLE);
      const saved = await repo.mutateBrief(id, () => initialPersonalizedState());
      return Response.json({ id, state: saved.state, version: saved.version, messages: [] }, { status: 201 });
    }
    const item = await owned(input.id, session.role);
    if (!item) return Response.json({ code: "NOT_FOUND" }, { status: 404 });
    const latest = await item.repo.latestBrief(input.id);
    if (!latest) return Response.json({ code: "STALE_VERSION" }, { status: 409 });
    const state = PersonalizedStateSchema.parse(latest.state);
    if (input.action === "turn" && state.completedTurn === input.turnId && state.assistantText) {
      await item.repo.appendMessage(input.id, { id: `${input.turnId}:assistant`, role: "assistant", content: state.assistantText });
      return Response.json({ state, version: latest.version, text: state.assistantText });
    }
    if (latest.version !== input.version) return Response.json({ code: "STALE_VERSION" }, { status: 409 });
    if (input.action === "approve") {
      const messages = await item.repo.listMessages(input.id);
      const lastUser = messages.findLast((message) => message.role === "user");
      if (!lastUser || lastUser.id !== state.completedTurn) return Response.json({ code: "TURN_PENDING" }, { status: 409 });
      const approvedPhotoIds = messages.flatMap((message) => message.attachments.map((photo) => photo.id));
      const result = await item.repo.mutateBrief(input.id, (raw, version) => {
        if (version !== input.version) throw new Error("STALE_VERSION");
        return approvePersonalizedBrief(PersonalizedStateSchema.parse(raw), lastUser.id, approvedPhotoIds);
      });
      return Response.json({ state: result.state, version: result.version });
    }
    const before = await item.repo.listMessages(input.id);
    const existing = before.find((message) => message.id === input.turnId);
    if (existing && (existing.role !== "user" || existing.content !== input.content)) return Response.json({ code: "TURN_ID_CONFLICT" }, { status: 409 });
    if (!existing) await item.repo.appendMessage(input.id, { id: input.turnId, role: "user", content: input.content });
    const messages = await item.repo.listMessages(input.id);
    const history: Mensaje[] = [];
    for (const message of messages) {
      if (message.role === "assistant") history.push({ rol: "asistente", texto: message.content });
      if (message.role === "user") {
        const images = [];
        if (message.id === input.turnId) for (const photo of message.attachments) {
          const prepared = await prepareAdvisorPhoto(photo.mimeType, photo.data);
          images.push({ id: photo.id, mime: "image/jpeg", base64: prepared.derivative.toString("base64"), descripcion: "Imagen de referencia del cliente" });
        }
        history.push({ rol: "usuario", texto: message.content, ...(images.length ? { imagenes: images } : {}) });
      }
    }
    const { crearChatGemini } = await import("@sempertex/agente-core/gemini");
    const result = await runPersonalizedTurn(crearChatGemini(), history, state.brief, AbortSignal.any([request.signal, AbortSignal.timeout(45000)]));
    const saved = await item.repo.mutateBrief(input.id, (raw, version) => {
      if (version !== input.version) throw new Error("STALE_VERSION");
      return completePersonalizedTurn(PersonalizedStateSchema.parse(raw), input.turnId, result.brief, result.text);
    });
    await item.repo.appendMessage(input.id, { id: `${input.turnId}:assistant`, role: "assistant", content: result.text });
    return Response.json({ state: saved.state, version: saved.version, text: result.text });
  } catch (error) {
    if (error instanceof Error && error.message === "STALE_VERSION") return Response.json({ code: "STALE_VERSION" }, { status: 409 });
    console.error("[personalized-advisor] operation failed", error instanceof Error ? error.name : "unknown");
    return Response.json({ code: "PERSONALIZED_UNAVAILABLE" }, { status: 503 });
  }
}
