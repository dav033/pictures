/**
 * Hue degrees per catalog color word. Exported (with `FAMILIAS_NEUTRAS` and
 * `PUNTUACION_FAMILIA`) into the `catalog-search.v1` domain contract as
 * `x-tonos-colores-catalogo` (`scripts/export-domain-contract-schemas.ts`), the
 * same pattern `estructuras-oficiales.ts` uses for `x-geometria-estructuras-oficiales`:
 * this table is the one source, and `services/ai-api/app/catalog.py` reads it
 * from the exported contract to resolve a requested color the active snapshot
 * does not stock to the nearest one it does, instead of dropping it silently.
 */
export const HUES: Record<string, number> = {
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

/** Shape of `x-tonos-colores-catalogo` in the exported `catalog-search.v1` contract. */
export type TonosColoresCatalogoContrato = {
  hues: Record<string, number>;
  familias_neutras: string[][];
  puntuacion_familia: number;
};

/**
 * The chromatic-distance table as the JSON Schema extension the domain
 * contract export injects into `catalog-search.v1`. `services/ai-api/app/catalog.py`
 * reads it back with `contract_schema("CatalogSearch")` to pick, for a
 * requested color the snapshot does not stock, the nearest one it does.
 */
export function tonosColoresCatalogo(): TonosColoresCatalogoContrato {
  return {
    hues: { ...HUES },
    familias_neutras: FAMILIAS_NEUTRAS.map((familia) => [...familia]),
    puntuacion_familia: PUNTUACION_FAMILIA,
  };
}

/**
 * Nearest color of `disponibles` to `pedido`, by the same ranking
 * `puntuacionCromatica` uses (exact match wins outright; otherwise the
 * smallest distance, ties broken alphabetically for a deterministic result).
 * `undefined` when `disponibles` is empty. Used by the reference-color guard
 * (`colores-referencia.ts`/`globos-por-color.ts`) to decide which catalog
 * color a photo color the snapshot lacks can borrow -- the same table and
 * algorithm structure `catalog.py` reads from the exported contract, so
 * neither side can drift from the other's notion of "close enough": one
 * table, computed independently in each runtime, like the structure geometry
 * table in `estructuras-oficiales.ts`.
 */
export function colorCatalogoMasCercano(pedido: string, disponibles: readonly string[]): string | undefined {
  const normalizado = normalizarColor(pedido);
  const opciones = [...new Set(disponibles.map(normalizarColor).filter(Boolean))];
  if (!normalizado || opciones.length === 0) return undefined;
  if (opciones.includes(normalizado)) return normalizado;
  let mejor: string | undefined;
  let mejorPuntuacion = Infinity;
  for (const opcion of opciones) {
    const puntuacion = puntuacionCromatica([normalizado], [opcion]);
    if (puntuacion < mejorPuntuacion || (puntuacion === mejorPuntuacion && (mejor === undefined || opcion < mejor))) {
      mejorPuntuacion = puntuacion;
      mejor = opcion;
    }
  }
  return mejor;
}
