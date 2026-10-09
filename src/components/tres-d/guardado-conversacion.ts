import { leerTurnos, turnosParaGuardar, type TurnoPanel } from "@/lib/globos3d/turnos-ia";

/**
 * La conversación con la IA del taller guardada en este navegador (localStorage), APARTE de la escena (`guardado-escena.ts`):
 * puede pesar, y si el navegador no la deja guardar la escena no debe sufrir. Cada turno lleva la `clave` de la escena en que se
 * hizo (la identidad de la escena vive con ella: historial y guardado, ver `useHistorialEscena`).
 */
const CLAVE = "taller3d:conversacion:v1";

/** Una identidad nueva para una escena (la que se abre sin nada guardado, o la que reemplaza a otra). */
export const claveNueva = (): string => `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function leerConversacion(): TurnoPanel[] {
  try {
    const crudo = window.localStorage.getItem(CLAVE);
    return crudo ? leerTurnos((JSON.parse(crudo) as { turnos?: unknown }).turnos) : [];
  } catch {
    return [];
  }
}

/**
 * Guarda la conversación; si el navegador no deja (almacenamiento lleno), suelta el turno más viejo y vuelve a intentar hasta
 * que quepa. Nunca lanza. `true` si quedó guardada (aunque con menos turnos).
 */
export function guardarConversacion(todos: readonly TurnoPanel[]): boolean {
  let turnos = turnosParaGuardar(todos);
  for (;;) {
    try {
      window.localStorage.setItem(CLAVE, JSON.stringify({ turnos }));
      return true;
    } catch {
      if (!turnos.length) return false;
      turnos = turnos.slice(1);
    }
  }
}
