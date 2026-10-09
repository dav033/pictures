import type * as THREE from "three";

/**
 * El entorno que reflejan los metalizados, el cromado y el metal (ver `escena-globos.ts`). Cada visor genera el suyo con su
 * propio renderer y lo libera al destruirse, y las fábricas de materiales son funciones de módulo que leen «el entorno de
 * ahora»: con un solo valor global, la captura fuera de pantalla del refinado (`captura-refinar.ts`) lo pisaba al crearse y
 * lo dejaba liberado al destruirse, y todo foil, cromado o metal que el visor del taller creaba DESPUÉS (el «Love»
 * dorado que cambia una ronda) se pintaba con un mapa liberado: negro. Aquí cada visor se registra al crearse y se
 * da de baja al destruirse; el entorno de ahora es el del visor más reciente que sigue vivo.
 */

const vivos: THREE.Texture[] = [];

export function registrarEntornoMetal(entorno: THREE.Texture): void {
  vivos.push(entorno);
}

export function soltarEntornoMetal(entorno: THREE.Texture): void {
  const i = vivos.lastIndexOf(entorno);
  if (i >= 0) vivos.splice(i, 1);
}

/** El entorno del visor vivo más reciente; `null` si no hay ninguno. */
export function entornoMetal(): THREE.Texture | null {
  return vivos[vivos.length - 1] ?? null;
}
