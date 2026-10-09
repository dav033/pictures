import type { Content, GenerateContentParameters, GenerateContentResponseUsageMetadata } from "@google/genai";
import { getClaudeClient } from "@/lib/claude";
import { getGeminiClient, MODELO_CHAT } from "@/lib/gemini";
import { comoClienteGemini } from "@/lib/ia/claude/como-gemini";
import { claudeLocalPermitido, configClaudeLocal } from "@/lib/ia/claude/config";
import type { EsfuerzoClaude } from "@/lib/ia/claude/tipos";

/**
 * El cliente de los llamadores de una sola pasada que antes pedían `getGeminiClient` directo (lectura de la foto 3D,
 * detección de globos, parser de intención, intérprete de módulos, resumen del feedback, traducción de la revisión).
 * Misma regla que el registro (`resolverProveedor`): Claude gana cuando está disponible, y solo lo está en local con
 * IA_PROVEEDOR=claude (`claudeLocalPermitido`); si no, Gemini. Estos llamadores no tienen cookie ni override, y el ajuste
 * global solo puede decir "gemini", así que el resultado es el mismo sin leer la base. Los embeddings no pasan por aquí:
 * siguen en Gemini.
 * Con Gemini el cliente es el de siempre (`getGeminiClient`, la petición sale idéntica); con Claude, el transporte
 * auditado (`getClaudeClient`) con la forma de Gemini (`comoClienteGemini`).
 */

/** Lo que usan estos llamadores de la respuesta de `generateContent` (el `GenerateContentResponse` de Gemini lo cumple). */
export type RespuestaGenerativa = {
  readonly text: string | undefined;
  candidates?: Array<{ content?: Content; finishReason?: string }>;
  usageMetadata?: GenerateContentResponseUsageMetadata;
  modelVersion?: string;
};

export interface ClienteGenerativo {
  readonly models: { generateContent(parametros: GenerateContentParameters): Promise<RespuestaGenerativa> };
}

export type DestinoGenerativo = {
  proveedor: "gemini" | "claude";
  modelo: string;
  /** Claude: el esfuerzo que de verdad se manda (para `thinking_level` de la telemetría). */
  esfuerzo?: EsfuerzoClaude;
};

export function destinoGenerativo(): DestinoGenerativo {
  if (!claudeLocalPermitido()) return { proveedor: "gemini", modelo: MODELO_CHAT };
  const config = configClaudeLocal();
  return { proveedor: "claude", modelo: config.modelo, esfuerzo: config.esfuerzo };
}

/** `null` si el proveedor que toca no está configurado (los llamadores lo tratan como «sin IA», igual que antes). */
export function clienteGenerativoDe(proposito: string): (DestinoGenerativo & { cliente: ClienteGenerativo }) | null {
  const destino = destinoGenerativo();
  if (destino.proveedor === "claude") {
    const claude = getClaudeClient(proposito);
    return claude ? { ...destino, cliente: comoClienteGemini(claude, configClaudeLocal()) } : null;
  }
  const gemini = getGeminiClient(proposito);
  return gemini ? { ...destino, cliente: gemini } : null;
}
