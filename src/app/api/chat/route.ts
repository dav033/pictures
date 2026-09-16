import { chatDe, resolverProveedor } from "@/lib/ia/registro";
import { ErrorIA } from "@/lib/ia/tipos";
import type { Imagen, Mensaje } from "@/lib/ia/tipos";
import { ejecutarConversacionStream } from "@/lib/ia/ejecutar";
import { limitarHistorialChat } from "@/lib/ia/historial-chat";
import { construirSistema } from "@/lib/ia/prompt-sistema";
import { parseNivelCreatividad } from "@/lib/ia/creatividad";
import { sugerenciaEscenaDelTurno } from "@/lib/ia/sugerencia-escena-chat";
import { ReferenceBlueprintV2Schema, type ReferenceBlueprintV2 } from "@/lib/ia/reference-blueprint";
import { RAG_ENABLED, RAG_FRANJAS_ENABLED } from "@/lib/ia/feature-flags";
import type { Brief, ChatMessage } from "@/lib/types";
import { LoraModeSlugSchema } from "@/lib/lora/schema";
import { resolveLoraModeDatasetAllowlist } from "@/lib/lora/mode-resolver";
import { causaCatalogoLora } from "@/lib/lora/catalogo-no-disponible";
import { RagUnavailableError } from "@/lib/rag/retrieval/search";
import {
  CHAT_SSE_CONTRACT_VERSION,
  ERROR_CONTRACT_VERSION,
  ChatSseEventV1Schema,
  parseChatRequestV1,
  type ChatRequestV1,
  type ErrorCodeV1,
} from "@/lib/ia/contracts/chat-v1";
import {
  crearDeadlineSignal,
  leerContextoOperativo,
  remainingDeadlineMs,
  sha256Body,
} from "@/lib/ia/contracts/operational-v1";

type LegacyBody = {
  messages: ChatMessage[];
  brief: Brief;
  /** Override de proveedor para esta petición — A/B en vivo desde la UI. */
  proveedor?: string;
  /** Foto real del espacio/venue adjunta al mensaje que se acaba de mandar. */
  fotoEspacio?: Imagen;
  /** Imágenes de inspiración de estilo adjuntas al mensaje que se acaba de mandar. */
  imagenesReferencia?: Imagen[];
  /** Blueprint ya analizado (panel de referencias) de las imágenes de este
   * turno — plan de integración de referencias visuales, R2. Solo se usa
   * como contexto de composición para el modelo; el emparejamiento con
   * catálogo real sigue siendo exclusivo de buscar_catalogo_rag (R3). */
  referenceBlueprint?: unknown;
  /** Modo LoRA activo; habilita el allowlist de productos de su dataset. */
  loraMode?: unknown;
};

type Body = ChatRequestV1 & Partial<LegacyBody>;

export const maxDuration = 75;

/** Evita que una llamada al proveedor sin respuesta deje un stream abierto para siempre. */
function conLimiteDeEspera<T>(promesa: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const temporizador = setTimeout(
      () => reject(new ErrorIA("timeout", "gemini", "El asistente tardó demasiado en responder. Intenta nuevamente.", true)),
      timeoutMs,
    );
    promesa.then(resolve, reject).finally(() => clearTimeout(temporizador));
  });
}

function statusDe(causa: ErrorIA["causa"]): number {
  switch (causa) {
    case "sin_llave":
      return 503;
    case "cuota":
      return 429;
    case "filtrado":
      return 422;
    case "timeout":
      return 504;
    default:
      return 502;
  }
}

function datosDeError(error: unknown): { error: string; causa?: string; proveedor?: string } {
  if (error instanceof ErrorIA) {
    const mensaje = error.causa === "sin_llave"
      ? "El proveedor de IA no está configurado en el servidor."
      : error.causa === "cuota"
        ? "El proveedor de IA está temporalmente sin cuota. Intenta nuevamente."
        : error.causa === "filtrado"
          ? "El proveedor no pudo procesar esta solicitud."
          : error.causa === "timeout"
            ? "El asistente tardó demasiado en responder. Intenta nuevamente."
            : "No se pudo completar la respuesta del asistente.";
    return { error: mensaje, causa: error.causa, proveedor: error.proveedor };
  }
  // `error` es texto visible en consumidores legacy: sin nombres de
  // infraestructura ni variables de entorno. El diagnóstico queda en el log
  // del servidor con el request_id; la UI traduce `code` con ui-error.v1.
  if (error instanceof RagUnavailableError) {
    return {
      error: "El catálogo no está disponible en este momento. Intenta nuevamente.",
      causa: "base_datos",
    };
  }
  const detalle = error instanceof Error ? error.message : "Error desconocido";
  if (/ECONNREFUSED|DATABASE_URL|postgres/i.test(detalle)) {
    return {
      error: "El catálogo no está disponible en este momento. Intenta nuevamente.",
      causa: "base_datos",
    };
  }
  return { error: "No se pudo completar la respuesta del asistente.", causa: "desconocido" };
}

function formatoSSE(evento: string, datos: unknown): string {
  return `event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`;
}

function codigoDeError(error: unknown): ErrorCodeV1 {
  if (error instanceof ErrorIA) {
    switch (error.causa) {
      case "sin_llave":
        return "AI_KEY_MISSING";
      case "cuota":
        return "AI_QUOTA";
      case "filtrado":
        return "AI_FILTERED";
      case "timeout":
        return "AI_TIMEOUT";
      default:
        return "AI_PROVIDER";
    }
  }
  if (error instanceof RagUnavailableError) return "RAG_UNAVAILABLE";
  const detalle = error instanceof Error ? error.message : "";
  if (/ECONNREFUSED|DATABASE_URL|postgres/i.test(detalle)) return "RAG_UNAVAILABLE";
  return "INTERNAL_ERROR";
}

function reintentable(error: unknown): boolean {
  if (!(error instanceof ErrorIA)) return false;
  return error.causa === "cuota" || error.causa === "timeout" || error.causa === "desconocido";
}

function envelopeHttp(requestId: string, code: ErrorCodeV1, message: string, retryable: boolean): Record<string, unknown> {
  return {
    schema_version: ERROR_CONTRACT_VERSION,
    code,
    message,
    retryable,
    request_id: requestId,
    error: message,
  };
}

export async function POST(request: Request) {
  const contextoPreliminar = leerContextoOperativo(request);
  const requestIdPreliminar = contextoPreliminar.request_id;
  const correlationIdPreliminar = contextoPreliminar.correlation_id;
  let headersDeIds = {
    "X-Request-ID": requestIdPreliminar,
    "X-Correlation-ID": correlationIdPreliminar,
  };
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > 25_000_000) {
    return Response.json(
      envelopeHttp(requestIdPreliminar, "PAYLOAD_TOO_LARGE", "La solicitud supera el tamaño máximo permitido.", false),
      { status: 413, headers: headersDeIds },
    );
  }
  let contextoOperativo = contextoPreliminar;
  let textoBody: string;
  let body: Body;
  try {
    textoBody = await request.text();
    contextoOperativo = leerContextoOperativo(request, sha256Body(textoBody));
    headersDeIds = {
      "X-Request-ID": contextoOperativo.request_id,
      "X-Correlation-ID": contextoOperativo.correlation_id,
    };
    body = parseChatRequestV1(JSON.parse(textoBody));
  } catch {
    const requestId = contextoOperativo.request_id;
    return Response.json(
      envelopeHttp(requestId, "INVALID_INPUT", "La solicitud de chat no es válida.", false),
      { status: 400, headers: headersDeIds },
    );
  }
  const requestId = contextoOperativo.request_id;
  const correlationId = contextoOperativo.correlation_id;
  const { messages, brief, proveedor, fotoEspacio, imagenesReferencia, referenceBlueprint: rawReferenceBlueprint, loraMode: rawLoraMode } = body;
  const creatividad = parseNivelCreatividad(body.creatividad);
  const cookieProveedor = request.headers
    .get("cookie")
    ?.match(/ia_proveedor=(gemini)/)?.[1];

  let chat;
  let historial: Mensaje[];
  let sistema: string;
  let referenceBlueprint: ReferenceBlueprintV2 | undefined;
  let catalogAllowlist: Awaited<ReturnType<typeof resolveLoraModeDatasetAllowlist>> = null;
  let catalogoLoraNoDisponible: string | undefined;
  let loraModeSlug: string | undefined;

  try {
    if (!RAG_ENABLED) throw new RagUnavailableError({});
    const id = resolverProveedor({ override: proveedor, cookie: cookieProveedor });
    chat = await chatDe(id);

    referenceBlueprint = rawReferenceBlueprint
      ? ReferenceBlueprintV2Schema.parse(rawReferenceBlueprint)
      : undefined;
    const loraMode = rawLoraMode == null ? null : LoraModeSlugSchema.parse(rawLoraMode);
    loraModeSlug = loraMode ?? undefined;
    if (RAG_ENABLED && loraMode) {
      try {
        catalogAllowlist = await resolveLoraModeDatasetAllowlist(loraMode);
      } catch (error) {
        // An unusable LoRA pool must not block a conversation that does not
        // need the catalog ("hola"). Catalog tools fail closed instead; any
        // non-LoRA failure (e.g. database down) still aborts the request.
        const causa = causaCatalogoLora(error);
        if (!causa) throw error;
        catalogoLoraNoDisponible = causa;
        console.warn("[chat] catálogo LoRA no disponible; herramientas de catálogo bloqueadas:", { requestId, loraMode, causa });
      }
    }

    // Only what the customer left open gets a server-picked venue/time, and only
    // at levels that suggest one (a venue photo leaves nothing open); logged so
    // a surprising scene can be traced.
    const sugerencia = sugerenciaEscenaDelTurno({ nivel: creatividad, mensajes: messages ?? [], brief, fotoEspacio: Boolean(fotoEspacio) });
    if (sugerencia) console.info("[chat] sugerencia de escena por creatividad", { requestId, creatividad, ...sugerencia });
    sistema = construirSistema({ ragEnabled: RAG_ENABLED, franjasEnabled: RAG_FRANJAS_ENABLED, brief, referenceBlueprint, catalogAllowlist: catalogAllowlist ?? undefined, catalogoLoraNoDisponible: catalogoLoraNoDisponible !== undefined, creatividad, sugerenciaEscena: sugerencia });

    // Las imágenes solo se adjuntan al último mensaje (el que se acaba de
    // mandar en este turno) — `historial` se reconstruye desde texto plano
    // en cada request, así que no hay imágenes de turnos anteriores que
    // reinyectar; el cliente las re-manda mientras sigan adjuntas.
    const imagenesActuales: Imagen[] = [
      ...(fotoEspacio
        ? [
            {
              ...fotoEspacio,
              id: "ESPACIO_BASE",
              descripcion: "Foto real del espacio del cliente.",
            },
          ]
        : []),
      ...(imagenesReferencia ?? []).map((imagen, indice) => ({
        ...imagen,
        id: `ESTILO_${String(indice + 1).padStart(2, "0")}`,
        descripcion: "Referencia visual de decoración del cliente.",
      })),
    ];
    // The brief carries durable event facts; old prose only adds input tokens
    // and makes each tool-calling turn slower as the chat grows.
    const mensajes = limitarHistorialChat(messages ?? []);
    historial = mensajes.map((m, i) => {
      if (m.role === "assistant") return { rol: "asistente" as const, texto: m.content };
      const esUltimo = i === mensajes.length - 1;
      return {
        rol: "usuario" as const,
        texto: m.content,
        imagenes: esUltimo && imagenesActuales.length ? imagenesActuales : undefined,
      };
    });
  } catch (error) {
    const datos = datosDeError(error);
    const code = codigoDeError(error);
    // Unclassified setup failures (LoRA resolution, blueprint parsing) used to
    // surface only as a generic 502; keep the cause observable without logging
    // the conversation.
    if (code === "INTERNAL_ERROR" || code === "RAG_UNAVAILABLE") {
      console.error("[chat] fallo antes del stream:", { requestId, code, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) });
    }
    return Response.json(
      { ...envelopeHttp(requestId, code, datos.error, reintentable(error)), causa: datos.causa, proveedor: datos.proveedor },
      { status: error instanceof RagUnavailableError ? 503 : statusDe(error instanceof ErrorIA ? error.causa : "desconocido"), headers: headersDeIds },
    );
  }

  // La respuesta SSE se abre antes de esperar al proveedor. Esperar el primer
  // fragmento aquí bloqueaba los headers y permitía que el timeout absoluto
  // del navegador venciera durante un turno válido con varias herramientas.
  const deadline = crearDeadlineSignal(request.signal, contextoOperativo.deadline_ms);
  const generador = ejecutarConversacionStream({
    chat,
    sistema,
    historial,
    brief: brief ?? {},
    referenceBlueprint,
    catalogAllowlist: catalogAllowlist ?? undefined,
    catalogoLoraNoDisponible,
    creatividad,
    signal: deadline.signal,
    hechosPeticion: { tieneFotoEspacio: Boolean(fotoEspacio), tieneImagenesReferencia: (imagenesReferencia?.length ?? 0) > 0, loraMode: loraModeSlug },
    telemetria: {
      flujo: "armador_decoracion",
      requestId,
      correlationId,
      superficie: "/api/chat",
      thinkingLevel: process.env.GEMINI_CHAT_THINKING_LEVEL ?? "default",
    },
  });
  const iterador = generador[Symbol.asyncIterator]();
  let cancelarStream: (() => void) | undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let terminal = false;
      let cancelado = request.signal.aborted;
      let deadlineCancelado = deadline.wasDeadlineExceeded();
      const enviar = (evento: "texto" | "herramienta" | "fin" | "error", datos: Record<string, unknown>) => {
        const versionado = {
          schema_version: CHAT_SSE_CONTRACT_VERSION,
          type: evento,
          request_id: requestId,
          correlation_id: correlationId,
          ...datos,
        };
        ChatSseEventV1Schema.parse(versionado);
        controller.enqueue(encoder.encode(formatoSSE(evento, versionado)));
      };
      const abortar = () => {
        cancelado = true;
        void iterador.return?.(undefined);
      };
      cancelarStream = () => {
        cancelado = true;
        deadline.cancel();
        void iterador.return?.(undefined);
      };
      request.signal.addEventListener("abort", abortar, { once: true });

      try {
        while (true) {
          if (cancelado) break;
          const actual = await conLimiteDeEspera(iterador.next(), remainingDeadlineMs(deadline.deadlineAt));
          deadlineCancelado = deadline.wasDeadlineExceeded();
          if (cancelado) break;
          if (actual.done) {
            if (!terminal && !cancelado) {
              terminal = true;
              enviar("error", {
                error: "El asistente cerró la respuesta antes de terminar.",
                code: "AI_PROVIDER",
                retryable: true,
              });
            }
            break;
          }
          const evento = actual.value;
          if (evento.tipo === "texto") {
            enviar("texto", { delta: evento.delta });
          } else if (evento.tipo === "herramienta") {
            enviar("herramienta", { nombre: evento.nombre, estado: evento.estado });
          } else {
            const r = evento.resultado;
            enviar("fin", {
              reply: r.texto,
              brief: r.brief,
              recomendaciones: r.recomendaciones,
              decoraciones: r.decoraciones,
              categorias: r.categorias,
              filtrosCategorias: r.filtrosCategorias,
              cotizacion: r.cotizacion,
              proveedor: r.proveedor,
              modelo: r.modelo,
              seleccionIA: r.seleccionFinalIA,
              instruccionIA: r.instruccionIA,
              ragCandidatos: r.ragCandidatos,
              ragValidados: r.ragValidados,
              ragRechazados: r.ragRechazados,
              ragTotal: r.ragTotal,
              plan: r.plan,
              referenceBlueprint: r.referenceBlueprint,
            });
            terminal = true;
            break;
          }
        }
      } catch (error) {
        if (!cancelado && !terminal) {
          terminal = true;
          const datos = deadlineCancelado
            ? { error: "El asistente tardó demasiado en responder. Intenta nuevamente.", causa: "timeout" }
            : datosDeError(error);
          const code = deadlineCancelado ? "AI_TIMEOUT" : codigoDeError(error);
          if (code === "INTERNAL_ERROR" || code === "RAG_UNAVAILABLE") {
            console.error("[chat] fallo durante el stream:", { requestId, code, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) });
          }
          enviar("error", {
            ...datos,
            code,
            retryable: deadlineCancelado || reintentable(error),
          });
        }
      } finally {
        if (!terminal || cancelado) void iterador.return?.(undefined);
        request.signal.removeEventListener("abort", abortar);
        cancelarStream = undefined;
        deadline.dispose();
        controller.close();
      }
      },
      cancel() {
        cancelarStream?.();
      },
    });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      ...headersDeIds,
    },
  });
}
