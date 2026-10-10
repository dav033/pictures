/**
 * Guarda de procesos del transporte `cli`. La guarda de red no ve a Claude Code (es un proceso hijo, no un `fetch`), así
 * que se pone delante del cupo de procesos compartido: no lanza ningún `claude` con la pasada detenida (tope o máximo de
 * llamadas), aunque quien lo pide no propague la señal de aborto ni haya esperado turno hasta que se paró, y cuenta los
 * procesos al lanzarlos para que `--max-llamadas` sea exacto (el contador cuenta al cerrar, y una llamada que cierra libera
 * su turno antes de que el paro llegue). Los procesos que ya corren mueren por la señal de aborto de la pasada.
 */
import { cupoCompartido, type Cupo } from "@/lib/ia/claude/cli/cupo";

/** Devuelve la función que restaura el cupo original. */
export function instalarGuardaProcesos(parado: () => string | null, maxLlamadas: number): () => void {
  const base = cupoCompartido();
  let lanzados = 0;
  const impedimento = (): string | null => {
    const motivo = parado();
    if (motivo !== null) return `pasada detenida (${motivo})`;
    return lanzados >= maxLlamadas ? `máximo de llamadas (${maxLlamadas}) alcanzado` : null;
  };
  const guardado: Cupo = {
    async tomar(signal, esperaMaxMs) {
      const antes = impedimento();
      if (antes !== null) throw new Error(`Guarda de procesos: ${antes}; no se lanza Claude Code.`);
      const liberar = await base.tomar(signal, esperaMaxMs);
      const despues = impedimento();
      if (despues !== null) {
        liberar();
        throw new Error(`Guarda de procesos: ${despues}; no se lanza Claude Code.`);
      }
      lanzados += 1;
      return liberar;
    },
  };
  globalThis.__cupoClaudeCli = guardado;
  return () => { globalThis.__cupoClaudeCli = base; };
}
