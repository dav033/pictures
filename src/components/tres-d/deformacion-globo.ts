import * as THREE from "three";

/**
 * El látex de verdad no es una esfera perfecta: cada globo sale un poco apretado o alargado. Solo se aplica al dibujar
 * (no cambia posiciones ni cantidades del motor): una escala suave en el marco del globo, con el nudo (el origen del
 * marco) fijo, que es donde el motor lo amarra.
 */

/** Cuánto varía el alto de un globo (±6 %); el ancho va al revés, a menos de la mitad, y cada lado un poco distinto. */
const VARIACION_ALTO = 0.12;

/** Hash de 32 bits de lo que identifica a un globo (su nudo, su tamaño y su formato), no de su lugar en una lista. */
function semillaDe(nudoCm: { x: number; y: number; z: number }, infladoCm: number, formatoId: string): number {
  let h = 0x811c9dc5;
  const mezclar = (k: number) => { h = Math.imul(h ^ (Math.round(k) | 0), 16777619) >>> 0; };
  mezclar(nudoCm.x * 2); mezclar(nudoCm.y * 2); mezclar(nudoCm.z * 2); mezclar(infladoCm * 4);
  for (let i = 0; i < formatoId.length; i++) mezclar(formatoId.charCodeAt(i));
  return h;
}

/** Azar determinista de una semilla. */
function azarDe(semilla: number): () => number {
  let x = semilla || 1;
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 100000) / 100000; };
}

/** La escala (en el marco del globo; el nudo en el origen no se mueve) de un globo redondo: la misma siempre para el mismo globo. */
export function achatadoDe(nudoCm: { x: number; y: number; z: number }, infladoCm: number, formatoId: string): THREE.Matrix4 {
  const r = azarDe(semillaDe(nudoCm, infladoCm, formatoId));
  r(); r();
  const alto = 1 + (r() - 0.5) * VARIACION_ALTO;
  const ancho = 1 - (alto - 1) * 0.45;
  return new THREE.Matrix4().makeScale(ancho * (1 + (r() - 0.5) * 0.05), alto, ancho * (1 + (r() - 0.5) * 0.05));
}
