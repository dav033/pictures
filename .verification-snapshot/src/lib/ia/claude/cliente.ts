import { ErrorApiAnthropic } from "./errores";
import { RespuestaSchema } from "./esquemas";
import { leerEventosSse } from "./sse";
import type { CuerpoMensajes, EventoFlujoAnthropic, RespuestaAnthropic } from "./tipos";

/**
 * Transporte HTTP de la API de mensajes de Anthropic con `fetch` (sin SDK). Imita la forma del SDK
 * (`cliente.messages.create` / `cliente.messages.stream`) para que la guardia de proveedores
 * (scripts/test/test-guardia-proveedores-ia.ts) detecte cada llamada con el mismo patrón que detectaría el SDK.
 * Nunca se llama crudo: lo usan `crearChatClaude` (auditado por `envolverChatPort`) y `getClaudeClient`
 * (auditado por `envolverClienteAnthropic`).
 */

export const URL_MENSAJES = "https://api.anthropic.com/v1/messages";
const VERSION_API = "2023-06-01";

export type OpcionesLlamadaAnthropic = { signal?: AbortSignal };

export interface ClienteAnthropic {
  readonly messages: {
    create(cuerpo: CuerpoMensajes, opciones?: OpcionesLlamadaAnthropic): Promise<RespuestaAnthropic>;
    /** Resuelve cuando la API aceptó la petición (estado HTTP ya revisado); los eventos llegan al iterar. */
    stream(cuerpo: CuerpoMensajes, opciones?: OpcionesLlamadaAnthropic): Promise<AsyncIterable<EventoFlujoAnthropic>>;
  };
}

async function errorDeRespuesta(respuesta: Response): Promise<ErrorApiAnthropic> {
  const texto = await respuesta.text().catch(() => "");
  try {
    const cuerpo: unknown = JSON.parse(texto);
    const error = typeof cuerpo === "object" && cuerpo !== null && "error" in cuerpo ? (cuerpo as { error: unknown }).error : undefined;
    if (typeof error === "object" && error !== null) {
      const { type, message } = error as { type?: unknown; message?: unknown };
      return new ErrorApiAnthropic(respuesta.status, typeof type === "string" ? type : "error", typeof message === "string" ? message : texto);
    }
  } catch {
    // Cuerpo no JSON (proxy, HTML): se informa el texto recortado.
  }
  return new ErrorApiAnthropic(respuesta.status, "error", texto || respuesta.statusText);
}

export function crearClienteAnthropic(opciones: { apiKey: string; fetch?: typeof fetch }): ClienteAnthropic {
  const hacerFetch = opciones.fetch ?? fetch;

  async function enviar(cuerpo: CuerpoMensajes & { stream?: true }, signal: AbortSignal | undefined): Promise<Response> {
    const respuesta = await hacerFetch(URL_MENSAJES, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": opciones.apiKey, "anthropic-version": VERSION_API },
      body: JSON.stringify(cuerpo),
      signal,
    });
    if (!respuesta.ok) throw await errorDeRespuesta(respuesta);
    return respuesta;
  }

  return {
    messages: {
      async create(cuerpo, llamada) {
        const respuesta = await enviar(cuerpo, llamada?.signal);
        return RespuestaSchema.parse(await respuesta.json());
      },
      async stream(cuerpo, llamada) {
        const respuesta = await enviar({ ...cuerpo, stream: true }, llamada?.signal);
        if (!respuesta.body) throw new ErrorApiAnthropic(respuesta.status, "sin_cuerpo", "la respuesta en flujo llegó sin cuerpo");
        return leerEventosSse(respuesta.body);
      },
    },
  };
}
