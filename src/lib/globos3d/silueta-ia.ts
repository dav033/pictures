/**
 * Lo que FLUX necesita oír para no «completar» la decoración (2026-10-08, foto del dueño: una pata orgánica azul bajo
 * una guirnalda dorada salió como un marco cerrado con una segunda pata a la derecha que no existe):
 * - `contornoEnIngles`: la silueta de UNA pieza vista de frente, para cualquier forma (no solo arcos): columna de una sola
 *   pata, banda horizontal sin patas, arco completo, medio arco, columna con un pie que se abre por el piso, o la
 *   rejilla de 3 × 3 dicha en palabras cuando no es ninguna de esas;
 * - `huecosEnIngles`: el aire de la ESCENA, lo que no hay: bajo el extremo de una guirnalda o de un arco que no baja
 *   hasta el piso, la pared queda vacía; se dice dónde, para que FLUX no ponga allí una pata ni cierre un marco.
 * Puro: recibe globos (nudo, dirección, inflado) en coordenadas del mundo (x a la derecha, y hacia arriba).
 */

type P = { x: number; y: number; z: number };
export type GloboSilueta = { nudo: P; direccion: P; infladoCm: number };

const centro = (g: GloboSilueta) => ({ x: g.nudo.x + (g.direccion.x * g.infladoCm) / 2, y: g.nudo.y + (g.direccion.y * g.infladoCm) / 2, r: g.infladoCm / 2 });

/** Rejilla de ocupación vista de frente: celdas[fila][col], fila 0 abajo. Cuenta por globo (su centro). */
function rejilla(globos: readonly GloboSilueta[], cols: number, filas: number, caja?: { x0: number; x1: number; y0: number; y1: number }) {
  const cs = globos.map(centro);
  const x0 = caja?.x0 ?? Math.min(...cs.map((c) => c.x - c.r)), x1 = caja?.x1 ?? Math.max(...cs.map((c) => c.x + c.r));
  const y0 = caja?.y0 ?? Math.min(...cs.map((c) => c.y - c.r)), y1 = caja?.y1 ?? Math.max(...cs.map((c) => c.y + c.r));
  const celdas = Array.from({ length: filas }, () => Array.from({ length: cols }, () => 0));
  for (const c of cs) {
    const col = Math.max(0, Math.min(cols - 1, Math.floor(((c.x - x0) / Math.max(1, x1 - x0)) * cols)));
    const fila = Math.max(0, Math.min(filas - 1, Math.floor(((c.y - y0) / Math.max(1, y1 - y0)) * filas)));
    celdas[fila]![col]! += 1;
  }
  return { celdas, x0, x1, y0, y1 };
}

const LADO = ["left", "center", "right"] as const;
const FILA = ["bottom", "middle", "top"] as const;

export function contornoEnIngles(globos: readonly GloboSilueta[]): string {
  if (globos.length < 12) return "";
  const { celdas, x0, x1, y0, y1 } = rejilla(globos, 3, 3);
  const ancho = x1 - x0, alto = y1 - y0;
  if (ancho < alto * 0.4) return "Its outline is ONE upright column (a single leg): nothing continues sideways or over the top";
  if (alto < ancho * 0.35) return "Its outline is ONE horizontal band of balloons: it has no legs and does not reach the floor";
  const minimo = Math.max(2, globos.length * 0.04);
  const lleno = (f: number, c: number) => celdas[f]![c]! >= minimo;
  const izq = lleno(0, 0), der = lleno(0, 2), centroAbajo = lleno(0, 1), arriba = lleno(2, 1) || (lleno(2, 0) && lleno(2, 2));
  if (izq && der && !centroAbajo && arriba) return "Its outline is a complete arch: two legs, left and right, with an open space between them";
  if (izq !== der && arriba && !centroAbajo) {
    const pata = izq ? "left" : "right", otro = izq ? "right" : "left";
    const termina = lleno(1, izq ? 2 : 0) ? `at mid height on the ${otro}` : `at the top ${otro}`;
    return `Its outline is an asymmetric HALF arch: it rises from the bottom ${pata}, curves over the top and stops in mid-air ${termina}; the bottom ${otro} is empty, it has only one leg (do not add a second leg or complete the arch)`;
  }
  // Una columna a un lado con un pie que se abre por el piso (la «L»): una sola pata, nada arriba del otro lado.
  for (const lado of [0, 2] as const) {
    const otro = 2 - lado;
    if (lleno(2, lado) && lleno(1, lado) && !lleno(2, otro) && !lleno(1, otro) && lleno(0, otro)) {
      return `Its outline is ONE upright column on the ${LADO[lado]} with a low cluster at its foot spreading to the ${LADO[otro]} along the floor; above that low cluster the ${LADO[otro]} side is empty (one leg only: not an arch or a frame)`;
    }
  }
  // Ninguna forma con nombre: la rejilla en palabras (de arriba abajo), con lo vacío explícito.
  const filas = [2, 1, 0].map((f) => {
    const llenas = [0, 1, 2].filter((c) => lleno(f, c)).map((c) => LADO[c]);
    return `${FILA[f]} — ${llenas.length ? llenas.join(", ") : "empty"}`;
  });
  return `Seen from the front its outline fills: ${filas.join("; ")}; everything else is empty`;
}

/**
 * El aire de la escena: columnas de la rejilla (6 a lo ancho × 4 a lo alto) con globos arriba y la pared vacía hasta el
 * piso debajo, mientras en otra parte algo sí baja al piso. Se agrupan las seguidas y se dice dónde.
 */
export function huecosEnIngles(globos: readonly GloboSilueta[]): string {
  if (globos.length < 20) return "";
  const COLS = 6, FILAS = 4;
  const { celdas } = rejilla(globos, COLS, FILAS);
  const minimo = Math.max(2, globos.length * 0.01);
  const lleno = (f: number, c: number) => celdas[f]![c]! >= minimo;
  const alPiso = Array.from({ length: COLS }, (_, c) => lleno(0, c));
  if (!alPiso.some(Boolean)) return "";
  const abiertas = Array.from({ length: COLS }, (_, c) => lleno(FILAS - 1, c) && [0, 1, 2].every((f) => !lleno(f, c)));
  const tramos: Array<[number, number]> = [];
  for (let c = 0; c < COLS; c++) {
    if (!abiertas[c]) continue;
    const ultimo = tramos[tramos.length - 1];
    if (ultimo && ultimo[1] === c - 1) ultimo[1] = c; else tramos.push([c, c]);
  }
  if (!tramos.length) return "";
  const donde = ([a, b]: [number, number]) => {
    const m = (a + b + 1) / 2 / COLS;
    return m < 0.25 ? "on the left" : m > 0.75 ? "on the right" : m < 0.45 ? "left of center" : m > 0.55 ? "right of center" : "in the center";
  };
  return `Empty space matters: below the top of the decoration ${tramos.map(donde).join(" and ")} the wall is bare down to the floor — no leg, column, balloons or support there; the pieces do not join into a closed frame`;
}
