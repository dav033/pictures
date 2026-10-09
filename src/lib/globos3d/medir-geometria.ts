/**
 * **Geometría de la medición con los globos detectados** (`medir-con-detecciones.ts`): las cajas pasadas a globos en
 * unidades de ALTO de la foto, la proyección de un punto sobre un eje, el eje de una guirnalda con los puntos que leyó el
 * modelo (más los que hagan falta en los tramos largos) y las estadísticas de una dimensión. Puro.
 */

export type P = { x: number; y: number };
/** Un globo detectado: centro, diámetro (el lado mayor de su caja) y medidas de su caja en unidades de alto de la foto (x también: x × aspecto), y el nombre de su color. */
export type Globo = { x: number; y: number; d: number; w: number; h: number; color: string };
export type CajaDetectada = { box_2d: readonly [number, number, number, number] | readonly number[]; color: string };

/** Un punto del eje: su sitio (x en unidades de alto) y el índice del punto leído de que viene (null: agregado en un tramo largo). */
export type PuntoEje = P & { origen: number | null };

/** Un tramo del eje más largo que esta fracción del recorrido (o que 1,5 grosores) se parte para medirlo con más de un punto. */
const FRACCION_TRAMO_LARGO = 0.2;
const GROSORES_TRAMO_LARGO = 1.5;
/** El esquema de la lectura admite hasta 24 puntos por guirnalda. */
export const MAXIMO_PUNTOS_EJE = 24;

export const r3 = (n: number) => Math.round(n * 1000) / 1000;
export const mediana = (v: readonly number[]) => { const s = [...v].sort((a, b) => a - b); const k = Math.floor(s.length / 2); return s.length % 2 ? s[k]! : (s[k - 1]! + s[k]!) / 2; };
export const percentil = (v: readonly number[], p: number) => { const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]!; };

/** Los globos en unidades de ALTO de la foto, con su diámetro; las cajas que no son cajas se descartan. */
export function globosDe(det: readonly CajaDetectada[], aspecto: number): Globo[] {
  return det.flatMap((g) => {
    const [y0, x0, y1, x1] = g.box_2d as readonly number[];
    if (![y0, x0, y1, x1].every((n) => Number.isFinite(n)) || y1! <= y0! || x1! <= x0!) return [];
    const h = (y1! - y0!) / 1000, w = ((x1! - x0!) / 1000) * aspecto;
    // Un globo tapado a medias deja una caja angosta: su diámetro es el lado mayor.
    return [{ x: ((x0! + x1!) / 2 / 1000) * aspecto, y: (y0! + y1!) / 2 / 1000, d: Math.max(h, w), w, h, color: g.color }];
  });
}

/** El recorrido acumulado de cada punto del eje (0 en el primero). */
export const largosDelEje = (eje: readonly P[]): number[] => {
  const largos = [0];
  for (let i = 1; i < eje.length; i++) largos.push(largos[i - 1]! + Math.hypot(eje[i]!.x - eje[i - 1]!.x, eje[i]!.y - eje[i - 1]!.y));
  return largos;
};


/** El punto más cercano de una polilínea, su distancia, la fracción del recorrido y la normal del tramo. */
export function proyectar(p: P, eje: readonly P[]): { d: number; q: P; t: number; normal: P } {
  const largos = largosDelEje(eje);
  const total = largos[largos.length - 1]! || 1;
  let mejor = { d: Infinity, q: eje[0]!, t: 0, normal: { x: 0, y: -1 } };
  for (let i = 1; i < eje.length; i++) {
    const a = eje[i - 1]!, b = eje[i]!;
    const vx = b.x - a.x, vy = b.y - a.y, l2 = vx * vx + vy * vy || 1e-9;
    const u = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2));
    const q = { x: a.x + vx * u, y: a.y + vy * u };
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < mejor.d) { const l = Math.sqrt(l2); mejor = { d, q, t: (largos[i - 1]! + u * l) / total, normal: { x: -vy / l, y: vx / l } }; }
  }
  return mejor;
}

/**
 * El eje a medir: los puntos que leyó el modelo (con sus esquinas) y, en cada tramo más largo que `FRACCION_TRAMO_LARGO` del
 * recorrido, puntos intermedios parejos hasta `MAXIMO_PUNTOS_EJE`. Los puntos del modelo se miden donde él los puso; remuestrear
 * a puntos parejos borraba las esquinas de un arco.
 */
export function ejeMedido(puntos: ReadonlyArray<P & { grosor: number }>, aspecto: number): PuntoEje[] {
  let eje: PuntoEje[] = puntos.map((q, i) => ({ x: q.x * aspecto, y: q.y, origen: i }));
  const largos = largosDelEje(eje);
  const total = largos[largos.length - 1]!;
  const maximo = Math.max(total * FRACCION_TRAMO_LARGO, GROSORES_TRAMO_LARGO * mediana(puntos.map((q) => q.grosor)));
  for (;;) {
    if (eje.length >= MAXIMO_PUNTOS_EJE) break;
    const ls = largosDelEje(eje);
    let k = -1, mayor = maximo;
    for (let i = 1; i < eje.length; i++) { const l = ls[i]! - ls[i - 1]!; if (l > mayor) { mayor = l; k = i; } }
    if (k < 0) break;
    const a = eje[k - 1]!, b = eje[k]!;
    eje = [...eje.slice(0, k), { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, origen: null }, ...eje.slice(k)];
  }
  return eje;
}

/** La normal del eje en su punto `i`: el promedio de la de los tramos que lo tocan. */
export function normalEnPunto(eje: readonly P[], i: number): P {
  const tramo = (a: P, b: P) => { const l = Math.hypot(b.x - a.x, b.y - a.y) || 1; return { x: -(b.y - a.y) / l, y: (b.x - a.x) / l }; };
  const normales = [i > 0 ? tramo(eje[i - 1]!, eje[i]!) : null, i < eje.length - 1 ? tramo(eje[i]!, eje[i + 1]!) : null].filter((n): n is P => n !== null);
  const x = normales.reduce((s, n) => s + n.x, 0), y = normales.reduce((s, n) => s + n.y, 0);
  const l = Math.hypot(x, y);
  return l > 1e-9 ? { x: x / l, y: y / l } : normales[0] ?? { x: 0, y: -1 };
}

/**
 * k-medias en una dimensión (log del diámetro); centros de menor a mayor. Los centros iniciales salen del punto más lejano de los
 * que ya hay (empezando por la mediana): con cuantiles, un escalón raro (tres gigantes entre setenta globos) no recibía centro y
 * dos centros caían en el mismo escalón común.
 */
export function kMedias1D(v: readonly number[], k: number): number[] {
  let centros = [mediana(v)];
  while (centros.length < k) {
    const lejano = v.reduce((m, x) => (Math.min(...centros.map((c) => Math.abs(x - c))) > Math.min(...centros.map((c) => Math.abs(m - c))) ? x : m), v[0]!);
    centros.push(lejano);
  }
  for (let it = 0; it < 30; it++) {
    const grupos: number[][] = centros.map(() => []);
    for (const x of v) grupos[centros.reduce((m, c, i) => (Math.abs(x - c) < Math.abs(x - centros[m]!) ? i : m), 0)]!.push(x);
    centros = grupos.map((g, i) => (g.length ? g.reduce((s, x) => s + x, 0) / g.length : centros[i]!));
  }
  return centros.sort((a, b) => a - b);
}
