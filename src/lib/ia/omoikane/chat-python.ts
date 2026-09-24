import "server-only";
import { ApiError, ThinkingLevel } from "@google/genai";
import { conReintento, type ImagenAdjunta } from "@sempertex/agente-core";
import {
  categorizarError,
  extraerUsoGemini,
  historialAContents,
  nivelPensamientoTelemetria,
} from "@sempertex/agente-core/gemini";
import { DEADLINE_MAX_MS } from "@/lib/ia/contracts/operational-v1";
import { errorIADeTransportePython } from "@/lib/ia/nucleo/error-ia-python";
import {
  isPythonAdapterError,
  llamarPythonChatTurnStream,
  type PythonChatTurnStreamEvent,
  type PythonChatTurnStreamInput,
} from "@/lib/ia/nucleo/python-adapter";
import { ErrorIA } from "@/lib/ia/nucleo/tipos";
import type { ChatPort, FragmentoChat, PeticionChat, TurnoChat } from "@/lib/ia/nucleo/tipos";

type EventoError = Extract<PythonChatTurnStreamEvent, { type: "error" }>;
type EventoFin = Extract<PythonChatTurnStreamEvent, { type: "end" }>;

/** Same default and env var as `crearChatGemini`, so both paths run the same model. */
const MODELO_POR_DEFECTO = process.env.GEMINI_CHAT_MODEL ?? "gemini-3.6-flash";

function nivelParaPython(nivel: ThinkingLevel | undefined): PythonChatTurnStreamInput["thinkingLevel"] {
  if (nivel === ThinkingLevel.LOW) return "low";
  if (nivel === ThinkingLevel.MINIMAL) return "minimal";
  return undefined;
}

/**
 * A provider failure reaches TypeScript with its original status and message,
 * and goes through the same `categorizarError` the direct adapter uses -- so
 * which failures are retryable, filtered or an image rejection keeps a single
 * owner instead of a Python copy of the same substring rules.
 */
export function errorIADeEvento(evento: EventoError, conImagenes: boolean): ErrorIA {
  if (evento.code === "chat_turn_provider_error") {
    const mensaje = evento.provider_message ?? "El proveedor devolvió un error sin mensaje.";
    const causa = evento.provider_status ? new ApiError({ message: mensaje, status: evento.provider_status }) : new Error(mensaje);
    return categorizarError(causa, conImagenes);
  }
  if (evento.code === "deadline_exceeded") {
    return new ErrorIA("timeout", "gemini", "El turno del chat agotó su deadline en el servicio Python.", true);
  }
  return new ErrorIA("desconocido", "gemini", `El turno del chat falló en el servicio Python (${evento.code}).`, true);
}

/** Pre-stream rejections the Python route returns as plain HTTP errors, plus transport failures. */
export function errorIADeApertura(error: unknown): ErrorIA {
  if (isPythonAdapterError(error)) {
    if (error.domainCode === "chat_turn_unavailable") {
      return new ErrorIA("sin_llave", "gemini", "El servicio Python no tiene GEMINI_API_KEY configurada.", false);
    }
    if (error.domainCode === "chat_turn_invalid_contents" || error.domainCode === "chat_turn_invalid_tools") {
      return new ErrorIA("desconocido", "gemini", `El servicio Python rechazó el turno (${error.domainCode}).`, false);
    }
  }
  return errorIADeTransportePython(error);
}

export function fragmentoFinDeEvento(evento: EventoFin, bytesImagenEnviados: number): FragmentoChat {
  return {
    tipo: "fin",
    texto: evento.text,
    // Same shape `extraerLlamadas` gives on the direct path: the signature
    // travels back in `meta` so `historialAContents` re-sends it next turn.
    llamadas: evento.tool_calls.map((llamada) => ({
      id: llamada.id ?? undefined,
      nombre: llamada.name,
      args: llamada.args,
      meta: llamada.thought_signature ? { thoughtSignature: llamada.thought_signature } : undefined,
    })),
    uso: extraerUsoGemini(evento.usage_metadata),
    modelo: evento.model,
    bytesImagenEnviados,
    ...(evento.finish_reason ? { finishReason: evento.finish_reason } : {}),
    ...(evento.block_reason ? { blockReason: evento.block_reason } : {}),
  };
}

/**
 * `ChatPort` for Omoikane whose provider call runs in Python
 * (services/ai-api/app/omoikane/turno_stream.py). Everything else is the
 * direct adapter's own code: `historialAContents` builds the `contents` (so
 * the per-request image dedupe and `thoughtSignature` round trip are
 * unchanged), and the tool loop, the SSE and the prompt never see which path
 * ran. Created once per request, like `crearChatGemini`.
 */
export function crearChatGeminiPython(opts: {
  requestId: string;
  correlationId: string;
  modelo?: string;
  thinkingLevel?: ThinkingLevel;
}): ChatPort {
  const modelo = opts.modelo ?? MODELO_POR_DEFECTO;
  const thinkingLevel = nivelParaPython(opts.thinkingLevel);
  const imagenesEnviadas = new WeakSet<ImagenAdjunta>();

  async function* turnoStream(p: PeticionChat): AsyncGenerator<FragmentoChat, void, undefined> {
    const { contents, bytesImagenEnviados } = historialAContents(p.historial, imagenesEnviadas);
    const conImagenes = bytesImagenEnviados > 0;
    const peticion: PythonChatTurnStreamInput = {
      systemInstruction: p.sistema,
      contents,
      tools: p.herramientas.map((h) => ({ name: h.nombre, description: h.descripcion, parametersJsonSchema: h.esquema })),
      ...(thinkingLevel ? { thinkingLevel } : {}),
      ...(p.temperatura !== undefined ? { temperature: p.temperatura } : {}),
      ...(p.maxTokens !== undefined ? { maxOutputTokens: p.maxTokens } : {}),
      model: modelo,
      requestId: opts.requestId,
      correlationId: opts.correlationId,
      // The route's own deadline signal (p.signal) is what bounds the turn;
      // this only has to be long enough not to cut it first.
      deadlineMs: DEADLINE_MAX_MS,
      parentSignal: p.signal,
    };

    // Retry only until the first event, the same window `conReintento` covers
    // on the direct path: an "open"-phase error means the provider produced
    // nothing yet. After that, a failure is never retried -- it would repeat
    // text the customer already saw.
    const abrir = async () => {
      const eventos = llamarPythonChatTurnStream(peticion);
      let primero: IteratorResult<PythonChatTurnStreamEvent, void>;
      try {
        primero = await eventos.next();
      } catch (error) {
        throw errorIADeApertura(error);
      }
      if (primero.done) throw new ErrorIA("desconocido", "gemini", "El servicio Python cerró el turno sin eventos.", true);
      if (primero.value.type === "error" && primero.value.phase === "open") {
        await eventos.return(undefined);
        throw errorIADeEvento(primero.value, conImagenes);
      }
      return { eventos, primero: primero.value };
    };
    const { eventos, primero } = await conReintento(abrir, {
      esReintentable: (error) => (error instanceof ErrorIA ? error.reintentable : false),
      signal: p.signal,
    });

    try {
      let evento: PythonChatTurnStreamEvent = primero;
      while (true) {
        if (evento.type === "text") {
          yield { tipo: "texto", delta: evento.delta };
        } else if (evento.type === "end") {
          yield fragmentoFinDeEvento(evento, bytesImagenEnviados);
          return;
        } else {
          throw errorIADeEvento(evento, conImagenes);
        }
        let siguiente: IteratorResult<PythonChatTurnStreamEvent, void>;
        try {
          siguiente = await eventos.next();
        } catch (error) {
          throw errorIADeTransportePython(error);
        }
        if (siguiente.done) throw new ErrorIA("desconocido", "gemini", "El servicio Python cerró el turno sin evento final.", true);
        evento = siguiente.value;
      }
    } finally {
      // The tool loop returning early (client cancelled) lands here too:
      // closing the adapter's generator cancels the body reader, and Python
      // closes the provider stream on the disconnect.
      await eventos.return(undefined);
    }
  }

  return {
    id: "gemini",
    modelo,
    thinkingLevel: nivelPensamientoTelemetria(opts.thinkingLevel),

    async turno(p: PeticionChat): Promise<TurnoChat> {
      for await (const fragmento of turnoStream(p)) {
        if (fragmento.tipo === "fin") {
          const { tipo, ...turno } = fragmento;
          void tipo;
          return turno;
        }
      }
      throw new ErrorIA("desconocido", "gemini", "El servicio Python cerró el turno sin evento final.", true);
    },

    turnoStream,
  };
}
