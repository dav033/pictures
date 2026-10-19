import { PALETA_COLORES_V2, plegarTexto } from "@/lib/rag/taxonomy/v2";

/**
 * Familias de color del explorador del editor: rojos, rosados, dorados… Es solo presentación (cómo se agrupan los
 * colores del catálogo para que el cliente los encuentre); qué colores vende el catálogo y cuántos productos
 * lleva cada uno lo dice Python (`/catalog/colors`).
 *
 * Parte de la paleta del catálogo (`PALETA_COLORES_V2`, la misma que usan la búsqueda, la sustitución de color y la
 * muestra visual) y no de una lista nueva: la tabla está tipada contra ella, así que un color que entre a la paleta
 * sin familia es un error de compilación. Los colores que la paleta no conoce caen en «Otros»: nunca se pierden.
 * Los nombres de las familias siguen las de las etiquetas del catálogo (MORADOS, NARANJAS…).
 *
 * Pura: sin React, red ni reloj.
 */

export type ColorPaleta = (typeof PALETA_COLORES_V2)[number];

export const FAMILIAS = [
  { id: "rojos", nombre: "Rojos", representante: "rojo" },
  { id: "rosados", nombre: "Rosados", representante: "rosado" },
  { id: "naranjas", nombre: "Naranjas", representante: "naranja" },
  { id: "amarillos", nombre: "Amarillos", representante: "amarillo" },
  { id: "dorados", nombre: "Dorados", representante: "dorado" },
  { id: "verdes", nombre: "Verdes", representante: "verde" },
  { id: "azules", nombre: "Azules", representante: "azul" },
  { id: "morados", nombre: "Morados", representante: "morado" },
  { id: "plateados", nombre: "Plateados", representante: "plateado" },
  { id: "neutros", nombre: "Blancos, negros y neutros", representante: "blanco" },
  { id: "multicolor", nombre: "Multicolor", representante: "multicolor" },
  { id: "otros", nombre: "Otros", representante: "gris" },
] as const;

export type FamiliaId = (typeof FAMILIAS)[number]["id"];

const FAMILIA_POR_COLOR: Readonly<Record<ColorPaleta, FamiliaId>> = {
  rojo: "rojos",
  burdeos: "rojos",
  rosado: "rosados",
  fucsia: "rosados",
  coral: "rosados",
  naranja: "naranjas",
  amarillo: "amarillos",
  dorado: "dorados",
  "dorado rosa": "dorados",
  champagne: "dorados",
  verde: "verdes",
  menta: "verdes",
  azul: "azules",
  turquesa: "azules",
  morado: "morados",
  lila: "morados",
  violeta: "morados",
  plateado: "plateados",
  blanco: "neutros",
  negro: "neutros",
  beige: "neutros",
  crema: "neutros",
  nude: "neutros",
  cafe: "neutros",
  transparente: "neutros",
  multicolor: "multicolor",
};

const ORDEN = new Map<FamiliaId, number>(FAMILIAS.map((familia, indice) => [familia.id, indice]));

export function nombreDeFamilia(id: FamiliaId): string {
  return FAMILIAS.find((familia) => familia.id === id)?.nombre ?? "Otros";
}

/** Color de la paleta que pinta la muestra de la familia. */
export function representanteDeFamilia(id: FamiliaId): string {
  return FAMILIAS.find((familia) => familia.id === id)?.representante ?? "gris";
}

export function ordenDeFamilia(id: FamiliaId): number {
  return ORDEN.get(id) ?? FAMILIAS.length;
}

/** La familia de un color del catálogo («Café» y «cafe» son el mismo); lo que la paleta no conoce es «Otros». */
export function familiaDeColor(color: string): FamiliaId {
  const clave = plegarTexto(color);
  return Object.hasOwn(FAMILIA_POR_COLOR, clave) ? FAMILIA_POR_COLOR[clave as ColorPaleta] : "otros";
}

/**
 * La familia de un producto con estos colores: la de su único color, «Multicolor» si abarca varias familias
 * (o ya es multicolor) y «Otros» si no tiene colores. Dos tonos de la misma familia siguen siendo de ella.
 */
export function familiaDeColores(colores: readonly string[]): FamiliaId {
  const familias = new Set(colores.filter((color) => color.trim()).map(familiaDeColor));
  if (familias.size === 0) return "otros";
  if (familias.size === 1) return [...familias][0]!;
  return "multicolor";
}

export type ColorConTotal = { valor: string; total: number };

export type FamiliaDelCatalogo = {
  id: FamiliaId;
  nombre: string;
  representante: string;
  /** Sus colores del catálogo, el más surtido primero. */
  colores: ColorConTotal[];
};

/** Los colores del catálogo repartidos en familias, en el orden fijo de `FAMILIAS`; solo las que tienen colores. */
export function agruparColoresPorFamilia(colores: readonly ColorConTotal[]): FamiliaDelCatalogo[] {
  const porFamilia = new Map<FamiliaId, ColorConTotal[]>();
  for (const color of colores) {
    const id = familiaDeColor(color.valor);
    porFamilia.set(id, [...(porFamilia.get(id) ?? []), color]);
  }
  return [...porFamilia.entries()]
    .sort(([a], [b]) => ordenDeFamilia(a) - ordenDeFamilia(b))
    .map(([id, lista]) => ({
      id,
      nombre: nombreDeFamilia(id),
      representante: representanteDeFamilia(id),
      colores: [...lista].sort((a, b) => b.total - a.total || a.valor.localeCompare(b.valor)),
    }));
}

/**
 * Los colores con que se busca una familia: los exactos que el cliente marcó dentro de ella o, si no marcó
 * ninguno, todos los que el catálogo tiene de esa familia.
 */
export function coloresDeBusqueda(familia: Pick<FamiliaDelCatalogo, "colores">, exactosElegidos: readonly string[]): string[] {
  const propios = familia.colores.map((color) => color.valor);
  const elegidos = propios.filter((valor) => exactosElegidos.includes(valor));
  return elegidos.length > 0 ? elegidos : propios;
}
