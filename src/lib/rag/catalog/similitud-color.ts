const HUES: Record<string, number> = {
  rojo: 0,
  burdeos: 350,
  coral: 12,
  naranja: 30,
  dorado: 44,
  "dorado rosa": 12,
  champagne: 42,
  amarillo: 52,
  cafe: 28,
  beige: 38,
  crema: 48,
  nude: 24,
  verde: 120,
  menta: 155,
  turquesa: 180,
  azul: 220,
  lila: 270,
  violeta: 276,
  morado: 280,
  fucsia: 320,
  rosado: 335,
};

function normalizarColor(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

function distanciaCircular(a: number, b: number): number {
  const distancia = Math.abs(a - b);
  return Math.min(distancia, 360 - distancia) / 180;
}

/**
 * Colors with no hue that still read as one family. Without them every neutral
 * scored 0.7, the same as an unknown color, so a grey alternative for a silver
 * piece ranked behind an orange one.
 */
export const FAMILIAS_NEUTRAS: ReadonlyArray<ReadonlySet<string>> = [
  new Set(["blanco", "crema", "beige", "nude", "transparente"]),
  new Set(["plateado", "gris", "negro"]),
  new Set(["dorado", "champagne"]),
];
/**
 * Techo de dos colores de la misma familia: siempre más cerca que un color
 * desconocido (0,7). No es un piso — cuando los dos tienen tono (dorado 44 y
 * champagne 42) la distancia de tono es menor y manda ella.
 */
export const PUNTUACION_FAMILIA = 0.35;

function mismaFamiliaNeutra(actual: string, candidata: string): boolean {
  return FAMILIAS_NEUTRAS.some((familia) => familia.has(actual) && familia.has(candidata));
}

/**
 * Lower scores mean a closer visual color. Unknown/neutral colors stay usable.
 *
 * An exact match scores 0: it used to return 1, the worst possible score, so
 * the same-color alternatives of a piece (Reflex Rojo for a Fashion Rojo) ranked
 * behind every other hue and fell out of the 12 the card shows.
 */
export function puntuacionCromatica(actuales: string[], candidatas: string[]): number {
  const base = actuales.map(normalizarColor).filter(Boolean);
  const opciones = candidatas.map(normalizarColor).filter(Boolean);
  if (!base.length || !opciones.length) return 0.7;
  if (opciones.some((color) => base.includes(color))) return 0;

  const puntuaciones: number[] = [];
  for (const actual of base) {
    for (const candidata of opciones) {
      const hueActual = HUES[actual];
      const hueCandidata = HUES[candidata];
      if (hueActual != null && hueCandidata != null) puntuaciones.push(distanciaCircular(hueActual, hueCandidata));
      // La familia es un techo, no una alternativa a la distancia de tono: sin
      // esto solo llegaban aquí los colores sin tono, así que la familia
      // dorado/champagne era código muerto y quitarle el tono a uno de los dos
      // los habría dejado en 0,7 (color desconocido) sin que nada lo notara.
      if (mismaFamiliaNeutra(actual, candidata)) puntuaciones.push(PUNTUACION_FAMILIA);
    }
  }
  return puntuaciones.length ? Math.min(...puntuaciones) : 0.7;
}
