/**
 * Tope de gasto de una pasada del arnés (USD). El coste de cada llamada sale de la telemetría del propio proveedor
 * (`costeEstimadoUsd` de la lectura de la foto y de cada vuelta del asistente), no de una estimación del arnés.
 * Puro: sin red ni reloj.
 */

export const TOPE_GASTO_POR_DEFECTO_USD = 1;

export class TopeGastoSuperado extends Error {
  constructor(readonly gastado: number, readonly tope: number) {
    super(`Tope de gasto de la pasada superado: ${gastado.toFixed(4)} USD con un tope de ${tope.toFixed(2)} USD. Se aborta la pasada.`);
    this.name = "TopeGastoSuperado";
  }
}

export class CupoGasto {
  private gastadoUsd = 0;

  constructor(readonly topeUsd: number) {
    if (!Number.isFinite(topeUsd) || topeUsd <= 0) throw new Error(`El tope de gasto debe ser un número positivo de USD (recibido: ${topeUsd}).`);
  }

  get gastado(): number {
    return this.gastadoUsd;
  }

  /** `true` mientras aún cabe otra llamada; falso cuando ya se llegó al tope (no se lanza nada). */
  hayMargen(): boolean {
    return this.gastadoUsd < this.topeUsd;
  }

  /** Suma el coste de una llamada ya hecha. Si la suma pasa del tope lanza `TopeGastoSuperado`: la pasada debe parar. */
  registrar(costeUsd: number): void {
    if (!Number.isFinite(costeUsd) || costeUsd < 0) throw new Error(`Coste no válido en la telemetría: ${costeUsd}.`);
    this.gastadoUsd += costeUsd;
    if (this.gastadoUsd > this.topeUsd) throw new TopeGastoSuperado(this.gastadoUsd, this.topeUsd);
  }
}

/** Lee el tope de `--tope-usd` o de `ENTRENAMIENTO_TOPE_USD` (el argumento gana); sin ninguno, el de por defecto. */
export function topeDesde(argumento: string | undefined, variable: string | undefined): number {
  const crudo = argumento ?? variable;
  if (crudo === undefined || crudo.trim() === "") return TOPE_GASTO_POR_DEFECTO_USD;
  const numero = Number(crudo);
  if (!Number.isFinite(numero) || numero <= 0) throw new Error(`Tope de gasto no válido: «${crudo}» (debe ser un número positivo en USD).`);
  return numero;
}
