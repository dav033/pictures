import type { ConfigClaude } from "./config";
import type { CuerpoMensajes, EleccionHerramienta, HerramientaAnthropic, MensajeAnthropic } from "./tipos";

/**
 * El cuerpo de cada petición a Claude, igual para el chat (ChatPort) y para la escena 3D:
 * - `output_config.effort` desde `IA_LOCAL_ESFUERZO`; razonamiento adaptativo (o apagado con `IA_LOCAL_PENSAMIENTO=off`);
 * - nunca `temperature`/`top_p`/`top_k` (Haiku 5.5 responde 400 a cualquier valor distinto del de fábrica);
 * - caché: punto fijo en la última herramienta (lo pone `herramientasAnthropic`) y en el sistema, más la caché
 *   automática de nivel superior para la cola de la conversación, que avanza sola en el bucle de herramientas (3 de los
 *   4 puntos permitidos; «automatic vs explicit breakpoints» de la guía de prompt caching, disponible en la API de Claude).
 */
export function cuerpoMensajes(entrada: {
  config: Pick<ConfigClaude, "modelo" | "esfuerzo" | "pensamiento">;
  maxTokens: number;
  sistema: string;
  mensajes: MensajeAnthropic[];
  herramientas: HerramientaAnthropic[];
  eleccion?: EleccionHerramienta;
}): CuerpoMensajes {
  const { config, sistema, mensajes, herramientas, eleccion } = entrada;
  return {
    model: config.modelo,
    max_tokens: entrada.maxTokens,
    ...(sistema.trim() ? { system: [{ type: "text", text: sistema, cache_control: { type: "ephemeral" } }] } : {}),
    messages: mensajes,
    ...(herramientas.length ? { tools: herramientas } : {}),
    ...(herramientas.length && eleccion ? { tool_choice: eleccion } : {}),
    thinking: config.pensamiento ? { type: "adaptive" } : { type: "disabled" },
    output_config: { effort: config.esfuerzo },
    cache_control: { type: "ephemeral" },
  };
}
