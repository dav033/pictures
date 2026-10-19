import { ThinkingLevel } from "@google/genai";
import { plazoIA } from "@/lib/ia/claude/config";
import { costeClaudeUsd } from "@/lib/ia/claude/precios";
import { clienteGenerativoDe } from "@/lib/ia/nucleo/cliente-generativo";
import { registrarSegunProveedor, resultadoTelemetria } from "@/lib/ia/nucleo/telemetria-llamadas";
import { decidir } from "@/lib/registro/servidor";
import type { ResultadoAgregacion } from "./analisis";

/**
 * Resumen opcional de los huecos recurrentes, redactado por Gemini Flash a partir de las métricas ya agregadas (nunca de
 * las escenas ni de las imágenes). El coste está acotado por construcción: entrada de a lo sumo `MAX_CARACTERES_ENTRADA`,
 * salida de a lo sumo `MAX_TOKENS_SALIDA`, y se rechaza la llamada si la cota supera `TOPE_COSTE_RESUMEN_USD`.
 * W5: el cliente lo da el registro (`clienteGenerativoDe`): con Claude activo en local lo redacta Claude (la cota, con los
 * precios de Gemini, queda por encima de la de Claude); en producción, Gemini igual que siempre.
 */

export const PROPOSITO_RESUMEN = "feedback_ia_resumen";
export const TOPE_COSTE_RESUMEN_USD = 0.02;
const MAX_CARACTERES_ENTRADA = 9_000;
// Incluye los tokens de pensamiento: con menos, el texto sale cortado a media frase.
const MAX_TOKENS_SALIDA = 1800;
const TIEMPO_MAXIMO_MS = 40_000;
// US$0,50 por millón de tokens de entrada y US$3 de salida/pensamiento (los mismos que costeFlashUsd de globos3d).
const USD_ENTRADA_POR_TOKEN = 0.5 / 1e6;
const USD_SALIDA_POR_TOKEN = 3 / 1e6;

export type ResumenGemini = { texto: string; modelo: string; costeUsd: number };

const corto = (texto: string | null, largo: number): string | null => (texto !== null && texto.length > largo ? `${texto.slice(0, largo - 1)}…` : texto);

export function construirPrompt(resultado: ResultadoAgregacion, dias: number): string {
  const { metricas } = resultado;
  const datos = {
    dias,
    turnos: resultado.totalTurnos,
    calificados: resultado.totalCalificados,
    promedio: resultado.promedio,
    deshechos: metricas.deshechos,
    porMotivo: metricas.porMotivo,
    porProducto: metricas.porProducto,
    porHerramienta: metricas.porHerramienta.slice(0, 10),
    frases: metricas.frases,
    peores: metricas.peores.map((p) => ({ ...p, comentario: corto(p.comentario, 300), pedido: corto(p.pedido, 200) })),
  };
  const instruccion = [
    "Eres analista de calidad de un asistente de IA que arma decoraciones con globos (Taller 3D y chat del cliente).",
    "Con las métricas de calificaciones (1 a 10) de las personas, escribe en español, en menos de 180 palabras:",
    "1) los 3 huecos más importantes de la IA, ordenados por impacto; 2) la causa probable de cada uno; 3) una mejora concreta para cada uno.",
    "No inventes datos que no estén en las métricas; si hay pocos datos, dilo.",
  ].join("\n");
  return `${instruccion}\n\nMétricas:\n${JSON.stringify(datos)}`.slice(0, MAX_CARACTERES_ENTRADA);
}

/** Cota del coste de una llamada con ese prompt (≈3 caracteres por token de entrada y todos los tokens de salida posibles). */
export function costeMaximoUsd(prompt: string): number {
  return Math.ceil(prompt.length / 3) * USD_ENTRADA_POR_TOKEN + MAX_TOKENS_SALIDA * USD_SALIDA_POR_TOKEN;
}

export async function resumirConGemini(resultado: ResultadoAgregacion, dias: number): Promise<ResumenGemini | null> {
  const generativo = clienteGenerativoDe(PROPOSITO_RESUMEN);
  if (!generativo) return null;
  const { cliente, modelo } = generativo;
  const prompt = construirPrompt(resultado, dias);
  if (costeMaximoUsd(prompt) > TOPE_COSTE_RESUMEN_USD) return null;

  const inicio = Date.now();
  try {
    const respuesta = await cliente.models.generateContent({
      model: modelo,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }, maxOutputTokens: MAX_TOKENS_SALIDA, temperature: 0.2, abortSignal: AbortSignal.timeout(plazoIA(TIEMPO_MAXIMO_MS)) },
    });
    registrarSegunProveedor(generativo.proveedor, { flujo: "evaluacion", capacidad: "chat_turno", modelo, inicio, resultado: "ok", contexto: { superficie: PROPOSITO_RESUMEN }, usage: respuesta.usageMetadata, thinkingLevel: generativo.esfuerzo ?? "low", finishReason: respuesta.candidates?.[0]?.finishReason });
    const uso = respuesta.usageMetadata;
    const costeClaude = costeClaudeUsd(modelo, { input_tokens: uso?.promptTokenCount ?? 0, output_tokens: (uso?.candidatesTokenCount ?? 0) + (uso?.thoughtsTokenCount ?? 0) });
    // Por Claude Code (cli) lo paga la suscripción: 0.
    const costeUsd = generativo.transporte === "cli" ? 0 : Math.round((costeClaude ?? (uso?.promptTokenCount ?? 0) * USD_ENTRADA_POR_TOKEN + ((uso?.candidatesTokenCount ?? 0) + (uso?.thoughtsTokenCount ?? 0)) * USD_SALIDA_POR_TOKEN) * 1e6) / 1e6;
    const texto = respuesta.text?.trim();
    decidir("modelo:feedback_ia_resumen", texto ? "resumen de los huecos recurrentes redactado" : "el modelo no devolvió texto", { dias, calificados: resultado.totalCalificados, costeEstimadoUsd: costeUsd, modelo });
    return texto ? { texto: texto.slice(0, 8000), modelo, costeUsd } : null;
  } catch (error) {
    registrarSegunProveedor(generativo.proveedor, { flujo: "evaluacion", capacidad: "chat_turno", modelo, inicio, resultado: resultadoTelemetria(error), contexto: { superficie: PROPOSITO_RESUMEN }, thinkingLevel: generativo.esfuerzo ?? "low" });
    decidir("modelo:feedback_ia_resumen", "no se pudo redactar el resumen: se guarda solo el análisis numérico", { error: error instanceof Error ? error.message.slice(0, 300) : String(error) });
    return null;
  }
}
