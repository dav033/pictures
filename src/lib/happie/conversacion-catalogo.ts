import { z } from "zod";
import { HAPPIE_V2, HappieConversationRequestV2Schema, HappieConversationResponseV2Schema, HappieRecommendationResponseV2Schema, catalogOptions, type HappieConversationStateV2 } from "@/lib/ia/contracts/happie-v2";
import type { Extraccion, EstadoConversacion } from "./conversacion-webhook";
import type { ContextoTelemetriaIA } from "@/lib/ia/nucleo/telemetria-llamadas";
import { generarRecomendacionCatalogo } from "./recomendar-catalogo";

type Input = z.infer<typeof HappieConversationRequestV2Schema>;
type Extract = (message: string, state: EstadoConversacion, signal?: AbortSignal, telemetry?: ContextoTelemetriaIA) => Promise<Extraccion>;

const SERVICE_LABELS_ES = { comida: "comida", bebida: "bebidas", decoracion: "decoración", fotografia: "fotografía" } as const;

function normalizeChatText(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function eventQuestion(state: HappieConversationStateV2): string {
  const requestedService = state.serviciosDeseados?.[0] ?? state.servicios.map((item) => SERVICE_LABELS_ES[item]).join(", ");
  return requestedService
    ? `¿Buscas ${requestedService} para una celebración, una reunión o una comida informal? Así te recomiendo opciones que encajen.`
    : "¿Qué tienes en mente? Puede ser una celebración, una reunión informal o la contratación de un servicio concreto.";
}

function inferContextualEvent(message: string, previous: HappieConversationStateV2): string | undefined {
  const hasRequestedService = (previous.serviciosDeseados?.length ?? 0) > 0 || previous.servicios.length > 0;
  if (previous.tipoEvento || previous.fase !== "descubrimiento" || !hasRequestedService) return undefined;

  const normalized = normalizeChatText(message);
  if (/\b(?:comida|almuerzo|cena)\s+(?:informal|casual)\b/.test(normalized)) return "Comida informal";
  return undefined;
}

function inferGuestCount(message: string, previous: HappieConversationStateV2): number | undefined {
  if (!previous.tipoEvento || previous.invitados || previous.fase !== "descubrimiento") return undefined;

  const normalized = normalizeChatText(message).replace(/\s+/g, " ");
  const match = normalized.match(/^(?:(?:somos|seremos|vamos a ser|van a ser|para|habra)\s+)?(\d+)(?:\s+(?:personas?|invitados?|asistentes))?[.!]?$/);
  const count = Number(match?.[1]);
  return Number.isSafeInteger(count) && count > 0 ? count : undefined;
}

export async function procesarTurnoCatalogo(input: Input, request: Request, extract: Extract, recommend = generarRecomendacionCatalogo): Promise<{ status: number; body: unknown }> {
  const previous: HappieConversationStateV2 = input.estado ?? { fase: "descubrimiento", servicios: [], preferencias: [] };
  const initialMode = input.modo ?? previous.modo ?? "mixto";
  try { catalogOptions({ modo: initialMode, cantidad: input.cantidad ?? (initialMode === previous.modo ? previous.cantidad : undefined) }); }
  catch { return { status: 400, body: { schema_version: HAPPIE_V2, error: "Las cantidades no coinciden con el modo solicitado." } }; }
  const extractionState = { ...previous, modo: initialMode };
  const extracted = await extract(input.mensaje, extractionState, request.signal, {
    requestId: crypto.randomUUID(), correlationId: request.headers.get("x-correlation-id") ?? crypto.randomUUID(),
    superficie: "/api/happie/webhook/chat",
  });
  request.signal.throwIfAborted();
  if (extracted.respuestaConversacional) {
    // A social or unrelated turn never changes event facts, advances the phase or buys recommendations.
    const preserved = { ...previous, ...catalogOptions({ modo: initialMode,
      cantidad: input.cantidad ?? (initialMode === previous.modo ? previous.cantidad : undefined) }),
      ...(input.city ? { city: input.city } : {}) };
    return { status: 200, body: HappieConversationResponseV2Schema.parse({
      schema_version: HAPPIE_V2, tipo: "pregunta", mensaje: extracted.respuestaConversacional, estado: preserved,
    }) };
  }
  const mode = input.modo ?? extracted.modo ?? initialMode;
  // A changed mode resets previous counts unless the caller explicitly supplies new ones.
  const counts = input.cantidad ?? extracted.cantidad ?? (mode === previous.modo ? previous.cantidad : undefined);
  let options: ReturnType<typeof catalogOptions>;
  try { options = catalogOptions({ modo: mode, cantidad: counts }); }
  catch { return { status: 400, body: { schema_version: HAPPIE_V2, error: "Pide de 0 a 20 resultados por tipo y cantidades compatibles con el modo." } }; }
  const confirming = previous.fase === "confirmacion" && extracted.confirmacion === "si";
  const contextualEvent = inferContextualEvent(input.mensaje, previous);
  const guestCount = inferGuestCount(input.mensaje, previous);
  const mergeDetails = !confirming && (!extracted.respondioDetalles || contextualEvent !== undefined || guestCount !== undefined);
  const extractedPreferences = contextualEvent
    ? extracted.preferencias.filter((preference) => normalizeChatText(preference) !== normalizeChatText(contextualEvent))
    : extracted.preferencias;
  const capturedDetails = confirming
    ? { servicios: previous.servicios, preferencias: previous.preferencias, serviciosDeseados: previous.serviciosDeseados }
    : mergeDetails
      ? {
        servicios: [...new Set([...previous.servicios, ...extracted.servicios])],
        preferencias: [...new Set([...previous.preferencias, ...extractedPreferences])],
        serviciosDeseados: [...new Set([...(previous.serviciosDeseados ?? []), ...(extracted.serviciosDeseados ?? [])])],
      }
      : { servicios: extracted.servicios, preferencias: extractedPreferences, serviciosDeseados: extracted.serviciosDeseados ?? previous.serviciosDeseados };
  let state: HappieConversationStateV2 = {
    ...previous, ...options,
    city: input.city ?? extracted.city ?? previous.city,
    tipoEvento: extracted.tipoEvento ?? contextualEvent ?? previous.tipoEvento,
    invitados: guestCount ?? extracted.invitados ?? previous.invitados,
    presupuesto: extracted.presupuesto ?? previous.presupuesto,
    ...capturedDetails,
  };
  const question = (message: string, fase: HappieConversationStateV2["fase"]) => ({ status: 200,
    body: HappieConversationResponseV2Schema.parse({ schema_version: HAPPIE_V2, tipo: "pregunta", mensaje: extracted.acuse ? `${extracted.acuse} ${message}` : message, estado: { ...state, fase } }) });
  if (!state.tipoEvento) return question(eventQuestion(state), "descubrimiento");
  if (!state.invitados) return question("¿Para cuántas personas será el evento?", "descubrimiento");
  if (!state.presupuesto) return question("¿Qué presupuesto tienes en pesos colombianos?", "descubrimiento");
  if (!state.city) return question("¿En qué ciudad será el evento?", "descubrimiento");

  // Changes after the summary always require a new confirmation before spending on recommendations.
  const changed = previous.modo !== state.modo || JSON.stringify(previous.cantidad) !== JSON.stringify(state.cantidad)
    || previous.city !== state.city || previous.tipoEvento !== state.tipoEvento || previous.invitados !== state.invitados
    || previous.presupuesto !== state.presupuesto || (extracted.serviciosDeseados?.length && JSON.stringify(extracted.serviciosDeseados) !== JSON.stringify(previous.serviciosDeseados));
  if (confirming && !changed) {
    const result = await recommend(request, {
      schema_version: HAPPIE_V2, ...options, city: state.city, tipoEvento: state.tipoEvento,
      invitados: state.invitados, presupuesto: state.presupuesto,
      preferencias: [...new Set([...state.preferencias, ...(state.serviciosDeseados ?? [])])],
      comida: state.servicios.includes("comida"), bebida: state.servicios.includes("bebida"),
      decoracion: state.servicios.includes("decoracion"), fotografia: state.servicios.includes("fotografia"),
    });
    if (result.status !== 200) return result;
    const body = HappieRecommendationResponseV2Schema.parse(result.body);
    state = { ...state, fase: "finalizado" };
    return { status: 200, body: HappieConversationResponseV2Schema.parse({ ...body, tipo: "recomendaciones", mensaje: body.resumen, estado: state }) };
  }
  const hasCapturedDetails = state.servicios.length > 0 || state.preferencias.length > 0 || (state.serviciosDeseados?.length ?? 0) > 0;
  if ((previous.fase === "descubrimiento" || previous.fase === "detalles") && !extracted.respondioDetalles && !hasCapturedDetails) {
    return question("¿Qué servicios concretos o estilo buscas? Puedes pedir animación, magia, DJ, comida, decoración u otros; también puedes decir que no tienes preferencias.", "detalles");
  }
  const requested = [options.cantidad.servicios ? `${options.cantidad.servicios} servicios` : "", options.cantidad.paquetes ? `${options.cantidad.paquetes} paquetes` : ""].filter(Boolean).join(" y ");
  const fullDetails = [...new Set([...(state.serviciosDeseados ?? state.servicios), ...state.preferencias])].join(", ");
  const details = fullDetails.length > 1500 ? `${fullDetails.slice(0, 1500)}…` : fullDetails;
  return question(`Buscaré hasta ${requested} para ${state.tipoEvento}, ${state.invitados} personas en ${state.city}, presupuesto ${state.presupuesto.toLocaleString("es-CO")} COP.${details ? ` Preferencias: ${details}.` : ""} Los importes estimados excluyen IVA, comisión y domicilio. ¿Busco las opciones?`, "confirmacion");
}
