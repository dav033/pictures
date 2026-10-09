import { ApiError } from "@google/genai";
import { getGeminiClient } from "@/lib/gemini";
import { conReintento, type FlujoIA } from "@sempertex/agente-core";
import { registrarGemini, resultadoTelemetria, type ContextoTelemetriaIA } from "@/lib/ia/nucleo/telemetria-llamadas";
import { RAG_PYTHON_QUERY_EMBEDDINGS_ENABLED, RAG_USE_VECTOR } from "@/lib/ia/nucleo/feature-flags";
import {
  isPythonAdapterError,
  llamarPythonEmbedding,
} from "@/lib/ia/nucleo/python-adapter";
import { sha256Body } from "@/lib/ia/contracts/operational-v1";

export const MODELO_EMBEDDING = "gemini-embedding-2";
export const DIMENSIONES_EMBEDDING = 768;

export type TareaEmbedding = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

export type OpcionesEmbedding = {
  parentSignal?: AbortSignal;
  deadlineMs?: number;
};

/**
 * Un solo embedding de texto.
 *
 * `tarea` (taskType) NO tiene efecto hoy: verificado contra la API real
 * (PLAN_RENDIMIENTO_RAG.md §3.1) que gemini-embedding-2 devuelve el vector
 * IDÉNTICO bit a bit para RETRIEVAL_DOCUMENT, RETRIEVAL_QUERY y sin taskType.
 * `gemini-embedding-001` sí lo respeta — se mantiene el parámetro por
 * compatibilidad hacia ese modelo y porque documenta la intención en cada
 * call site, pero no asumas que hoy separa el espacio de documento y consulta.
 * Los vectores ya vienen L2-normalizados (norma 1.0) — no hace falta normalizar a mano.
 */
/** 429/5xx y errores de red son transitorios — un 400/401/403 nunca lo es. */
function esReintentable(error: unknown): boolean {
  if (error instanceof ApiError) return error.status === 429 || error.status >= 500;
  return true;
}

export async function embeberTexto(
  texto: string,
  tarea: TareaEmbedding,
  telemetria?: ContextoTelemetriaIA,
  opciones?: OpcionesEmbedding,
): Promise<number[]> {
  if (
    tarea === "RETRIEVAL_QUERY"
    && RAG_PYTHON_QUERY_EMBEDDINGS_ENABLED
  ) {
    const requestId = telemetria?.requestId ?? crypto.randomUUID();
    const correlationId = telemetria?.correlationId ?? requestId;
    const contextoPython: ContextoTelemetriaIA = { ...telemetria, requestId, correlationId };
    const inicio = Date.now();
    let result: Awaited<ReturnType<typeof llamarPythonEmbedding>>;
    try {
      result = await llamarPythonEmbedding({
        text: texto,
        requestId,
        correlationId,
        deadlineMs: opciones?.deadlineMs ?? 5_000,
        idempotencyKey: `embedding:${correlationId}:${sha256Body(texto)}`,
        parentSignal: opciones?.parentSignal,
      });
    } catch (error) {
      const attempts = isPythonAdapterError(error) ? error.attempts : undefined;
      if (attempts?.length) {
        for (const attempt of attempts) {
          registrarGemini({
            flujo: "armador_decoracion",
            capacidad: "embedding_consulta",
            modelo: MODELO_EMBEDDING,
            inicio,
            ms: attempt.elapsed_ms,
            resultado: attempt.result === "ok" ? "ok" : resultadoTelemetria(error),
            contexto: {
              superficie: "python:/internal/v1/embed",
              ...contextoPython,
              intento: attempt.attempt,
            },
          });
        }
      } else {
        registrarGemini({
          flujo: "armador_decoracion",
          capacidad: "embedding_consulta",
          modelo: MODELO_EMBEDDING,
            inicio,
            resultado: resultadoTelemetria(error),
            contexto: { superficie: "python:/internal/v1/embed", ...contextoPython, intento: 1 },
        });
      }
      throw error;
    }
    if (!result.replayed) {
      for (const attempt of result.attempts) {
        registrarGemini({
          flujo: "armador_decoracion",
          capacidad: "embedding_consulta",
          modelo: result.model,
          inicio,
          ms: attempt.elapsed_ms,
            resultado: attempt.result === "ok" ? "ok" : "error",
            contexto: {
              superficie: "python:/internal/v1/embed",
              ...contextoPython,
              intento: attempt.attempt,
            },
        });
      }
    }
    validarEmbedding(result.values);
    return result.values;
  }

  const cliente = getGeminiClient("embedding");
  if (!cliente) throw new Error("No hay GEMINI_API_KEY configurada.");

  let respuesta: Awaited<ReturnType<typeof cliente.models.embedContent>>;
  let intento = 0;
  try {
    respuesta = await conReintento(
      async () => {
        intento += 1;
        const inicio = Date.now();
        try {
          const resultado = await cliente.models.embedContent({
            model: MODELO_EMBEDDING,
            contents: texto,
            config: {
              taskType: tarea,
              outputDimensionality: DIMENSIONES_EMBEDDING,
            },
          });
          registrarGemini({
            flujo: tarea === "RETRIEVAL_DOCUMENT" ? "indexacion_catalogo" : "armador_decoracion",
            capacidad: tarea === "RETRIEVAL_DOCUMENT" ? "embedding_documento" : "embedding_consulta",
            modelo: MODELO_EMBEDDING,
            inicio,
            resultado: "ok",
            contexto: { superficie: tarea === "RETRIEVAL_DOCUMENT" ? "script:rag-embed" : "/api/chat", ...telemetria, intento },
          });
          return resultado;
        } catch (error) {
          registrarGemini({
            flujo: tarea === "RETRIEVAL_DOCUMENT" ? "indexacion_catalogo" : "armador_decoracion",
            capacidad: tarea === "RETRIEVAL_DOCUMENT" ? "embedding_documento" : "embedding_consulta",
            modelo: MODELO_EMBEDDING,
            inicio,
            resultado: resultadoTelemetria(error),
            contexto: { superficie: tarea === "RETRIEVAL_DOCUMENT" ? "script:rag-embed" : "/api/chat", ...telemetria, intento },
          });
          throw error;
        }
      },
      { esReintentable },
    );
  } catch (error) {
    throw error;
  }

  const valores = respuesta.embeddings?.[0]?.values;
  if (!valores || valores.length === 0) {
    throw new Error("Gemini no devolvió un embedding para el texto dado.");
  }
  return valores;
}

/**
 * Un embedding de UNA imagen (gemini-embedding-2 es multimodal: la imagen y el texto comparten espacio; el modelo
 * acepta una imagen por llamada). Es la rama de imagen de la búsqueda por foto del taller (`superficie`
 * «taller_biblioteca»); queda registrado con la capacidad `embedding_imagen` y el tamaño de la imagen enviada.
 * `mime` es el de los bytes (jpeg, png o webp). Vector de 768 dimensiones, ya L2-normalizado, como el de texto.
 */
export async function embeberImagen(
  bytes: Uint8Array,
  mime: string,
  telemetria?: ContextoTelemetriaIA,
  /** El flujo al que se atribuye la llamada en la telemetría (por defecto, la búsqueda del armador). */
  flujo: FlujoIA = "armador_decoracion",
): Promise<number[]> {
  if (bytes.byteLength === 0) throw new Error("La imagen está vacía.");
  const cliente = getGeminiClient("embedding");
  if (!cliente) throw new Error("No hay GEMINI_API_KEY configurada.");
  const data = Buffer.from(bytes).toString("base64");

  let intento = 0;
  const respuesta = await conReintento(
    async () => {
      intento += 1;
      const inicio = Date.now();
      const registro = (resultado: Parameters<typeof registrarGemini>[0]["resultado"]) =>
        registrarGemini({
          flujo,
          capacidad: "embedding_imagen",
          modelo: MODELO_EMBEDDING,
          inicio,
          resultado,
          bytesImagenEntrada: bytes.byteLength,
          contexto: { superficie: "taller_biblioteca", ...telemetria, intento },
        });
      try {
        const resultado = await cliente.models.embedContent({
          model: MODELO_EMBEDDING,
          contents: [{ parts: [{ inlineData: { mimeType: mime, data } }] }],
          config: { outputDimensionality: DIMENSIONES_EMBEDDING },
        });
        registro("ok");
        return resultado;
      } catch (error) {
        registro(resultadoTelemetria(error));
        throw error;
      }
    },
    { esReintentable },
  );

  const valores = respuesta.embeddings?.[0]?.values;
  if (!valores || valores.length === 0) throw new Error("Gemini no devolvió un embedding para la imagen dada.");
  validarEmbedding(valores);
  return valores;
}

/** Computes one optional vector for a turn; lexical retrieval remains the fallback. */
export async function embeddingOpcional(
  query: string,
  parentSignal?: AbortSignal,
  deadlineAt?: number,
  onFailure?: () => void,
  telemetria?: ContextoTelemetriaIA,
): Promise<number[] | undefined> {
  const vectorEnabled = RAG_USE_VECTOR && (
    Boolean(process.env.GEMINI_API_KEY?.trim())
    || RAG_PYTHON_QUERY_EMBEDDINGS_ENABLED
  );
  if (!vectorEnabled || !query.trim()) return undefined;
  try {
    return await embeberTexto(query, "RETRIEVAL_QUERY", telemetria, {
      parentSignal,
      deadlineMs: deadlineAt ? Math.max(1, deadlineAt - Date.now()) : undefined,
    });
  } catch {
    onFailure?.();
    return undefined;
  }
}

export function validarEmbedding(valores: number[]): void {
  if (!Array.isArray(valores)) throw new Error("El embedding no es un array.");
  if (valores.length !== DIMENSIONES_EMBEDDING) {
    throw new Error(`Embedding con ${valores.length} dimensiones, se esperaban ${DIMENSIONES_EMBEDDING}.`);
  }
  if (!valores.every((v) => Number.isFinite(v))) {
    throw new Error("El embedding contiene valores no finitos (NaN/Infinity).");
  }
}
