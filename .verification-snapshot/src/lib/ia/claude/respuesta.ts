import type { LlamadaHerramienta, TurnoChat } from "@sempertex/agente-core";
import type { BloqueCrudo, BloqueUsoHerramienta, RespuestaAnthropic, UsoAnthropic } from "./tipos";

/**
 * Respuesta de la API de mensajes → turno neutral (`TurnoChat`).
 * El contenido completo del turno (razonamiento + texto + tool_use) viaja en `meta` de la primera llamada: en la vuelta
 * siguiente se reenvía sin tocar, que es lo que exige la API para los bloques de razonamiento (el análogo de la
 * `thoughtSignature` de Gemini).
 */

export const META_CONTENIDO = "contenidoClaude";

export function esUsoHerramienta(bloque: BloqueCrudo): bloque is BloqueCrudo & BloqueUsoHerramienta {
  return bloque.type === "tool_use" && typeof bloque.id === "string" && typeof bloque.name === "string"
    && typeof bloque.input === "object" && bloque.input !== null && !Array.isArray(bloque.input);
}

/** Texto visible: solo los bloques `text` (los de razonamiento no se muestran). */
export function textoDeContenido(contenido: readonly BloqueCrudo[]): string {
  return contenido.map((bloque) => (bloque.type === "text" && typeof bloque.text === "string" ? bloque.text : "")).join("");
}

export function llamadasDeContenido(contenido: readonly BloqueCrudo[]): LlamadaHerramienta[] {
  return contenido.filter(esUsoHerramienta).map((bloque, indice) => ({
    id: bloque.id,
    nombre: bloque.name,
    args: bloque.input,
    ...(indice === 0 ? { meta: { [META_CONTENIDO]: contenido } } : {}),
  }));
}

/**
 * Tokens en el contrato neutral: `entrada` es TODO el prompt (sin caché + leído + escrito), igual que `promptTokenCount`
 * de Gemini; `salida` excluye el razonamiento cuando la API lo desglosa (`output_tokens` lo incluye).
 */
export function usoDeAnthropic(uso: UsoAnthropic): TurnoChat["uso"] {
  const cacheados = uso.cache_read_input_tokens ?? 0;
  const cacheEscritos = uso.cache_creation_input_tokens ?? 0;
  const pensamiento = Math.min(uso.output_tokens, uso.output_tokens_details?.thinking_tokens ?? 0);
  return {
    entrada: uso.input_tokens + cacheados + cacheEscritos,
    salida: uso.output_tokens - pensamiento,
    cacheados,
    cacheEscritos,
    pensamiento,
  };
}

/** `ai_call_log.finish_reason` admite `^[A-Z_]+$` (el estilo de Gemini): `end_turn` → `END_TURN`. */
export function motivoFinClaude(stopReason: string | null): string | undefined {
  return stopReason ? stopReason.toUpperCase() : undefined;
}

export function turnoDeRespuesta(respuesta: RespuestaAnthropic, bytesImagenEnviados: number): TurnoChat {
  const finishReason = motivoFinClaude(respuesta.stop_reason);
  return {
    texto: textoDeContenido(respuesta.content),
    llamadas: llamadasDeContenido(respuesta.content),
    uso: usoDeAnthropic(respuesta.usage),
    modelo: respuesta.model,
    bytesImagenEnviados,
    ...(finishReason ? { finishReason } : {}),
  };
}
