import { GoogleGenAI } from "@google/genai";

export const MODELO_CHAT = process.env.GEMINI_CHAT_MODEL ?? "gemini-3.6-flash";
export const MODELO_IMAGEN = process.env.GEMINI_IMAGE_MODEL ?? "gemini-3.1-flash-image";

export function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({ apiKey });
}

export const FALTA_GEMINI_API_KEY =
  "No hay GEMINI_API_KEY configurada. Copia .env.example a .env.local, pon tu llave de Gemini y reinicia el servidor.";
