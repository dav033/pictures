import type { ChatMessage } from "@/lib/types";

// Fase 3.10: el límite real del contexto del modelo se mide en tokens, no en
// caracteres — truncar por longitud de string trata "hola" y una cadena de
// 4 caracteres de puntuación como el mismo costo, cuando el segundo puede
// costar varias veces más tokens (o menos, según el idioma/tokenizador).
// Gemini no expone un tokenizador local síncrono, y llamar a su API
// countTokens por mensaje añadiría una ronda de red a cada turno solo para
// decidir cuánto historial mandar — así que se usa una aproximación
// (~4 caracteres por token, la heurística estándar para texto en
// inglés/español) en vez de un conteo exacto. El límite efectivo se deriva
// del mismo presupuesto de antes (16 000 caracteres) para no cambiar el
// tamaño de ventana de historial como efecto secundario de este cambio de
// unidad — ajustar el presupuesto en sí es una decisión de producto aparte.
const CARACTERES_POR_TOKEN_APROX = 4;

/** Aproximación, no un conteo exacto — ver justificación arriba. */
export function estimarTokens(texto: string): number {
  return Math.ceil(texto.length / CARACTERES_POR_TOKEN_APROX);
}

export const LIMITE_TOKENS_HISTORIAL_CHAT = Math.round(16_000 / CARACTERES_POR_TOKEN_APROX);

/** Keeps recent conversational context bounded; the structured brief retains event facts. */
export function limitarHistorialChat(
  mensajes: ChatMessage[],
  limiteTokens = LIMITE_TOKENS_HISTORIAL_CHAT,
): ChatMessage[] {
  const recientes: ChatMessage[] = [];
  let tokens = 0;

  for (let indice = mensajes.length - 1; indice >= 0; indice -= 1) {
    const mensaje = mensajes[indice]!;
    const costo = Math.max(1, estimarTokens(mensaje.content));
    if (recientes.length > 0 && tokens + costo > limiteTokens) break;
    recientes.unshift(mensaje);
    tokens += costo;
  }

  // Gemini conversation context must begin with a user turn after trimming.
  while (recientes[0]?.role === "assistant") recientes.shift();
  return recientes;
}
