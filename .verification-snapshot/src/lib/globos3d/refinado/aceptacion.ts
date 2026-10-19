import type { Rechazo, Similitud, Veredicto } from "./motivos";

/**
 * La decisión de aceptar o no una ronda de refinado (REQ-001 paso 9, P-016): la estructura no empeoró (ver `estructura.ts`) y
 * la escena de después se parece a la foto más que la de antes por al menos `MARGEN_MEJORA`. La similitud la calcula el
 * servidor con embeddings de imagen (`similitud-servidor.ts`).
 */

/**
 * Cuánto más tiene que parecerse la captura de después a la foto que la de antes (coseno de gemini-embedding-2).
 *
 * Procedencia: `scripts/exp/calibrar-margen-refinado.ts`, corrida del 2026-10-09 con las fotos 4, 7, 9 y 12 del dueño y su
 * lectura a mano (92 embeddings, US$0,009):
 *  - Piso de ruido = 0. Cinco capturas de la misma escena, cada una con un navegador nuevo, salen byte por byte idénticas, y
 *    re-embeber los mismos bytes (foto y captura, 5 veces) da el mismo coseno. El margen no tiene que tapar ruido de render ni de
 *    la API; hay que tapar la falta de sensibilidad del embedding.
 *  - Curva de efecto (28 perturbaciones de signo conocido): cambiar el color dominante (Δ −0,03 a −0,08), quitar la pieza mayor
 *    (−0,05 y −0,11) y mover 100 cm (−0,02 a −0,04) bajan el parecido con claridad; mover 20 cm, achicar ×0,8, agregar una copia o
 *    quitar la pieza menor quedan entre −0,02 y +0,014 (signo al azar). Mover 50 cm SUBIÓ el parecido en 2 de 4 fotos (+0,013 y
 *    +0,026) y la monotonía 20 → 50 → 100 cm solo se cumple en 1 de 4: el embedding no distingue un desplazamiento chico.
 *  - Con 0,02 pasa 1 de 28 perturbaciones sin ser mejora (el desplazamiento de 50 cm de la foto 7, +0,026) y ninguna de las
 *    otras familias de signo al azar (su mayor ganancia falsa es +0,0137; 0,02 es 1,5 veces eso); deshacer 10 de 28
 *    perturbaciones (las visibles) sí pasa. Con 0,01 pasarían 3 de 28 falsas; con 0,03, ninguna pero solo 9 de 28 pasan.
 * Es un margen provisional: sin rondas etiquetadas por el dueño (paso 3 del protocolo, ver el pendiente) no se sabe cuántas
 * rondas buenas se pierden ni cuántas malas pasan, y por eso `RONDAS_AUTOMATICAS` está en 0.
 */
export const MARGEN_MEJORA = 0.02;

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
