import type { PasoFeedback } from "../../feedback-ia/cliente-feedback";
import type { Escena } from "@/lib/globos3d/escena";
import type { PasoIA } from "@/lib/globos3d/flujo-escena-ia";

/**
 * Lo que la calificación de un turno necesita y el turno guardado no trae (REQ-010): la escena de antes y de después, el id de la
 * solicitud y los pasos tal como llegaron en el flujo. Vive en memoria, solo para los últimos turnos: lo que se guarda con la
 * escena en el navegador no cambia (un turno de una sesión anterior se califica sin escenas).
 */
export type RegistroTurnoIA = { solicitudId?: string; pasos: PasoFeedback[]; escenaAntes: Escena; escenaDespues: Escena };

const MAX_TURNOS_EN_MEMORIA = 30;

export const pasosDelFlujo = (pasos: readonly PasoIA[]): PasoFeedback[] => pasos.map((p) => ({ nombre: p.herramienta, ok: p.ok, resumen: p.resumen }));

export function crearRegistroFeedback(max = MAX_TURNOS_EN_MEMORIA) {
  const turnos = new Map<string, RegistroTurnoIA>();
  return {
    guardar(id: string, registro: RegistroTurnoIA): void {
      turnos.delete(id);
      turnos.set(id, registro);
      for (const viejo of [...turnos.keys()].slice(0, Math.max(0, turnos.size - max))) turnos.delete(viejo);
    },
    leer: (id: string): RegistroTurnoIA | undefined => turnos.get(id),
    vaciar: (): void => turnos.clear(),
  };
}
