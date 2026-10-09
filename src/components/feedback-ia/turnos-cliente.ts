import { esCorreccion } from "./correccion";

/** Lo mínimo de un mensaje de los chats del cliente (el guiado y el clásico lo cumplen tal cual). */
export type MensajeChat = { id: string; role: "user" | "assistant"; content: string };

/** Lo que la persona pidió para que la IA contestara el mensaje `indice`: el último suyo antes de él. */
export function pedidoDelTurno(mensajes: readonly MensajeChat[], indice: number): string | undefined {
  for (let i = indice - 1; i >= 0; i -= 1) {
    const m = mensajes[i];
    if (m?.role === "user" && m.content.trim()) return m.content;
  }
  return undefined;
}

/** ¿Lo siguiente que dijo la persona corrige esta respuesta («no, eso no»)? Entonces cuenta como deshecha. */
export function corrigeLaRespuesta(mensajes: readonly MensajeChat[], indice: number): boolean {
  const siguiente = mensajes[indice + 1];
  return siguiente?.role === "user" && esCorreccion(siguiente.content);
}

/** El estado (el plan) de lo último que mostró la IA ANTES del mensaje `indice`, según `estadoDe`. */
export function estadoPrevio<T>(mensajes: readonly MensajeChat[], indice: number, estadoDe: (indice: number) => T | undefined): T | undefined {
  for (let i = indice - 1; i >= 0; i -= 1) {
    if (mensajes[i]?.role !== "assistant") continue;
    const estado = estadoDe(i);
    if (estado !== undefined) return estado;
  }
  return undefined;
}
