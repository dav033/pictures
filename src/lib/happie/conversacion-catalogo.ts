import { z } from "zod";
import { HAPPIE_V2, HappieConversationRequestV2Schema, HappieConversationResponseV2Schema, HappieRecommendationResponseV2Schema, catalogOptions, type HappieConversationStateV2 } from "@/lib/ia/contracts/happie-v2";
import type { Extraccion, EstadoConversacion } from "./conversacion-webhook";
import type { ContextoTelemetriaIA } from "@/lib/ia/nucleo/telemetria-llamadas";
import { generarRecomendacionCatalogo } from "./recomendar-catalogo";

type Input = z.infer<typeof HappieConversationRequestV2Schema>;
type Extract = (message: string, state: EstadoConversacion, signal?: AbortSignal, telemetry?: ContextoTelemetriaIA) => Promise<Extraccion>;

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
  const mode = input.modo ?? extracted.modo ?? initialMode;
  // A changed mode resets previous counts unless the caller explicitly supplies new ones.
  const counts = input.cantidad ?? extracted.cantidad ?? (mode === previous.modo ? previous.cantidad : undefined);
  let options: ReturnType<typeof catalogOptions>;
  try { options = catalogOptions({ modo: mode, cantidad: counts }); }
  catch { return { status: 400, body: { schema_version: HAPPIE_V2, error: "Pide de 0 a 20 resultados por tipo y cantidades compatibles con el modo." } }; }
  const confirming = previous.fase === "confirmacion" && extracted.confirmacion === "si";
  let state: HappieConversationStateV2 = {
    ...previous, ...options,
    city: input.city ?? extracted.city ?? previous.city,
    tipoEvento: extracted.tipoEvento ?? previous.tipoEvento,
    invitados: extracted.invitados ?? previous.invitados,
    presupuesto: extracted.presupuesto ?? previous.presupuesto,
    servicios: confirming ? previous.servicios : extracted.servicios,
    preferencias: confirming ? previous.preferencias : extracted.preferencias,
    serviciosDeseados: confirming ? previous.serviciosDeseados : extracted.serviciosDeseados ?? previous.serviciosDeseados,
  };
  const question = (message: string, fase: HappieConversationStateV2["fase"]) => ({ status: 200,
    body: HappieConversationResponseV2Schema.parse({ schema_version: HAPPIE_V2, tipo: "pregunta", mensaje: message, estado: { ...state, fase } }) });
  if (!state.tipoEvento) return question("¿Qué evento quieres celebrar y qué servicios estás buscando?", "descubrimiento");
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
  if (previous.fase === "descubrimiento" && !extracted.respondioDetalles) {
    return question("¿Qué servicios concretos o estilo buscas? Puedes pedir animación, magia, DJ, comida, decoración u otros; también puedes decir que no tienes preferencias.", "detalles");
  }
  const requested = [options.cantidad.servicios ? `${options.cantidad.servicios} servicios` : "", options.cantidad.paquetes ? `${options.cantidad.paquetes} paquetes` : ""].filter(Boolean).join(" y ");
  const fullDetails = [...new Set([...(state.serviciosDeseados ?? state.servicios), ...state.preferencias])].join(", ");
  const details = fullDetails.length > 1500 ? `${fullDetails.slice(0, 1500)}…` : fullDetails;
  return question(`Buscaré hasta ${requested} para ${state.tipoEvento}, ${state.invitados} personas en ${state.city}, presupuesto ${state.presupuesto.toLocaleString("es-CO")} COP.${details ? ` Preferencias: ${details}.` : ""} Los importes estimados excluyen IVA, comisión y domicilio. ¿Busco las opciones?`, "confirmacion");
}
