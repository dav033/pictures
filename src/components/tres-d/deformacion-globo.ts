import * as THREE from "three";

/**
 * El látex de verdad no es una esfera perfecta: cada globo sale un poco apretado o alargado. Solo se aplica al dibujar
 * (no cambia posiciones ni cantidades del motor): una escala suave en el marco del globo, con el nudo (el origen del
 * marco) fijo, que es donde el motor lo amarra.
 */

/** Cuánto varía el alto de un globo (±6 %); el ancho va al revés, a menos de la mitad, y cada lado un poco distinto. */
const VARIACION_ALTO = 0.12;

type Punto = { x: number; y: number; z: number };

/**
 * Hash de 32 bits de lo que identifica a un globo DENTRO de su pieza: la pieza (su id), su lugar respecto al punto de
 * referencia de la pieza (no su lugar en la sala: mover la pieza no lo cambia), su tamaño y su formato. Así el globo se ve
 * igual al arrastrar la pieza, al recargar y en la captura.
 */
function semillaDe(nodoId: string, relativoCm: Punto, infladoCm: number, formatoId: string): number {
  let h = 0x811c9dc5;
  // Cuantizado con un desfase raro: ningún valor «redondo» (12,25 cm…) cae justo en el borde y el ruido de coma flotante no lo cruza.
  const mezclar = (k: number) => { h = Math.imul(h ^ (Math.round(k + 0.1234) | 0), 16777619) >>> 0; };
  for (let i = 0; i < nodoId.length; i++) mezclar(nodoId.charCodeAt(i));
  mezclar(-1);
  mezclar(relativoCm.x * 2); mezclar(relativoCm.y * 2); mezclar(relativoCm.z * 2); mezclar(infladoCm * 4);
  for (let i = 0; i < formatoId.length; i++) mezclar(formatoId.charCodeAt(i));
  return h;
}

/** Azar determinista de una semilla. */
function azarDe(semilla: number): () => number {
  let x = semilla || 1;
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 100000) / 100000; };
}

/**
 * La escala (en el marco del globo; el nudo en el origen no se mueve) de un globo redondo de la pieza `nodoId`, cuya
 * referencia (el nudo de su primer globo) está en `referenciaCm`: la misma siempre para el mismo globo, aunque la pieza se
 * mueva de sitio.
 */
export function achatadoDe(nodoId: string, nudoCm: Punto, referenciaCm: Punto, infladoCm: number, formatoId: string): THREE.Matrix4 {
  const relativo = { x: nudoCm.x - referenciaCm.x, y: nudoCm.y - referenciaCm.y, z: nudoCm.z - referenciaCm.z };
  const r = azarDe(semillaDe(nodoId, relativo, infladoCm, formatoId));
  r(); r();
  const alto = 1 + (r() - 0.5) * VARIACION_ALTO;
  const ancho = 1 - (alto - 1) * 0.45;
  return new THREE.Matrix4().makeScale(ancho * (1 + (r() - 0.5) * 0.05), alto, ancho * (1 + (r() - 0.5) * 0.05));
}
