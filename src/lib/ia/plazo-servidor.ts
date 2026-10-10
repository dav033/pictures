import { factorPlazoIA } from "@/lib/ia/claude/config";
import { crearDeadlineSignal, DEADLINE_MAX_MS } from "@/lib/ia/contracts/operational-v1";

type Entorno = Readonly<Record<string, string | undefined>>;

/**
 * El plazo de un turno de las rutas que esperan a la IA (chat, guiada). `crearDeadlineSignal` recorta todo plazo a
 * DEADLINE_MAX_MS (110 s): con Claude por Claude Code (×4, solo local) el plazo y ese tope crecen juntos; en producción
 * el factor es 1 y la señal es exactamente la de siempre.
 */
export function crearDeadlineIA(padre: AbortSignal, ms: number, entorno: Entorno = process.env): ReturnType<typeof crearDeadlineSignal> {
  const factor = factorPlazoIA(entorno);
  return crearDeadlineSignal(padre, ms * factor, DEADLINE_MAX_MS * factor);
}
