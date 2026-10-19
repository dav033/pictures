import { filaEnBlanco, type FilaCosto } from "./borrador-profesional";

/**
 * Quitar un gasto no debe perder lo que alguien escribió sin remedio: si la
 * fila tenía algo, se guarda dónde estaba para poder devolverla. Una fila en
 * blanco se quita sin más (no hay nada que recuperar). Sin React.
 */

export type FilaQuitada = { fila: FilaCosto; indice: number };

export function quitarConRastro(filas: readonly FilaCosto[], id: string): { filas: FilaCosto[]; quitada: FilaQuitada | null } {
  const indice = filas.findIndex((fila) => fila.id === id);
  if (indice < 0) return { filas: [...filas], quitada: null };
  const fila = filas[indice]!;
  return { filas: filas.filter((otra) => otra.id !== id), quitada: filaEnBlanco(fila) ? null : { fila, indice } };
}

/** La fila vuelve a su sitio (o al final si la lista ya es más corta). No duplica una que ya volvió. */
export function reponerFila(filas: readonly FilaCosto[], quitada: FilaQuitada): FilaCosto[] {
  if (filas.some((fila) => fila.id === quitada.fila.id)) return [...filas];
  const copia = [...filas];
  copia.splice(Math.min(quitada.indice, copia.length), 0, quitada.fila);
  return copia;
}
