/**
 * Azar determinista para la matriz de escenarios: mulberry32, una semilla de 32 bits, la misma secuencia en cualquier máquina.
 * Sin dependencias (fast-check no está en el proyecto). Cada escenario toma su propia semilla derivada (`semillaDeEscenario`),
 * así se puede regenerar UN escenario sin recorrer los anteriores.
 */
export type Azar = {
  /** Un número en [0, 1). */
  siguiente(): number;
  /** Un entero en [min, max] (ambos incluidos). */
  entero(min: number, max: number): number;
  /** Un valor de la lista, con la misma probabilidad. */
  elegir<T>(lista: readonly T[]): T;
  /** Verdadero con probabilidad `p`. */
  probar(p: number): boolean;
};

export function crearAzar(semilla: number): Azar {
  let estado = semilla >>> 0;
  const siguiente = (): number => {
    estado = (estado + 0x6d2b79f5) >>> 0;
    let t = estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    siguiente,
    entero: (min, max) => min + Math.floor(siguiente() * (max - min + 1)),
    elegir: (lista) => lista[Math.floor(siguiente() * lista.length)]!,
    probar: (p) => siguiente() < p,
  };
}

/** La semilla de un escenario: la base del lote mezclada con su índice (32 bits). */
export function semillaDeEscenario(semillaBase: number, indice: number): number {
  return (Math.imul(semillaBase >>> 0, 0x9e3779b1) ^ Math.imul(indice + 1, 0x85ebca6b)) >>> 0;
}
