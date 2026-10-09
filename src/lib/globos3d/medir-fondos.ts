import { esTelon } from "./fondos-escenografia";
import { mismaFamiliaDeFondo } from "./fondos-familias";
import type { PiezaLeida } from "./lectura-foto";

/**
 * **Los fondos y muebles de la lectura puestos en su caja detectada** (`detectarFondos`, `detectar-globos-ia.ts`): el lector
 * mide a ojo una pared de lentejuelas, un panel redondo o una mesa (una pared de 0,42 del ancho la leyó de 0,55) y la
 * detección da la caja del objeto entero. Aquí cada pieza `fondo` toma el sitio y el tamaño de la caja del mismo id que más se
 * le parece: primero la del mismo id y, si no hay, la de su familia (`fondos-familias.ts`: «mesa_mantel» y «mesa_postres_mantel»
 * son la misma mesa para el ojo). Una fila de varias piezas (`cantidad` > 1: sillas) toma la unión de las cajas que la cubren, no una sola. Puro.
 */

/** Un fondo o mueble del catálogo detectado en la foto: su caja (0-1000: ymin, xmin, ymax, xmax) y su id. */
export type FondoDetectado = { box_2d: readonly number[]; id: string };

/** Una caja detectada solo vale por la pieza si se solapa con ella (IoU) o sus centros están a menos de esto (fracción del alto de la foto). */
const IOU_MINIMO = 0.1;
const CENTROS_MAXIMOS = 0.25;
/** Una sola caja no vale por una fila de piezas si es más angosta que esta fracción de lo leído: sería una sola silla de la fila. */
const FRACCION_DE_FILA = 0.6;
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

type Fondo = Extract<PiezaLeida, { tipo: "fondo" }>;
type Candidata = { f: FondoDetectado; caja: Caja; centros: number };
const cruce = (a: Caja, b: Caja) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

/** Las cajas sin usar que valen por la pieza (la que más se le parece primero), del mismo id o, con `familia`, de su familia. */
function candidatasDe(p: Fondo, leida: Caja, fondos: readonly FondoDetectado[], usados: ReadonlySet<FondoDetectado>, aspecto: number, familia: boolean): Candidata[] {
  return fondos.filter((f) => !usados.has(f) && (familia ? mismaFamiliaDeFondo(f.id, p.id) : f.id === p.id)).flatMap((f): Candidata[] => {
    const caja = cajaDeDeteccion(f, aspecto);
    if (!caja) return [];
    const centros = Math.hypot((caja.x0 + caja.x1) / 2 - (leida.x0 + leida.x1) / 2, (caja.y0 + caja.y1) / 2 - (leida.y0 + leida.y1) / 2);
    return iou(leida, caja) >= IOU_MINIMO || centros <= CENTROS_MAXIMOS ? [{ f, caja, centros }] : [];
  }).sort((a, b) => a.centros - b.centros);
}

/** Las cajas que valen por la pieza: la mejor o, en una fila (`cantidad` > 1), todas las que cubren lo leído; `null` si no hay (o si una sola no cubre la fila). */
function cajasDe(p: Fondo, leida: Caja, candidatas: readonly Candidata[]): Candidata[] | null {
  const mejor = candidatas[0];
  if (!mejor) return null;
  if ((p.cantidad ?? 1) <= 1 && !JUEGOS.has(p.id)) return [mejor];
  const grupo = candidatas.filter((c) => c === mejor || cruce(c.caja, leida) > 0);
  if (grupo.length === 1 && mejor.caja.x1 - mejor.caja.x0 < FRACCION_DE_FILA * (leida.x1 - leida.x0)) return null;
  return grupo;
}

/** Los fondos que son un juego de varios cuerpos (los pedestales): se guarda la caja de cada uno, no solo la unión. */
const JUEGOS = new Set(["pedestales"]);

/** Una caja detectada que no llega a esta parte de lo leído (de ancho o de alto) es solo un pedazo del fondo. */
const PARTE_MINIMA_DE_LO_LEIDO = 0.4;

export function medirFondos(piezas: readonly PiezaLeida[], fondos: readonly FondoDetectado[], aspecto: number): { piezas: PiezaLeida[]; notas: string[] } {
  const usados = new Set<FondoDetectado>();
  const salida: PiezaLeida[] = [...piezas];
  const notaDe = new Map<number, string>();
  // Primero cada pieza con las cajas de su mismo id; las que quedan sin caja, con las de su familia.
  const sinCaja = new Set(piezas.flatMap((p, i) => (p.tipo === "fondo" ? [i] : [])));
  for (const familia of [false, true]) {
    for (const i of [...sinCaja]) {
      const p = piezas[i] as Fondo;
      const leida: Caja = { x0: (p.x * aspecto) - p.ancho / 2, x1: (p.x * aspecto) + p.ancho / 2, y0: p.yBase - p.alto, y1: p.yBase };
      const cajas = cajasDe(p, leida, candidatasDe(p, leida, fondos, usados, aspecto, familia));
      if (!cajas) continue;
      cajas.forEach((c) => usados.add(c.f));
      const union = { x0: Math.min(...cajas.map((c) => c.caja.x0)), x1: Math.max(...cajas.map((c) => c.caja.x1)), y0: Math.min(...cajas.map((c) => c.caja.y0)), y1: Math.max(...cajas.map((c) => c.caja.y1)) };
      // Una caja mucho menor que lo leído puede ser un pedazo (el pie de un aro que los globos tapan, una de las mesas del
      // juego) o lo leído a ojo exagerado (una mesa leída 2,5 veces más grande). Es un pedazo si se quedó corta en UNA sola
      // medida, o si el fondo es un telón (aro, arco, marco: los globos lo tapan casi siempre); entonces se queda lo
      // leído antes que encoger el fondo hasta esconderlo. Si se quedó corta en las dos y no es un telón, manda la caja.
      const cortoAncho = union.x1 - union.x0 < PARTE_MINIMA_DE_LO_LEIDO * p.ancho, cortoAlto = union.y1 - union.y0 < PARTE_MINIMA_DE_LO_LEIDO * p.alto;
      if ((cortoAncho !== cortoAlto) || ((cortoAncho || cortoAlto) && esTelon(p.id))) {
        sinCaja.delete(i);
        notaDe.set(i, `«${p.id}»: la caja detectada (${r3(union.x1 - union.x0)} × ${r3(union.y1 - union.y0)}) es un pedazo de lo leído (${p.ancho} × ${p.alto}): se queda lo leído.`);
        continue;
      }
      const nueva: Fondo = { ...p, x: r3(entre((union.x0 + union.x1) / 2 / aspecto, -0.2, 1.2)), yBase: r3(entre(union.y1, -0.2, 1.2)), ancho: r3(entre(union.x1 - union.x0, 0.005, 2)), alto: r3(entre(union.y1 - union.y0, 0.005, 2)) };
      // Un juego (los pedestales) conserva el sitio, el pie y el tamaño de cada cuerpo, de izquierda a derecha.
      const cuerpos = JUEGOS.has(p.id) ? [...cajas].sort((a, b) => a.caja.x0 - b.caja.x0).map((c) => ({ x: r3(entre((c.caja.x0 + c.caja.x1) / 2 / aspecto, -0.2, 1.2)), yBase: r3(entre(c.caja.y1, -0.2, 1.2)), ancho: r3(entre(c.caja.x1 - c.caja.x0, 0.005, 2)), alto: r3(entre(c.caja.y1 - c.caja.y0, 0.005, 2)) })) : [];
      if (cuerpos.length) nueva.cajas = cuerpos; else delete nueva.cajas;
      salida[i] = nueva;
      sinCaja.delete(i);
      const deFamilia = cajas.some((c) => c.f.id !== p.id) ? ` (detectado como «${cajas[0]!.f.id}»)` : "";
      notaDe.set(i, `«${p.id}» puesto en la caja detectada${deFamilia}${cajas.length > 1 ? ` (${cajas.length} cajas)` : ""}: ancho ${nueva.ancho} (leído ${p.ancho}), alto ${nueva.alto} (leído ${p.alto}).`);
    }
  }
  return { piezas: salida, notas: [...notaDe.entries()].sort((a, b) => a[0] - b[0]).map(([, n]) => n) };
}
