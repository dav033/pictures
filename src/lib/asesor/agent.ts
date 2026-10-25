import type { ChatPort, FragmentoChat, LlamadaHerramienta, Mensaje } from "@/lib/ia/nucleo/tipos";
import type { StoredMessage } from "./repository";
import { ADVISOR_SYSTEM_PROMPT } from "./prompts/base";
import { calculateBriefProgress, calculateStateProgress } from "./progress";
import { applyAdvisorTool, ADVISOR_TOOLS, applyCustomerConsentToState, type BriefMutator } from "./tools";
import { parseEventBriefState, type EventBriefState } from "./contracts";
import { prepareAdvisorPhoto } from "./photos";
import type { PhotoPreference } from "./repository";
import { applyQuickReplyToState } from "./quick-replies";
import type { HappiaCatalogueResult } from "./catalogue";
import { catalogueForModel } from "./catalogue-context";

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
  savePhotoFeedback?: (attachmentId: string, confirmed: boolean, preference: PhotoPreference) => Promise<boolean>;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Reads the Happia catalogue once per turn: the model may only offer what it lists. Absent (tests), nothing is offered. */
  loadCatalogue?: () => Promise<HappiaCatalogueResult>;
  /** Clock for the date given to the model; tests pin it. */
  now?: () => Date;
};

async function toHistory(messages: StoredMessage[]): Promise<Mensaje[]> {
  const lastUser = messages.findLast((message) => message.role === "user");
  const history: Mensaje[] = [];
  for (const message of messages) {
    if (message.role === "assistant") { history.push({ rol: "asistente", texto: message.content }); continue; }
    if (message.role !== "user") continue;
    const photoNotes = message.attachments.map((photo) => `Foto ${photo.id}: ${photo.kind === "venue" ? "lugar" : "inspiración"}; confirmación ${photo.confirmed === null ? "pendiente" : photo.confirmed ? "sí" : "no"}; preferencia ${photo.preference}.`);
    // A voice note reaches the model as its transcript; flag it so the advisor tolerates transcription slips.
    const spoken = message.inputMode === "voice" ? `(Nota de voz transcrita; puede traer errores de transcripción) ${message.content}` : message.content;
    const content = [spoken, ...photoNotes].filter(Boolean).join("\n");
    if (message.id !== lastUser?.id || message.attachments.length === 0) { history.push({ rol: "usuario", texto: content }); continue; }
    const images = [];
    for (const photo of message.attachments) {
      try {
        const prepared = await prepareAdvisorPhoto(photo.mimeType, photo.data);
        images.push({ id: photo.id, mime: "image/jpeg", base64: prepared.derivative.toString("base64"), descripcion: photo.kind === "venue" ? "Foto del lugar del evento." : "Foto de inspiración." });
      } catch { /* Stored uploads are validated; skip a legacy attachment that cannot be decoded. */ }
    }
    history.push({ rol: "usuario", texto: `${content}\nAnaliza visualmente cada foto disponible. En tu primera respuesta, describe brevemente lo que observas y pregunta al cliente si confirma esa lectura y qué le gusta o no le gusta de cada foto.`, ...(images.length ? { imagenes: images } : {}) });
  }
  return history;
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

async function* finishAdvisorTurn(deps: AdvisorTurnDependencies, text: string): AsyncGenerator<AdvisorEvent> {
  const assistantId = `${deps.turnId}:assistant`;
  await deps.appendAssistant(assistantId, text);
  const state = parseEventBriefState(await deps.readBrief());
  yield { type: "final", state, progress: calculateStateProgress(state), messageId: assistantId, retryAvailable: false };
}

/** Provider text is provisional until the stable assistant ID commits; tool receipts make retry effects idempotent. */
/** What the advisor may ask on each server-computed step; the contact is always the last thing asked. */
const STEP_GUIDANCE: Record<ReturnType<typeof calculateStateProgress>["step"], string> = {
  event: "datos del evento. Pregunta solo por los datos del evento pendientes; no pidas hora ni datos de contacto todavía.",
  preferences: "gustos. Pregunta por temática, colores, estilo o lo que le gusta y propón ideas concretas que encajen; si no tiene preferencias, guarda likes con eso. No pidas hora ni contacto todavía.",
  start_time: "hora. La pantalla muestra ahora el selector de hora de inicio; invita al cliente a elegirla ahí. No pidas datos de contacto todavía.",
  proposal: "propuesta. Busca en Happia con propose_standard_package y presenta el paquete que encaja con su precio estimado; si no hay paquete, dilo y ofrece armarlo solo con servicios del catálogo de Happia de su ciudad; preséntalo como precio de referencia del catálogo, no como cotización: el decorador la confirma con el brief; si el lugar está por definir, recuerda que se lo pasamos a Happia para ayudarle a buscarlo, sin prometer lugares. No pidas datos de contacto todavía.",
  contact: "contacto. Ahora sí, como último paso, pide el nombre del contacto, su teléfono o correo y su autorización.",
  summary: "resumen. Todos los datos obligatorios están; sigue el flujo del resumen.",
};

/** The model has no clock: without today's date it resolves "10 de diciembre" to a past year. */
export function todayContext(now: Date): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return `Fecha de hoy en Colombia: ${today}. Si el cliente da día y mes sin año, guarda la próxima fecha futura con ese día y mes; nunca una fecha pasada.`;
}

/** The preferences step asks, after the taste, what matters most and then the budget; the screen shows chips for both. */
const ASK_GUIDANCE: Record<NonNullable<ReturnType<typeof calculateStateProgress>["ask"]>, string> = {
  priority: " Ahora pregunta qué es lo más importante para quien organiza: impresionar, personalizarla, algo sencillo o el mejor precio (la pantalla muestra esas opciones) y guarda organiserPriority. Después pregunta si tiene en mente alguna marca o proveedor (brandRequests); si no, sigue.",
  budget: " Ahora pregunta cuánto le gustaría invertir en la decoración (la pantalla muestra rangos y «Prefiero no decir»). Guarda budget si da un monto, budgetRange si da un rango, o budgetUndisclosed=true si prefiere no decirlo. Aclara que el presupuesto no se comparte con los decoradores.",
};

export async function* runAdvisorTurn(deps: AdvisorTurnDependencies): AsyncGenerator<AdvisorEvent> {
  const current = deps.messages.at(-1);
  if (!current || current.role !== "user") throw new Error("advisor_turn_requires_user_message");
  const controller = new AbortController();
  const abort = () => controller.abort();
  deps.signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => controller.abort(), deps.timeoutMs ?? 45_000);
  const consentWrite = await deps.mutateBrief((raw) => {
    const state = applyCustomerConsentToState(parseEventBriefState(raw), current.content);
    applyQuickReplyToState(state, current.content, deps.turnId);
    return state;
  });
  let state = parseEventBriefState(consentWrite.state);
  // Do not send prior turns to tools; they are contextual input only. The model has no access to other conversations.
  const unavailable: HappiaCatalogueResult = { status: "unavailable", reason: "not_configured" };
  const catalogue = deps.loadCatalogue ? await deps.loadCatalogue().catch((): HappiaCatalogueResult => ({ status: "unavailable", reason: "request_failed" })) : unavailable;
  const history = await toHistory(deps.messages);
  const photoIds = new Set(deps.messages.flatMap((message) => message.attachments.map((photo) => photo.id)));
  const modelContext = (currentState: EventBriefState) => {
    const progress = calculateStateProgress(currentState);
    return `${ADVISOR_SYSTEM_PROMPT}\n\nEstado estructurado del evento (fuente de verdad): ${JSON.stringify(briefForModel(currentState))}\nResumen vigente: ${currentState.summary ? JSON.stringify(currentState.summary) : "ninguno"}\nSiguiente versión de resumen: ${currentState.summarySequence + 1}\nAvance calculado por servidor: ${progress.completed}/${progress.required}.\nCampos obligatorios pendientes: ${progress.missing.join(", ") || "ninguno"}.\nPaso de la conversación: ${STEP_GUIDANCE[progress.step]}${progress.ask ? ASK_GUIDANCE[progress.ask] : ""}\n${todayContext(deps.now?.() ?? new Date())}\n${catalogueForModel(catalogue, currentState.brief.city)}`;
  };
  let system = modelContext(state);
  let accumulated = "";
  let operations = 0;
  // The server owns summary regeneration: a complete brief without a summary (first completion or a correction that
  // invalidated it) gets one without depending on a further model round, which can fail or omit the tool call.
  const customerText = current.content;
  // Each attempt needs its own operation id: a reused id replays the stored receipt and skips regeneration when the
  // model edits the brief again after an earlier automatic summary in the same turn.
  let summaryAttempts = 0;
  async function* ensureSummary(): AsyncGenerator<AdvisorEvent> {
    if (state.summary || !calculateStateProgress(state).complete) return;
    const effect = await applyAdvisorTool({
      call: { nombre: "propose_summary", args: {} }, operationId: `${deps.turnId}:ready-summary:${summaryAttempts++}`,
      currentCustomerText: customerText, mutateBrief: deps.mutateBrief,
    });
    state = effect.state;
    yield { type: "tool", name: effect.name, result: effect.result, state, progress: effect.progress };
  }
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
        state = parseEventBriefState(await deps.readBrief());
        yield* ensureSummary();
        yield* finishAdvisorTurn(deps, accumulated);
        return;
      }
      if (turn.calls.length) history.push({ rol: "asistente", llamadas: turn.calls });
      else if (turn.text) history.push({ rol: "asistente", texto: turn.text });
      let completedSummaryAction = false;
      for (let index = 0; index < turn.calls.length; index++) {
        const call = turn.calls[index];
        const previousSummaryVersion = state.summary?.version;
        const effect = await applyAdvisorTool({ call, operationId: `${deps.turnId}:${operations}:${index}`, currentCustomerText: current.content, mutateBrief: deps.mutateBrief, photoIds, savePhotoFeedback: deps.savePhotoFeedback, turnId: deps.turnId, ...(deps.loadCatalogue ? { loadCatalogue: async () => catalogue } : {}) });
        state = effect.state;
        if ((call.nombre === "propose_summary" && state.summary && state.summary.version !== previousSummaryVersion)
          || (call.nombre === "approve_summary" && state.approval && state.approval.summaryVersion === state.summary?.version)) {
          completedSummaryAction = true;
        }
        history.push({ rol: "herramienta", nombre: call.nombre, llamadaId: call.id, resultado: effect.result });
        yield { type: "tool", name: call.nombre, result: effect.result, state, progress: effect.progress };
        operations++;
      }
      yield* ensureSummary();
      // The persisted summary is already rendered by the client. A further model call can time out after success.
      // Photo turns still need the model's first-look description before completion.
      if (completedSummaryAction && state.summary && current.attachments.length === 0) {
        if (!accumulated.trim()) {
          accumulated = state.approval ? "Tu resumen quedó aprobado." : "Aquí tienes el resumen actualizado. Revísalo antes de aprobarlo.";
          yield { type: "text", delta: accumulated };
        }
        yield* finishAdvisorTurn(deps, accumulated);
        return;
      }
      system = modelContext(state);
      if (operations >= 8) throw new Error("advisor_tool_limit");
    }
  } catch {
    try { state = parseEventBriefState(await deps.readBrief()); yield* ensureSummary(); } catch { /* saved facts are reported below */ }
    const latest = parseEventBriefState(await deps.readBrief());
    const code = controller.signal.aborted ? (deps.signal?.aborted ? "CANCELLED" : "TIMEOUT") : "PROVIDER_FAILURE";
    yield {
      type: "error", code,
      message: latest.refused.contact || latest.refused.address
        ? "Se conservaron los datos guardados. La aprobación sigue sin estar disponible porque se rechazó el uso de contacto o dirección. Puedes reintentar cuando quieras."
        : "Se conservaron los datos guardados. La respuesta se interrumpió; puedes reintentar este turno.",
      state: latest, progress: calculateStateProgress(latest), retryAvailable: true,
    };
    return;
  } finally {
    clearTimeout(timeout);
    deps.signal?.removeEventListener("abort", abort);
  }
}
