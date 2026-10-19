import type { GloboDetectado } from "./medir-con-detecciones";

/**
 * **Las cajas de la detección que pueden ser un racimo entero y no un globo.** En una foto con racimos apretados (racimos de
 * R-5 sobre un aro) el detector a veces encierra el racimo entero en una sola caja: la medición la toma por un globo gigante
 * (un racimo dorado de 0,21 del alto salió como un R-36 de 86 cm) y la pieza se llena de gigantes que no hay. La regla de
 * «entero» no lo ve cuando dentro de la caja no se detectó ningún otro globo. Aquí, sin modelo, las cajas que se salen del
 * tamaño de las demás: esas se le enseñan a la IA recortadas para que diga si son un globo o varios (`detectar-globos-ia.ts`).
 */

/** Una caja es sospechosa si su lado mayor pasa de esta vez la mediana de las cajas. */
export const RAZON_SOSPECHOSA = 1.8;
/** Y si mide al menos esta fracción de la foto (una caja chica nunca es un racimo que importe). */
const LADO_MINIMO_SOSPECHOSA = 0.06;
/** Cuántas se enseñan a la IA como mucho (las más grandes): una sola llamada con unos pocos recortes. */
export const MAXIMO_SOSPECHOSAS = 8;
/** Margen alrededor de la caja al recortarla, en fracción de su lado: se ve el borde y si hay globos pegados. */
export const MARGEN_RECORTE = 0.12;

const lado = (g: GloboDetectado) => { const [a = 0, b = 0, c = 0, d = 0] = g.box_2d; return Math.max(c - a, d - b) / 1000; };

/** Los índices de las cajas sospechosas, de la más grande a la más chica. */
export function cajasSospechosas(globos: readonly GloboDetectado[]): number[] {
  if (globos.length < 4) return [];
  const lados = globos.map(lado);
  const orden = [...lados].sort((a, b) => a - b);
  const mediana = orden[Math.floor(orden.length / 2)]!;
  return lados
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => l >= LADO_MINIMO_SOSPECHOSA && l > RAZON_SOSPECHOSA * mediana)
    .sort((a, b) => b.l - a.l)
    .slice(0, MAXIMO_SOSPECHOSAS)
    .map(({ i }) => i);
}

/** El recorte (fracciones de la foto, 0–1) de una caja con su margen, sin salirse de la foto. */
export function recorteDeCaja(g: GloboDetectado): { x0: number; y0: number; x1: number; y1: number } {
  const [a = 0, b = 0, c = 0, d = 0] = g.box_2d.map((n) => n / 1000);
  const m = Math.max(c - a, d - b) * MARGEN_RECORTE;
  return { x0: Math.max(0, b - m), y0: Math.max(0, a - m), x1: Math.min(1, d + m), y1: Math.min(1, c + m) };
}
