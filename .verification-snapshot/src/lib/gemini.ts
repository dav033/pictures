import { GoogleGenAI } from "@google/genai";
import { envolverClienteGemini } from "@/lib/registro/servidor";

export const MODELO_CHAT = process.env.GEMINI_CHAT_MODEL ?? "gemini-3.6-flash";

// Fase 3.6: antes se instanciaba un GoogleGenAI (y su agente HTTP
// subyacente) en cada llamada — potencialmente un handshake TLS por vuelta
// del tool loop. Se reutiliza mientras la api key no cambie; si cambia
// (rotación en caliente sin reiniciar el proceso), se crea una nueva.
let clienteCacheado: { apiKey: string; cliente: GoogleGenAI } | undefined;

/**
 * Cliente compartido, ya auditado: cada `generateContent`/`generateContentStream`/`embedContent` deja
 * `llamada_ia` + `respuesta_ia` en el registro de la conversación (src/lib/registro) con este `proposito`.
 */
export function getGeminiClient(proposito = "gemini_directo"): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  if (clienteCacheado?.apiKey !== apiKey) {
    clienteCacheado = { apiKey, cliente: new GoogleGenAI({ apiKey }) };
  }
  return envolverClienteGemini(clienteCacheado.cliente, { proposito, propositoEmbedding: proposito === "gemini_directo" ? "embedding" : proposito });
}

