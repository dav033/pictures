import { timingSafeEqual } from "node:crypto";
import { CuerpoSolicitudSchema, generarRecomendacion } from "./generar-recomendacion";
import { ejecutarWebhook } from "./webhook-control";
import {
  HAPPIE_CONTRACT_VERSION,
  HappieConversationResponseV1Schema,
  HappieErrorV1Schema,
} from "@/lib/ia/contracts/happie-v1";

const LONGITUD_MINIMA_SECRETO = 32;

function clavesIguales(recibida: string, esperada: string): boolean {
  const recibidaBytes = Buffer.from(recibida, "utf8");
  const esperadaBytes = Buffer.from(esperada, "utf8");
  return recibidaBytes.length === esperadaBytes.length && timingSafeEqual(recibidaBytes, esperadaBytes);
}

export function respuestaWebhook(body: unknown, status = 200): Response {
  let normalizado = body;
  if (status >= 400) {
    const recibido = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
      ? body.error
      : "No se pudo procesar la solicitud.";
    const error = /^No se pudo procesar la conversación:/.test(recibido)
      ? "No se pudo procesar la conversación."
      : recibido;
    normalizado = HappieErrorV1Schema.parse({ schema_version: HAPPIE_CONTRACT_VERSION, error });
  } else if (typeof body === "object" && body !== null && "tipo" in body) {
    normalizado = HappieConversationResponseV1Schema.parse({
      schema_version: HAPPIE_CONTRACT_VERSION,
      ...body,
    });
  }
  return Response.json(normalizado, { status, headers: { "Cache-Control": "no-store" } });
}

/** Devuelve una respuesta de error o `null` cuando la llamada está autorizada. */
export function autenticarWebhook(request: Request): Response | null {
  const esperada = process.env.HAPPIE_WEBHOOK_API_KEY?.trim();
  if (!esperada || Buffer.byteLength(esperada, "utf8") < LONGITUD_MINIMA_SECRETO) {
    return respuestaWebhook({ error: "Webhook no configurado en el servidor." }, 503);
  }

  const recibida = request.headers.get("x-api-key") ?? "";
  if (!clavesIguales(recibida, esperada)) {
    return respuestaWebhook({ error: "API key inválida o ausente." }, 401);
  }

  return null;
}

/**
 * Versión server-to-server (webhook) de la recomendación: sin CORS ni
 * preflight `OPTIONS` — no aplican porque no la llama JS de navegador, sino
 * el backend de chat de Happia directo. Usa su propio secreto
 * (`HAPPIE_WEBHOOK_API_KEY`), separado del que usan `recommend-packages` /
 * `recommend-package`, porque ese otro viaja en JS de cliente y por tanto
 * es visible — este no.
 */
export async function manejarRecomendacionWebhook(
  request: Request,
  maxRecomendaciones: number,
): Promise<Response> {
  return ejecutarWebhook(request, `recommend-${maxRecomendaciones}`, autenticarWebhook(request),
    CuerpoSolicitudSchema, (bounded) => generarRecomendacion(bounded, maxRecomendaciones));
}
