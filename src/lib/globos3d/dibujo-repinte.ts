import type { GloboDecoracion } from "./decoraciones";
import { regionDeContorno, type ContornoForma } from "./formas";
import { centroDe } from "./letras";

/**
 * **Dibujo sobre una malla** (2026-10-08): una letra, un número o una figura (corazón, estrella…) pintado DENTRO de una
 * pared de globos —los globos que caen dentro del dibujo toman otro color—, como los letreros de las mallas de
 * Link-O-Loon y los murales de trenzas. Se guarda como la definición del dibujo (el contorno que usa `formas.ts` y su
 * centro como fracción de la pared), no como globos: así sigue valiendo si la pared se vuelve a armar o se agranda.
 * Lo aplica `aplicarRepintes` (repintes.ts) y lo pone `pintar_en_malla` (herramientas-escena-pintar.ts). Puro y sin red.
 */
export type DibujoRepinte = {
  contorno: ContornoForma;
  /** Dónde queda el centro del dibujo: fracción del ancho de la pared desde la izquierda (0–1). */
  fx: number;
  /** Fracción del alto de la pared desde abajo (0–1). */
  fy: number;
  /** Cuánto fuera del trazo todavía cuenta un globo (cm): el centro de un globo grande no cae justo sobre el trazo. */
  holguraCm: number;
};

/** La caja que ocupan los centros de los globos (la pared). */
export function cajaDeCentros(globos: readonly GloboDecoracion[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const g of globos) { const c = centroDe(g); minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x); minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y); }
  return globos.length ? { minX, minY, maxX, maxY } : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}

/** Los índices de los globos (de la lista dada) cuyo centro cae dentro del dibujo, puesto sobre la caja de la pared. */
export function indicesDentroDelDibujo(dibujo: DibujoRepinte, globos: readonly GloboDecoracion[], caja = cajaDeCentros(globos)): Set<number> {
  const region = regionDeContorno(dibujo.contorno);
  const cx = caja.minX + dibujo.fx * (caja.maxX - caja.minX), cy = caja.minY + dibujo.fy * (caja.maxY - caja.minY);
  const dx = cx - (region.caja.minX + region.caja.maxX) / 2, dy = cy - (region.caja.minY + region.caja.maxY) / 2;
  const dentro = new Set<number>();
  globos.forEach((g, i) => {
    const c = centroDe(g);
    if (region.distancia(c.x - dx, c.y - dy) >= -dibujo.holguraCm) dentro.add(i);
  });
  return dentro;
}
