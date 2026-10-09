import type { CajaDetectada } from "./medir-geometria";

/**
 * **El mosaico con que se detectan los globos** (`detectar-globos-ia.ts`): la foto se parte en 3 × 3 trozos con solape y las
 * cajas que vuelven de cada trozo se funden en una sola lista. Puro y sin red.
 *
 * Un globo cortado por el borde de su trozo sale como una caja a medias (un «medio globo» falso) y, si está en el solape, también
 * entero desde el trozo de al lado. Se funden las cajas repetidas (IoU alto) y se descartan los fragmentos pegados a un borde
 * interno de trozo que están dentro de otra caja más completa.
 */

export const LADOS_MOSAICO = 3;
export const SOLAPE_MOSAICO = 0.15;
/** Dos cajas con tanta intersección sobre su unión son el mismo globo. */
export const IOU_REPETIDA = 0.4;
/** Una caja pegada a un borde interno de trozo es un fragmento si tanta parte de su área está dentro de otra más grande. */
export const CONTENIDA_EN_OTRA = 0.5;
/** Cuánto (en milésimas de la foto) puede separarse el lado de una caja del borde de su trozo para decir que lo toca. */
export const TOLERANCIA_BORDE = 8;

export type Trozo = { x0: number; y0: number; x1: number; y1: number };

const area = (q: readonly number[]) => (q[2]! - q[0]!) * (q[3]! - q[1]!);
const interseccion = (a: readonly number[], b: readonly number[]) => Math.max(0, Math.min(a[2]!, b[2]!) - Math.max(a[0]!, b[0]!)) * Math.max(0, Math.min(a[3]!, b[3]!) - Math.max(a[1]!, b[1]!));
const iou = (a: readonly number[], b: readonly number[]) => { const i = interseccion(a, b); return i / (area(a) + area(b) - i || 1); };

/** Los trozos del mosaico (fracciones de la foto), con solape. */
export function trozosDelMosaico(lados = LADOS_MOSAICO, solape = SOLAPE_MOSAICO): Trozo[] {
  const paso = 1 / lados;
  return Array.from({ length: lados * lados }, (_, k) => {
    const i = Math.floor(k / lados), j = k % lados;
    return { x0: Math.max(0, j * paso - solape / 2), x1: Math.min(1, (j + 1) * paso + solape / 2), y0: Math.max(0, i * paso - solape / 2), y1: Math.min(1, (i + 1) * paso + solape / 2) };
  });
}

/** Las líneas (milésimas) de los bordes de trozo que quedan dentro de la foto: x e y por separado. */
function bordesInternos(trozos: readonly Trozo[]): { xs: number[]; ys: number[] } {
  const xs = new Set<number>(), ys = new Set<number>();
  for (const t of trozos) {
    if (t.x0 > 0) xs.add(t.x0 * 1000);
    if (t.x1 < 1) xs.add(t.x1 * 1000);
    if (t.y0 > 0) ys.add(t.y0 * 1000);
    if (t.y1 < 1) ys.add(t.y1 * 1000);
  }
  return { xs: [...xs], ys: [...ys] };
}

/** ¿Algún lado de la caja ([ymin, xmin, ymax, xmax]) toca un borde interno de trozo? */
export function tocaBordeDeTrozo(caja: readonly number[], trozos: readonly Trozo[]): boolean {
  const { xs, ys } = bordesInternos(trozos);
  const cerca = (v: number, lineas: readonly number[]) => lineas.some((l) => Math.abs(v - l) <= TOLERANCIA_BORDE);
  return cerca(caja[1]!, xs) || cerca(caja[3]!, xs) || cerca(caja[0]!, ys) || cerca(caja[2]!, ys);
}

/**
 * Funde las cajas del mosaico: de mayor a menor, se queda la primera de cada grupo de repetidas, y se descartan los fragmentos
 * (cajas pegadas a un borde de trozo cuya área está en su mayor parte dentro de una caja ya conservada, más completa).
 */
export function fundirRepetidas<T extends CajaDetectada>(globos: readonly T[], trozos: readonly Trozo[] = trozosDelMosaico()): T[] {
  const salida: T[] = [];
  for (const g of [...globos].sort((a, b) => area(b.box_2d) - area(a.box_2d))) {
    const repetida = salida.some((f) => iou(g.box_2d, f.box_2d) >= IOU_REPETIDA);
    const fragmento = !repetida && tocaBordeDeTrozo(g.box_2d, trozos) && salida.some((f) => area(g.box_2d) > 0 && interseccion(g.box_2d, f.box_2d) / area(g.box_2d) >= CONTENIDA_EN_OTRA);
    if (!repetida && !fragmento) salida.push(g);
  }
  return salida;
}

