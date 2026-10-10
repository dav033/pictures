/**
 * Qué globos armados se ven desde la cámara de la foto. `armadoDeEscenaEnLaFoto` proyecta TODOS los globos del volumen 3D: una guirnalda
 * gruesa tiene 2 o 3 capas y la foto solo muestra la de delante (con 58 % de relleno, 295 globos armados contra ~100 visibles). Comparar lo
 * armado entero con lo detectado hace ver una guirnalda de tamaño justo 2 a 7 veces pasada.
 *
 * Prueba de oclusión (pura, sin cámara): un disco `j` tapa al `i` si está más cerca de la cámara por más de `TOLERANCIA_PROFUNDIDAD` veces el
 * diámetro de `i` (los de una misma capa, a profundidades parecidas, se solapan de lado sin taparse). Del área de `i` se toman
 * `MUESTRAS_POR_DISCO` puntos (el centro y dos anillos); la fracción tapada es la de puntos dentro de algún disco más cercano. Un globo se cuenta
 * visible si le queda sin tapar al menos `VISIBLE_MINIMO` de su área (se descartan los tapados en más del 60 %).
 */
import type { Disco } from "./lib-proporciones";

/** Un disco tapa a otro si está más cerca de la cámara que él en más de esta fracción del diámetro del tapado (en cm de profundidad). */
export const TOLERANCIA_PROFUNDIDAD = 0.5;
/** Fracción mínima del área de un globo que queda a la vista para contarlo (1 − 60 % tapado). */
export const VISIBLE_MINIMO = 0.4;

/** El centro, un anillo interior de 6 puntos (a 0,35 r) y uno exterior de 8 (a 0,75 r): 15 muestras de área casi uniforme. */
const MUESTRAS_POR_DISCO: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  ...Array.from({ length: 6 }, (_, k): [number, number] => [0.35 * Math.cos((k / 6) * 2 * Math.PI), 0.35 * Math.sin((k / 6) * 2 * Math.PI)]),
  ...Array.from({ length: 8 }, (_, k): [number, number] => [0.75 * Math.cos(((k + 0.5) / 8) * 2 * Math.PI), 0.75 * Math.sin(((k + 0.5) / 8) * 2 * Math.PI)]),
];

/** Un disco con su profundidad (cm hasta la cámara) y su diámetro real (cm): lo que hace falta para saber quién tapa a quién. */
export type DiscoConProfundidad = Disco & { prof: number; diametroCm: number };

/** La fracción (0 a 1) del área de cada disco que no tapan los más cercanos. */
export function fraccionVisible(discos: readonly DiscoConProfundidad[]): number[] {
  const orden = discos.map((_, i) => i).sort((a, b) => discos[a]!.prof - discos[b]!.prof);
  const visible = new Array<number>(discos.length).fill(1);
  orden.forEach((i, posicion) => {
    const d = discos[i]!;
    const limite = d.prof - TOLERANCIA_PROFUNDIDAD * d.diametroCm;
    const delante = orden.slice(0, posicion).map((j) => discos[j]!).filter((o) => o.prof < limite && Math.hypot(o.x - d.x, o.y - d.y) < o.r + d.r);
    if (!delante.length) return;
    const libres = MUESTRAS_POR_DISCO.filter(([dx, dy]) => {
      const px = d.x + dx * d.r, py = d.y + dy * d.r;
      return !delante.some((o) => Math.hypot(o.x - px, o.y - py) <= o.r);
    }).length;
    visible[i] = libres / MUESTRAS_POR_DISCO.length;
  });
  return visible;
}

/** Los discos que se ven (con al menos `VISIBLE_MINIMO` de su área sin tapar), en su orden. */
export function discosVisibles<T extends DiscoConProfundidad>(discos: readonly T[]): T[] {
  const f = fraccionVisible(discos);
  return discos.filter((_, i) => f[i]! >= VISIBLE_MINIMO);
}
