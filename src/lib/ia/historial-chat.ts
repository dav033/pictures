import type { ChatMessage } from "@/lib/types";

export const LIMITE_CARACTERES_HISTORIAL_CHAT = 16_000;

/** Keeps recent conversational context bounded; the structured brief retains event facts. */
export function limitarHistorialChat(
  mensajes: ChatMessage[],
  limiteCaracteres = LIMITE_CARACTERES_HISTORIAL_CHAT,
): ChatMessage[] {
  const recientes: ChatMessage[] = [];
  let caracteres = 0;

  for (let indice = mensajes.length - 1; indice >= 0; indice -= 1) {
    const mensaje = mensajes[indice]!;
    const costo = Math.max(1, mensaje.content.length);
    if (recientes.length > 0 && caracteres + costo > limiteCaracteres) break;
    recientes.unshift(mensaje);
    caracteres += costo;
  }

  // Gemini conversation context must begin with a user turn after trimming.
  while (recientes[0]?.role === "assistant") recientes.shift();
  return recientes;
}
