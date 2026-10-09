import type { PiezaLeida } from "./lectura-foto";

/**
 * **Los fondos y muebles de la lectura puestos en su caja detectada** (`detectarFondos`, `detectar-globos-ia.ts`): el lector
 * mide a ojo una pared de lentejuelas, un panel redondo o una mesa (una pared de 0,42 del ancho la leyó de 0,55) y la
 * detección da la caja del objeto entero. Aquí cada pieza `fondo` toma el sitio y el tamaño de la caja del mismo id que más se
 * le parece. Puro.
 */

/** Un fondo o mueble del catálogo detectado en la foto: su caja (0-1000: ymin, xmin, ymax, xmax) y su id. */
export type FondoDetectado = { box_2d: readonly number[]; id: string };

/** Una caja detectada solo vale por la pieza si se solapa con ella (IoU) o sus centros están a menos de esto (fracción del alto de la foto). */
const IOU_MINIMO = 0.1;
const CENTROS_MAXIMOS = 0.25;
const entre = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const r3 = (n: number) => Math.round(n * 1000) / 1000;

type Caja = { x0: number; y0: number; x1: number; y1: number };
const iou = (a: Caja, b: Caja) => {
  const w = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)), h = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const area = (c: Caja) => (c.x1 - c.x0) * (c.y1 - c.y0);
  return (w * h) / (area(a) + area(b) - w * h || 1);
};

/** Las cajas en unidades de alto de la foto (x también: × aspecto). */
const cajaDeDeteccion = (f: FondoDetectado, aspecto: number): Caja | null => {
  const [y0, x0, y1, x1] = f.box_2d;
  if (![y0, x0, y1, x1].every((n) => Number.isFinite(n)) || y1! <= y0! || x1! <= x0!) return null;
  return { x0: (x0! / 1000) * aspecto, x1: (x1! / 1000) * aspecto, y0: y0! / 1000, y1: y1! / 1000 };
};

export function medirFondos(piezas: readonly PiezaLeida[], fondos: readonly FondoDetectado[], aspecto: number): { piezas: PiezaLeida[]; notas: string[] } {
  const notas: string[] = [];
  const usados = new Set<FondoDetectado>();
  const salida = piezas.map((p): PiezaLeida => {
    if (p.tipo !== "fondo") return p;
    const leida: Caja = { x0: (p.x * aspecto) - p.ancho / 2, x1: (p.x * aspecto) + p.ancho / 2, y0: p.yBase - p.alto, y1: p.yBase };
    const candidatas = fondos.filter((f) => f.id === p.id && !usados.has(f)).flatMap((f) => {
      const caja = cajaDeDeteccion(f, aspecto);
      if (!caja) return [];
      const centros = Math.hypot((caja.x0 + caja.x1) / 2 - (leida.x0 + leida.x1) / 2, (caja.y0 + caja.y1) / 2 - (leida.y0 + leida.y1) / 2);
      return iou(leida, caja) >= IOU_MINIMO || centros <= CENTROS_MAXIMOS ? [{ f, caja, centros }] : [];
    }).sort((a, b) => a.centros - b.centros);
    const mejor = candidatas[0];
    if (!mejor) return p;
    usados.add(mejor.f);
    const { caja } = mejor;
    const nueva = { ...p, x: r3(entre((caja.x0 + caja.x1) / 2 / aspecto, -0.2, 1.2)), yBase: r3(entre(caja.y1, -0.2, 1.2)), ancho: r3(entre(caja.x1 - caja.x0, 0.005, 2)), alto: r3(entre(caja.y1 - caja.y0, 0.005, 2)) };
    notas.push(`«${p.id}» puesto en la caja detectada: ancho ${nueva.ancho} (leído ${p.ancho}), alto ${nueva.alto} (leído ${p.alto}).`);
    return nueva;
  });
  return { piezas: salida, notas };
}
