import type { Rechazo, Similitud, Veredicto } from "./motivos";

/**
 * La decisión de aceptar o no una ronda de refinado (REQ-001 paso 9, P-016): la estructura no empeoró (ver `estructura.ts`) y
 * la escena de después se parece a la foto más que la de antes por al menos `MARGEN_MEJORA`. La similitud la calcula el
 * servidor con embeddings de imagen (`similitud-servidor.ts`).
 */

/**
 * Cuánto más tiene que parecerse la captura de después a la foto que la de antes (coseno de gemini-embedding-2).
 * Procedencia: `scripts/exp/calibrar-margen-refinado.ts` (ver el informe en el comentario de `MARGEN_CALIBRADO` más abajo).
 */
export const MARGEN_MEJORA = 0.01;

/** Tolerancia del punto flotante: una mejora que cae justo en el margen cuenta como que lo alcanza. */
const EPSILON = 1e-9;

export type Decision = { aceptada: true; similitud: Similitud } | { aceptada: false; rechazo: Rechazo; similitud: Similitud | null };

/** Se acepta solo si la estructura no empeoró y la mejora de parecido llega al margen (la mejora exacta en el margen se acepta). */
export function decidirAceptacion(similitud: Similitud | null, estructura: Rechazo | null): Decision {
  if (estructura) return { aceptada: false, rechazo: estructura, similitud };
  if (!similitud) return { aceptada: false, rechazo: { motivo: "sin_comparacion", detalle: "no se pudo comparar la imagen con la foto" }, similitud };
  const mejora = mejoraDe(similitud);
  if (mejora < MARGEN_MEJORA - EPSILON) {
    return { aceptada: false, rechazo: { motivo: "no_mejora", detalle: `se parece ${mejora >= 0 ? "apenas más" : "menos"} a la foto: ${similitud.antes.toFixed(3)} → ${similitud.despues.toFixed(3)}` }, similitud };
  }
  return { aceptada: true, similitud };
}

/** Cuánto más se parece la escena de después a la foto que la de antes (negativo si se parece menos). */
export const mejoraDe = (s: Similitud): number => s.despues - s.antes;

/** Lo que el servidor le devuelve al navegador de una decisión (sin el detalle con números). */
export function veredictoDe(d: Decision, costeEstimadoUsd: number): Veredicto {
  return { aceptada: d.aceptada, motivo: d.aceptada ? null : d.rechazo.motivo, similitud: d.similitud, costeEstimadoUsd };
}

/** El coseno de dos vectores (los de gemini-embedding-2 ya vienen normalizados, pero no se asume). Lanza si no tienen la misma dimensión. */
export function coseno(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) throw new RangeError(`Vectores de distinta dimensión: ${a.length} y ${b.length}.`);
  let punto = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { punto += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]!; }
  return na && nb ? punto / Math.sqrt(na * nb) : 0;
}
