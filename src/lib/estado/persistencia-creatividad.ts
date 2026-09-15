import { NIVELES_CREATIVIDAD, type NivelCreatividad } from "@/lib/ia/creatividad";

/**
 * Nivel de creatividad de la conversación guardada en sessionStorage junto con
 * los mensajes (mismo JSON de `demo_chat_v4`). Al recargar, una conversación
 * «Fiel» volvía a «Equilibrado» y el siguiente turno se validaba con otro rango
 * de estructuras (E2E real 2). Sin React ni DOM.
 */

/** Nivel guardado en los datos de la conversación, o null si falta o no es válido (se usa el de por defecto). */
export function creatividadGuardada(datos: unknown): NivelCreatividad | null {
  if (typeof datos !== "object" || datos === null) return null;
  const nivel = (datos as { creatividad?: unknown }).creatividad;
  return typeof nivel === "number" && (NIVELES_CREATIVIDAD as readonly number[]).includes(nivel) ? (nivel as NivelCreatividad) : null;
}
