/**
 * Cuándo para el refino de una pasada. Un turno que solo mira (`ver_escena`, `ver_pieza`) no es convergencia: no cambió nada, así que no hay con qué
 * decir que la escena ya coincide. Las paradas, en orden:
 * - sin acciones (el asistente contesta «ya coincide» sin llamar a ninguna herramienta): convergió, sin pagar más vueltas;
 * - un turno con ediciones que EMPEORA la proporción (la medida con los globos visibles): regresión, para sin convergencia (el refino conserva la mejor escena);
 * - un turno con ediciones que no mejora más de `MEJORA_MINIMA`: meseta, converge;
 * - dos turnos seguidos que solo miran: para sin convergencia (el asistente no hace nada útil).
 * En cualquier otro caso sigue hasta el tope de vueltas. Puro.
 */

/** Lo que una vuelta del asistente mejora la proporción como mínimo para seguir (0 a 1). */
export const MEJORA_MINIMA = 0.005;

export type TurnoEvaluado = {
  /** Todas las acciones del turno fueron consultas (`ver_escena`, `ver_pieza`…): no cambió la escena. */
  soloConsulta: boolean;
  /** El asistente no llamó a ninguna herramienta. */
  sinAcciones?: boolean;
  /** La proporción de la escena al terminar el turno, o `null` si no se pudo medir. */
  proporciones: number | null;
};

export type MotivoParada = "sin_acciones" | "regresion" | "sin_mejora" | "solo_consulta";
export type VeredictoTurno = { seguir: true } | { seguir: false; convergio: boolean; motivo: MotivoParada };

/** ¿Para después del último turno de `turnos`? `base` es la proporción de la escena antes del primer turno (la de la lectura compilada). */
export function evaluarTurno(turnos: readonly TurnoEvaluado[], base: number | null): VeredictoTurno {
  const ultimo = turnos[turnos.length - 1];
  if (!ultimo) return { seguir: true };
  if (ultimo.sinAcciones) return { seguir: false, convergio: true, motivo: "sin_acciones" };
  const anterior = turnos[turnos.length - 2];
  if (ultimo.soloConsulta) return anterior?.soloConsulta ? { seguir: false, convergio: false, motivo: "solo_consulta" } : { seguir: true };
  const antes = anterior ? anterior.proporciones : base;
  if (ultimo.proporciones !== null && antes !== null) {
    if (ultimo.proporciones < antes) return { seguir: false, convergio: false, motivo: "regresion" };
    if (ultimo.proporciones - antes < MEJORA_MINIMA) return { seguir: false, convergio: true, motivo: "sin_mejora" };
  }
  return { seguir: true };
}
