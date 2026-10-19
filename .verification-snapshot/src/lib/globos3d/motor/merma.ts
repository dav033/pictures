/**
 * La merma del plan: cuánto de más se compra sobre lo que el motor cuenta (globos que se revientan al inflar y montar).
 * Una sola constante, igual a `MERMA` de services/ai-api/app/merma.py (la política de compra, ADR-0034); una prueba la
 * compara con el archivo de Python. Se aplica antes de redondear a paquetes cerrados (REQ-007, ruling Q1):
 * `ceil(cantidad * (1 + MERMA))` por línea, con la misma aritmética de coma flotante que Python (`plan.py`, `contar`).
 */
export const MERMA = 0.08;
export const MERMA_PORCENTAJE = MERMA * 100;

export function cantidadConMerma(cantidad: number): number {
  return Math.ceil(cantidad * (1 + MERMA));
}
