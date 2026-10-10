/**
 * Generador pseudoaleatorio con semilla para las pruebas de propiedades (sin dependencias: `fast-check` no está en el
 * proyecto). Mismo `semilla` → mismas secuencias, así que un fallo se reproduce con el número de caso que se imprime.
 */
export class Azar {
  private estado: number;

  constructor(semilla: number) {
    this.estado = semilla >>> 0;
  }

  /** mulberry32: un real en [0, 1). */
  real(): number {
    this.estado = (this.estado + 0x6d2b79f5) >>> 0;
    let t = this.estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Un entero en [minimo, maximo], ambos incluidos. */
  entero(minimo: number, maximo: number): number {
    return minimo + Math.floor(this.real() * (maximo - minimo + 1));
  }

  booleano(probabilidad = 0.5): boolean {
    return this.real() < probabilidad;
  }

  elegir<T>(opciones: readonly T[]): T {
    if (!opciones.length) throw new Error("Azar.elegir: lista vacía");
    return opciones[this.entero(0, opciones.length - 1)]!;
  }

  /** Un subconjunto no vacío de `opciones`, en su orden original. */
  subconjunto<T>(opciones: readonly T[], maximo: number): T[] {
    const elegidas = opciones.filter(() => this.booleano(0.5));
    if (!elegidas.length) return [this.elegir(opciones)];
    return elegidas.slice(0, maximo);
  }
}
