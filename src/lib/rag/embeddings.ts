import { ApiError } from "@google/genai";
import { getGeminiClient } from "@/lib/gemini";
import { conReintento } from "@/lib/retry";

export const MODELO_EMBEDDING = process.env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-2";
export const DIMENSIONES_EMBEDDING = Number(process.env.GEMINI_EMBEDDING_DIMENSIONS ?? 768);

export type TareaEmbedding = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

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

export async function embeberTexto(texto: string, tarea: TareaEmbedding): Promise<number[]> {
  const cliente = getGeminiClient();
  if (!cliente) throw new Error("No hay GEMINI_API_KEY configurada.");

  const respuesta = await conReintento(
    () =>
      cliente.models.embedContent({
        model: MODELO_EMBEDDING,
        contents: texto,
        config: {
          taskType: tarea,
          outputDimensionality: DIMENSIONES_EMBEDDING,
        },
      }),
    { esReintentable },
  );

  const valores = respuesta.embeddings?.[0]?.values;
  if (!valores || valores.length === 0) {
    throw new Error("Gemini no devolvió un embedding para el texto dado.");
  }
  return valores;
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
