import { GoogleGenAI } from "@google/genai";

export const MODELO_CHAT = process.env.GEMINI_CHAT_MODEL ?? "gemini-3.6-flash";
export const MODELO_IMAGEN = process.env.GEMINI_IMAGE_MODEL ?? "gemini-3.1-flash-image";

// Fase 3.6: antes se instanciaba un GoogleGenAI (y su agente HTTP
// subyacente) en cada llamada — potencialmente un handshake TLS por vuelta
// del tool loop. Se reutiliza mientras la api key no cambie; si cambia
// (rotación en caliente sin reiniciar el proceso), se crea una nueva.
let clienteCacheado: { apiKey: string; cliente: GoogleGenAI } | undefined;

export function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  if (clienteCacheado?.apiKey !== apiKey) {
    clienteCacheado = { apiKey, cliente: new GoogleGenAI({ apiKey }) };
  }
  return clienteCacheado.cliente;
}

export const FALTA_GEMINI_API_KEY =
  "No hay GEMINI_API_KEY configurada. Copia .env.example a .env.local, pon tu llave de Gemini y reinicia el servidor.";
