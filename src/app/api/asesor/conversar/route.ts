import { z } from "zod";
import { requireAdvisorRole } from "@/lib/asesor/auth";
import { createAsesorRepository } from "@/lib/asesor/repository";
import { parseEventBriefState } from "@/lib/asesor/contracts";
import { calculateBriefProgress } from "@/lib/asesor/progress";
import { runAdvisorTurn, type AdvisorEvent } from "@/lib/asesor/agent";
import { isSameOriginRequest } from "@/lib/auth/request";
import { applyCustomerConsentToState, customerConsent } from "@/lib/asesor/tools";

const TurnSchema = z.object({
  conversationId: z.string().min(1).max(100),
  turnId: z.string().uuid(),
  content: z.string().trim().min(1).max(12_000),
}).strict();

function sse(event: AdvisorEvent, briefVersion?: number): string {
  const payload = briefVersion === undefined ? event : { ...event, briefVersion };
  return `event: ${event.type}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export const maxDuration = 60;

export async function POST(request: Request) {
  const session = requireAdvisorRole(request);
  if (session instanceof Response) return session;
  if (!isSameOriginRequest(request)) return Response.json({ code: "INVALID_ORIGIN" }, { status: 403 });
  let input: z.infer<typeof TurnSchema>;
  try { input = TurnSchema.parse(await request.json()); } catch { return Response.json({ code: "INVALID_INPUT" }, { status: 400 }); }

  const repo = createAsesorRepository();
  let conversation;
  let userMessageInserted: boolean;
  let savedMessages;
  try {
    const { id: accountId } = await repo.upsertAccount(`advisor:${session.role}`);
    conversation = await repo.getConversation(input.conversationId);
    if (!conversation || conversation.accountId !== accountId) return Response.json({ code: "CONVERSATION_NOT_FOUND" }, { status: 404 });
    const existingMessages = await repo.listMessages(input.conversationId);
    const prior = existingMessages.find((message) => message.id === input.turnId);
    if (prior && (prior.role !== "user" || prior.content !== input.content)) return Response.json({ code: "TURN_ID_CONFLICT" }, { status: 409 });
    userMessageInserted = (await repo.appendMessage(input.conversationId, { id: input.turnId, role: "user", content: input.content })).inserted;
    const consent = customerConsent(input.content);
    if (consent.contact || consent.address || consent.refusedContact || consent.refusedAddress) {
      await repo.mutateBrief(input.conversationId, (raw) => {
        return applyCustomerConsentToState(parseEventBriefState(raw), input.content);
      });
    }
    savedMessages = await repo.listMessages(input.conversationId);
    if (!prior && !userMessageInserted) return Response.json({ code: "TURN_ID_CONFLICT" }, { status: 409 });
  } catch {
    return Response.json({ code: "ADVISOR_STORAGE_UNAVAILABLE" }, { status: 503 });
  }

  const assistantId = `${input.turnId}:assistant`;
  const previousAssistant = savedMessages.find((message) => message.id === assistantId);
  const latest = await repo.latestBrief(input.conversationId).catch(() => null);
  if (previousAssistant) {
    const state = parseEventBriefState(latest?.state);
    const terminal: AdvisorEvent = { type: "final", state, progress: calculateBriefProgress(state.brief), messageId: assistantId, retryAvailable: false };
    const replay = `${sse({ type: "text", delta: previousAssistant.content })}${sse(terminal, latest?.version ?? 0)}`;
    return new Response(replay, { headers: streamHeaders() });
  }

  let chat;
  try {
    // Use the provider directly: the general ChatPort audit wrapper stores prompts and transcript bodies.
    const { crearChatGemini } = await import("@sempertex/agente-core/gemini");
    chat = crearChatGemini();
  } catch {
    const state = parseEventBriefState(latest?.state);
    const terminal: AdvisorEvent = { type: "error", code: "PROVIDER_FAILURE", message: "El proveedor no está disponible. El mensaje quedó guardado; puedes reintentar este turno.", state, progress: calculateBriefProgress(state.brief), retryAvailable: true };
    return new Response(sse(terminal, latest?.version ?? 0), { headers: streamHeaders() });
  }

  const controller = new AbortController();
  const abortOnDisconnect = () => controller.abort();
  request.signal.addEventListener("abort", abortOnDisconnect, { once: true });
  const iterator = runAdvisorTurn({
    chat,
    messages: savedMessages,
    turnId: input.turnId,
    mutateBrief: (mutate) => repo.mutateBrief(input.conversationId, mutate),
    readBrief: async () => (await repo.latestBrief(input.conversationId))?.state ?? null,
    appendAssistant: async (id, content) => {
      const inserted = await repo.appendMessage(input.conversationId, { id, role: "assistant", content });
      if (!inserted.inserted) {
        const stored = (await repo.listMessages(input.conversationId)).find((message) => message.id === id);
        if (!stored || stored.content !== content) throw new Error("advisor_assistant_id_conflict");
      }
    },
    signal: controller.signal,
  })[Symbol.asyncIterator]();

  let terminalSent = false;
  const stream = new ReadableStream<Uint8Array>({
    async pull(streamController) {
      try {
        const next = await iterator.next();
        if (next.done) { streamController.close(); return; }
        if (next.value.type === "final" || next.value.type === "error") terminalSent = true;
        const briefVersion = next.value.type === "tool" || next.value.type === "final" || next.value.type === "error"
          ? (await repo.latestBrief(input.conversationId))?.version ?? 0
          : undefined;
        streamController.enqueue(new TextEncoder().encode(sse(next.value, briefVersion)));
        if (next.value.type === "final" || next.value.type === "error") {
          await iterator.return?.(undefined).catch(() => undefined);
          streamController.close();
        }
      } catch {
        if (terminalSent) { streamController.close(); return; }
        const state = parseEventBriefState((await repo.latestBrief(input.conversationId))?.state);
        const terminal: AdvisorEvent = { type: "error", code: "PROVIDER_FAILURE", message: "Se conservaron los datos guardados. La respuesta se interrumpió; puedes reintentar este turno.", state, progress: calculateBriefProgress(state.brief), retryAvailable: true };
        terminalSent = true;
        streamController.enqueue(new TextEncoder().encode(sse(terminal, (await repo.latestBrief(input.conversationId))?.version ?? 0)));
        streamController.close();
      }
    },
    async cancel() {
      controller.abort();
      request.signal.removeEventListener("abort", abortOnDisconnect);
      await iterator.return?.(undefined);
    },
  });
  return new Response(stream, { headers: streamHeaders() });
}

function streamHeaders(): HeadersInit {
  return { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" };
}
