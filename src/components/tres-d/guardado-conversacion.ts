import { leerTurnos, turnosParaGuardar, type TurnoPanel } from "@/lib/globos3d/turnos-ia";

/**
 * La conversación con la IA del taller guardada en este navegador (localStorage), APARTE de la escena (`guardado-escena.ts`):
 * puede pesar, y si el navegador no la deja guardar la escena no debe sufrir. `clave` es la identidad de la escena a la que
 * pertenecen los turnos (cambia al reemplazarla por una plantilla, una sala vacía o una idea de la biblioteca).
 */
const CLAVE = "taller3d:conversacion:v1";

export type ConversacionGuardada = { clave: string; turnos: TurnoPanel[] };

/** Una identidad nueva para una escena (o para la que se abre sin nada guardado). */
export const claveNueva = (): string => `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function leerConversacion(): ConversacionGuardada | null {
  try {
    const crudo = window.localStorage.getItem(CLAVE);
    if (!crudo) return null;
    const datos: unknown = JSON.parse(crudo);
    if (typeof datos !== "object" || datos === null) return null;
    const { clave, turnos } = datos as { clave?: unknown; turnos?: unknown };
    return typeof clave === "string" && clave ? { clave, turnos: leerTurnos(turnos) } : null;
  } catch {
    return null;
  }
}

/**
 * Guarda la conversación; si el navegador no deja (almacenamiento lleno), suelta el turno más viejo y vuelve a intentar hasta
 * que quepa. Nunca lanza. `true` si quedó guardada (aunque con menos turnos).
 */
export function guardarConversacion(c: ConversacionGuardada): boolean {
  let turnos = turnosParaGuardar(c.turnos);
  for (;;) {
    try {
      window.localStorage.setItem(CLAVE, JSON.stringify({ clave: c.clave, turnos }));
      return true;
    } catch {
      if (!turnos.length) return false;
      turnos = turnos.slice(1);
    }
  }
}
