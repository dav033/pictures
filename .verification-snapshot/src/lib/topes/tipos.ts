export const VENTANA_TOPE_MS = 3_600_000;
/** Cuánto espera una toma a la base antes de seguir con el contador en memoria (el mismo plazo que la lectura de ajustes). */
export const PLAZO_TOPE_MS = 1_500;

/**
 * Con qué contador se tomó una unidad, para devolverla a ese mismo y no a otro: en la base, con la ventana (la hora) en que se
 * abrió; o en la memoria de la instancia. Una devolución a otra ventana o a otro contador regalaría o robaría un cupo.
 */
export type ReciboTope = { origen: "base"; ventana: string } | { origen: "memoria" };

export type ResultadoTope = { ok: true; usadas: number; recibo?: ReciboTope } | { ok: false; usadas: number; tope: number };
export type OrigenTope = "base" | "memoria";

/**
 * Lo mínimo de `pg`/PGlite que usa el tope: una consulta con parámetros. `plazoMs` es el tiempo que tiene en total (conexión
 * incluida); pasado ese plazo la consulta no debe llegar a ejecutarse, o contaría una toma que ya siguió en memoria.
 */
export type Consulta = (sql: string, valores: unknown[], plazoMs?: number) => Promise<{ rows: Array<Record<string, unknown>> }>;

/** `null`: no hay base contra la que contar (fuera de producción, o apagado): se cuenta en memoria sin avisar de nada. */
export type ProveedorDeConsulta = () => Promise<Consulta | null>;

export class PlazoDeTopeVencido extends Error {
  constructor(plazoMs: number) {
    super(`la base no respondió al tope en ${plazoMs} ms`);
    this.name = "PlazoDeTopeVencido";
  }
}
