import type { ChatPort, FragmentoChat, LlamadaHerramienta, Mensaje } from "@/lib/ia/nucleo/tipos";
import type { StoredMessage } from "./repository";
import { ADVISOR_SYSTEM_PROMPT } from "./prompts/base";
import { calculateBriefProgress } from "./progress";
import { applyAdvisorTool, ADVISOR_TOOLS, applyCustomerConsentToState, type BriefMutator } from "./tools";
import { parseEventBriefState, type EventBriefState } from "./contracts";

export type AdvisorEvent =
  | { type: "text"; delta: string }
  | { type: "tool"; name: string; result: unknown; state: EventBriefState; progress: ReturnType<typeof calculateBriefProgress> }
  | { type: "final"; state: EventBriefState; progress: ReturnType<typeof calculateBriefProgress>; messageId: string; retryAvailable: false }
  | { type: "error"; code: "PROVIDER_FAILURE" | "TIMEOUT" | "CANCELLED"; message: string; state: EventBriefState; progress: ReturnType<typeof calculateBriefProgress>; retryAvailable: true };

export type AdvisorTurnDependencies = {
  chat: ChatPort;
  messages: StoredMessage[];
  turnId: string;
  mutateBrief: BriefMutator;
  readBrief: () => Promise<unknown>;
  appendAssistant: (id: string, content: string) => Promise<void>;
  signal?: AbortSignal;
  timeoutMs?: number;
};

function toHistory(messages: StoredMessage[]): Mensaje[] {
  return messages.filter((message) => message.role === "user" || message.role === "assistant").map((message) =>
    message.role === "user" ? { rol: "usuario", texto: message.content } : { rol: "asistente", texto: message.content },
  );
}

function briefForModel(state: EventBriefState) {
  const brief = { ...state.brief };
  if (!brief.contactPermission || state.refused.contact) {
    brief.contactName = null;
    brief.contactPhone = null;
    brief.contactEmail = null;
  }
  if (!brief.addressPermission || state.refused.address) brief.address = null;
  return brief;
}

async function* consumeProviderTurn(chat: ChatPort, history: Mensaje[], system: string, signal: AbortSignal): AsyncGenerator<string, { text: string; calls: LlamadaHerramienta[] }, void> {
  let text = "";
  let finish: Extract<FragmentoChat, { tipo: "fin" }> | undefined;
  const iterator = chat.turnoStream({ sistema: system, historial: history, herramientas: ADVISOR_TOOLS, signal })[Symbol.asyncIterator]();
  let abortListener: (() => void) | undefined;
  const abort = new Promise<never>((_resolve, reject) => {
    if (signal.aborted) reject(new Error("advisor_cancelled"));
    else {
      abortListener = () => reject(new Error("advisor_cancelled"));
      signal.addEventListener("abort", abortListener, { once: true });
    }
  });
  try {
    while (true) {
      const next = await Promise.race([iterator.next(), abort]);
      if (next.done) break;
      const fragment = next.value;
      if (fragment.tipo === "texto") {
        text += fragment.delta;
        yield fragment.delta;
      } else finish = fragment;
    }
  } finally {
    if (abortListener) signal.removeEventListener("abort", abortListener);
    if (signal.aborted) void iterator.return?.();
  }
  if (!finish) throw new Error("provider_stream_incomplete");
  return { text, calls: finish.llamadas };
}

/** Provider text is provisional until the stable assistant ID commits; tool receipts make retry effects idempotent. */
export async function* runAdvisorTurn(deps: AdvisorTurnDependencies): AsyncGenerator<AdvisorEvent> {
  const current = deps.messages.at(-1);
  if (!current || current.role !== "user") throw new Error("advisor_turn_requires_user_message");
  const controller = new AbortController();
  const abort = () => controller.abort();
  deps.signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => controller.abort(), deps.timeoutMs ?? 45_000);
  const consentWrite = await deps.mutateBrief((raw) => {
    const state = parseEventBriefState(raw);
    return applyCustomerConsentToState(state, current.content);
  });
  let state = parseEventBriefState(consentWrite.state);
  // Do not send prior turns to tools; they are contextual input only. The model has no access to other conversations.
  const history = toHistory(deps.messages);
  let system = `${ADVISOR_SYSTEM_PROMPT}\n\nEstado estructurado del evento (fuente de verdad): ${JSON.stringify(briefForModel(state))}\nAvance calculado por servidor: ${calculateBriefProgress(state.brief).completed}/${calculateBriefProgress(state.brief).required}.`;
  let accumulated = "";
  let operations = 0;
  try {
    while (operations < 8) {
      const providerIterator = consumeProviderTurn(deps.chat, history, system, controller.signal)[Symbol.asyncIterator]();
      let turn: { text: string; calls: LlamadaHerramienta[] } | undefined;
      while (true) {
        const next = await providerIterator.next();
        if (next.done) { turn = next.value; break; }
        accumulated += next.value;
        yield { type: "text", delta: next.value };
      }
      if (!turn) throw new Error("provider_stream_incomplete");
      if (turn.calls.length === 0) {
        const assistantId = `${deps.turnId}:assistant`;
        await deps.appendAssistant(assistantId, accumulated);
        state = parseEventBriefState(await deps.readBrief());
        yield { type: "final", state, progress: calculateBriefProgress(state.brief), messageId: assistantId, retryAvailable: false };
        return;
      }
      if (turn.calls.length) history.push({ rol: "asistente", llamadas: turn.calls });
      else if (turn.text) history.push({ rol: "asistente", texto: turn.text });
      for (let index = 0; index < turn.calls.length; index++) {
        const call = turn.calls[index];
        const effect = await applyAdvisorTool({ call, operationId: `${deps.turnId}:${operations}:${index}`, currentCustomerText: current.content, mutateBrief: deps.mutateBrief });
        state = effect.state;
        history.push({ rol: "herramienta", nombre: call.nombre, llamadaId: call.id, resultado: effect.result });
        yield { type: "tool", name: call.nombre, result: effect.result, state, progress: effect.progress };
        operations++;
      }
      const progress = calculateBriefProgress(state.brief);
      system = `${ADVISOR_SYSTEM_PROMPT}\n\nEstado estructurado actualizado: ${JSON.stringify(briefForModel(state))}\nAvance calculado por servidor: ${progress.completed}/${progress.required}.`;
      if (operations >= 8) throw new Error("advisor_tool_limit");
    }
  } catch {
    const latest = parseEventBriefState(await deps.readBrief());
    const code = controller.signal.aborted ? (deps.signal?.aborted ? "CANCELLED" : "TIMEOUT") : "PROVIDER_FAILURE";
    yield {
      type: "error", code,
      message: latest.refused.contact || latest.refused.address
        ? "Se conservaron los datos guardados. La aprobación sigue sin estar disponible porque se rechazó el uso de contacto o dirección. Puedes reintentar cuando quieras."
        : "Se conservaron los datos guardados. La respuesta se interrumpió; puedes reintentar este turno.",
      state: latest, progress: calculateBriefProgress(latest.brief), retryAvailable: true,
    };
    return;
  } finally {
    clearTimeout(timeout);
    deps.signal?.removeEventListener("abort", abort);
  }
}
