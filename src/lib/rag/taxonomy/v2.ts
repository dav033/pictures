/**
 * Taxonomía controlada para el catálogo Sempertex/Shopify.
 *
 * Los valores públicos de este módulo son deliberadamente pequeños y estables:
 * los tags de Shopify se normalizan aquí antes de llegar a SQL o al parser.
 * `TAXONOMY_VERSION` permite invalidar índices derivados cuando cambien alias.
 */

export const TAXONOMY_VERSION = "catalog-taxonomy-v2" as const;

export const CATEGORIAS_CATALOGO_V2 = [
  "globo_latex",
  "globo_metalizado",
  "globo_numero_letra",
  "banderola_cartel",
  "vela",
  "kit",
  "guirnalda_arco",
  "complemento",
  "empaque",
  "desechable",
] as const;

/** Paleta ampliada a partir de tags observados en products_catalog.json. */
export const PALETA_COLORES_V2 = [
  "dorado",
  "dorado rosa",
  "plateado",
  "rojo",
  "azul",
  "rosado",
  "verde",
  "blanco",
  "negro",
  "morado",
  "naranja",
  "amarillo",
  "fucsia",
  "transparente",
  "multicolor",
  "lila",
  "turquesa",
  "beige",
  "cafe",
  "champagne",
  "violeta",
  "coral",
  "menta",
  "crema",
  "nude",
  "burdeos",
] as const;

export const ACABADOS_CATALOGO_V2 = [
  "satin",
  "metal",
  "fashion",
  "metalizado",
  "mate",
  "reflex",
  "perlado",
  "transparente",
] as const;

export const PATRONES_CATALOGO_V2 = [
  "impreso",
  "polka",
  "rayas",
  "chevron",
  "triangulos",
  "diamantes",
  "personajes",
] as const;

export const OCASIONES_CATALOGO_V2 = [
  "cumpleanos",
  "san_valentin",
  "dia_madre",
  "dia_padre",
  "dia_mujer",
  "navidad",
  "halloween",
  "graduacion",
  "xv_anos",
  "boda",
  "baby_shower",
] as const;

export const FORMAS_CATALOGO_V2 = ["redondo", "corazon", "link", "modelar"] as const;
export const DIAMETROS_REDONDOS_CATALOGO_V2 = [5, 9, 12, 18, 24, 36, 40] as const;

export type TaxonomyStatus = "known" | "unknown" | "ambiguous";

export type TaxonomyMatch<T = string> = {
  status: TaxonomyStatus;
  values: T[];
  candidates: string[];
};

const fold = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type Alias<T extends string> = { value: T; aliases: readonly string[] };

const COLORS: readonly Alias<(typeof PALETA_COLORES_V2)[number]>[] = [
  { value: "dorado rosa", aliases: ["dorado rosa", "oro rosa", "rose gold", "rosé gold"] },
  { value: "dorado", aliases: ["dorado", "dorados", "oro", "gold"] },
  { value: "plateado", aliases: ["plateado", "plateados", "plata", "silver"] },
  { value: "rojo", aliases: ["rojo", "rojos", "red"] },
  { value: "azul", aliases: ["azul", "azules", "azul rey", "azul caribe", "azul naval", "blue"] },
  { value: "rosado", aliases: ["rosado", "rosados", "rosa", "pink"] },
  { value: "verde", aliases: ["verde", "verdes", "lima", "esmeralda", "green"] },
  { value: "blanco", aliases: ["blanco", "blancos", "white"] },
  { value: "negro", aliases: ["negro", "negros", "black"] },
  { value: "morado", aliases: ["morado", "morados", "purple"] },
  { value: "naranja", aliases: ["naranja", "orange"] },
  { value: "amarillo", aliases: ["amarillo", "yellow"] },
  { value: "fucsia", aliases: ["fucsia", "magenta", "fuchsia"] },
  { value: "transparente", aliases: ["transparente", "transparentes", "transparent", "crystal"] },
  { value: "multicolor", aliases: ["multicolor", "surtido", "rainbow", "arcoiris"] },
  { value: "lila", aliases: ["lila"] },
  { value: "turquesa", aliases: ["turquesa", "turquesa"] },
  { value: "beige", aliases: ["beige", "arena"] },
  { value: "cafe", aliases: ["cafe", "marron", "marrón", "chocolate", "brown"] },
  { value: "champagne", aliases: ["champagne", "champana", "champaña"] },
  { value: "violeta", aliases: ["violeta"] },
  { value: "coral", aliases: ["coral"] },
  { value: "menta", aliases: ["menta", "mint"] },
  { value: "crema", aliases: ["crema", "crudo", "ivory"] },
  { value: "nude", aliases: ["nude", "piel"] },
  { value: "burdeos", aliases: ["burdeos", "vino", "borgona", "burgundy"] },
];

const FINISHES: readonly Alias<(typeof ACABADOS_CATALOGO_V2)[number]>[] = [
  { value: "satin", aliases: ["satin", "satín", "satinado"] },
  { value: "metal", aliases: ["metal", "metal metals", "metal dorado", "metal plateado"] },
  { value: "fashion", aliases: ["fashion", "fashion color"] },
  { value: "metalizado", aliases: ["metalizado", "metalizados", "metallic", "foil"] },
  { value: "mate", aliases: ["mate", "matte"] },
  { value: "reflex", aliases: ["reflex", "reflectivo", "reflectante"] },
  { value: "perlado", aliases: ["perlado", "perlados", "perla", "pearl"] },
  { value: "transparente", aliases: ["transparente", "translucido", "crystal"] },
];

const PATTERNS: readonly Alias<(typeof PATRONES_CATALOGO_V2)[number]>[] = [
  { value: "impreso", aliases: ["impreso", "impresos", "estampado", "estampados", "printed"] },
  { value: "polka", aliases: ["polka", "lunares", "puntos"] },
  { value: "rayas", aliases: ["rayas", "rayado", "stripes"] },
  { value: "chevron", aliases: ["chevron", "zigzag"] },
  { value: "triangulos", aliases: ["triangulos", "triangulos"] },
  { value: "diamantes", aliases: ["diamantes", "rombos"] },
  { value: "personajes", aliases: ["personajes", "jurassic", "disney", "marvel", "cartoon"] },
];

const OCCASIONS: readonly Alias<(typeof OCASIONES_CATALOGO_V2)[number]>[] = [
  { value: "cumpleanos", aliases: ["cumpleanos", "cumple", "birthday"] },
  { value: "san_valentin", aliases: ["san valentin", "amor y amistad", "valentines day"] },
  { value: "dia_madre", aliases: ["dia de la madre", "dia de mama", "dia mami", "promomadre", "mother s day"] },
  { value: "dia_padre", aliases: ["dia del padre", "dia de papa", "dia del hombre", "promopadre", "fathers day"] },
  { value: "dia_mujer", aliases: ["dia de la mujer", "womens day"] },
  { value: "navidad", aliases: ["navidad", "navideno", "christmas"] },
  { value: "halloween", aliases: ["halloween", "noche de brujas"] },
  { value: "graduacion", aliases: ["graduacion", "grado", "graduation"] },
  { value: "xv_anos", aliases: ["xv anos", "quince anos", "15 anos", "fifteen years"] },
  { value: "boda", aliases: ["boda", "matrimonio", "wedding"] },
  { value: "baby_shower", aliases: ["baby shower", "babyshower"] },
];

const CATEGORIES: readonly Alias<(typeof CATEGORIAS_CATALOGO_V2)[number]>[] = [
  { value: "globo_latex", aliases: ["globo latex", "globos latex", "latex"] },
  { value: "globo_metalizado", aliases: ["globo metalizado", "globos metalizados", "foil balloon"] },
  { value: "globo_numero_letra", aliases: ["globo numero", "globos numero", "globo letra", "globos letras"] },
  { value: "banderola_cartel", aliases: ["banderola", "cartel", "pendon"] },
  { value: "vela", aliases: ["vela", "velas"] },
  { value: "kit", aliases: ["kit", "kits", "set de fiesta"] },
  { value: "guirnalda_arco", aliases: ["guirnalda", "arco de globos", "arco"] },
  { value: "complemento", aliases: ["complemento", "accesorio", "accesorios"] },
  { value: "empaque", aliases: ["empaque", "empaques", "bolsa de regalo", "bolsas de regalo"] },
  { value: "desechable", aliases: ["desechable", "desechables"] },
];

const FORMS: readonly Alias<(typeof FORMAS_CATALOGO_V2)[number]>[] = [
  { value: "redondo", aliases: ["redondo", "redonda", "redondos", "circular"] },
  { value: "corazon", aliases: ["corazon", "corazones", "heart"] },
  { value: "link", aliases: ["link", "link o loon", "link-o-loon", "lol"] },
  { value: "modelar", aliases: ["modelar", "figuras", "twisting", "t260", "t160", "t360"] },
];

function matchAliases<T extends string>(text: string, aliases: readonly Alias<T>[]): TaxonomyMatch<T> {
  const normalized = fold(text);
  const hits: Array<{ value: T; index: number; length: number }> = [];
  for (const item of aliases) {
    for (const alias of item.aliases) {
      const needle = fold(alias);
      const index = needle.length > 0 ? normalized.indexOf(needle) : -1;
      if (index >= 0 && new RegExp(`(?:^|\\s)${escapeRegExp(needle)}(?:$|\\s)`, "i").test(normalized)) {
        hits.push({ value: item.value, index, length: needle.length });
      }
    }
  }
  // Prefer the longest alias at an overlapping span: "dorado rosa" is a
  // single catalog color, not accidental values "dorado" + "rosado".
  hits.sort((a, b) => a.index - b.index || b.length - a.length);
  const selected: Array<{ value: T; index: number; length: number }> = [];
  for (const hit of hits) {
    const overlaps = selected.some((item) => hit.index < item.index + item.length && item.index < hit.index + hit.length);
    if (!overlaps) selected.push(hit);
  }
  const matches = selected.map((hit) => hit.value);
  const candidates = matches.map(String);
  const values = [...new Set(matches)];
  const ambiguity = /(?:^|\s)(?:o|u|quizas|quizas|tal vez|cualquiera)(?:$|\s)/.test(normalized) && values.length > 1;
  return {
    status: values.length === 0 ? "unknown" : ambiguity ? "ambiguous" : "known",
    values,
    candidates: [...new Set(candidates)],
  };
}

export const plegarTexto = fold;

export function clasificarColores(text: string): TaxonomyMatch<(typeof PALETA_COLORES_V2)[number]> {
  const normalized = fold(text);
  // In Spanish catalog copy, "vino" is an object/use context for bags and
  // gift boxes, not a burgundy color. Keep the color alias for explicit
  // requests such as "globos color vino".
  const objectWine = /\b(?:bolsa|caja|empaque|porta\w*|estuche)\b.*\bvino\b/.test(normalized) || /\bpara\s+vino\b/.test(normalized);
  return matchAliases(objectWine ? normalized.replace(/\bvino\b/g, " ") : text, COLORS);
}

export type ColorBreakdown = {
  status: TaxonomyStatus;
  base_color: (typeof PALETA_COLORES_V2)[number] | null;
  secondary_colors: (typeof PALETA_COLORES_V2)[number][];
};

export function clasificarColoresCompuestos(text: string): ColorBreakdown {
  const match = clasificarColores(text);
  return {
    status: match.status,
    base_color: match.values[0] ?? null,
    secondary_colors: match.values.slice(1),
  };
}

export function clasificarAcabados(text: string): TaxonomyMatch<(typeof ACABADOS_CATALOGO_V2)[number]> {
  return matchAliases(text, FINISHES);
}

export function clasificarPatrones(text: string): TaxonomyMatch<(typeof PATRONES_CATALOGO_V2)[number]> {
  return matchAliases(text, PATTERNS);
}

export function clasificarOcasiones(text: string): TaxonomyMatch<(typeof OCASIONES_CATALOGO_V2)[number]> {
  return matchAliases(text, OCCASIONS);
}

export function clasificarCategorias(text: string): TaxonomyMatch<(typeof CATEGORIAS_CATALOGO_V2)[number]> {
  return matchAliases(text, CATEGORIES);
}

export function clasificarFormas(text: string): TaxonomyMatch<(typeof FORMAS_CATALOGO_V2)[number]> {
  const normalized = fold(text);
  const explicitForm = /\b(?:en\s+)?forma(?:\s+de)?\s+(?:redond\w*|corazon\w*|heart|link(?:\s+o\s+loon)?|modelar|figuras?|twisting)\b/.test(normalized);
  const balloonContext = /\b(?:globo|globos|balloon|balloons)\b/.test(normalized);
  // Textual forms are hard only with an explicit "forma ..." phrase or a
  // balloon context. This prevents vessel/decorative copy and generic verbs
  // such as "modelar" from imposing a physical variant filter.
  return explicitForm || balloonContext ? matchAliases(text, FORMS) : matchAliases("", FORMS);
}

export function clasificarTamanos(text: string): TaxonomyMatch<number> {
  const normalized = fold(text);
  const values = new Set<number>();
  // A bare quantity such as "12 globos" is not a size. Require either the
  // catalog R- code or an explicit inch unit, then handle human size words.
  for (const match of normalized.matchAll(/\br\s*-?\s*(5|9|12|18|24|36|40)\b/gi)) values.add(Number(match[1]));
  for (const match of normalized.matchAll(/\b(5|9|12|18|24|36|40)\s*(?:pulgadas?|in)\b/gi)) values.add(Number(match[1]));
  for (const match of normalized.matchAll(/\b(?:tamano|talla|medida|de)\s*(5|9|12|18|24|36|40)\b/gi)) values.add(Number(match[1]));
  const result = [...values];
  const ambiguous = /(?:^|\s)(?:o|u|quizas|tal vez)(?:$|\s)/.test(normalized) && result.length > 1;
  return { status: result.length === 0 ? "unknown" : ambiguous ? "ambiguous" : "known", values: result, candidates: result.map(String) };
}

export type TaxonomyClassification = {
  colores: TaxonomyMatch<(typeof PALETA_COLORES_V2)[number]>;
  acabados: TaxonomyMatch<(typeof ACABADOS_CATALOGO_V2)[number]>;
  patrones: TaxonomyMatch<(typeof PATRONES_CATALOGO_V2)[number]>;
  ocasiones: TaxonomyMatch<(typeof OCASIONES_CATALOGO_V2)[number]>;
  categorias: TaxonomyMatch<(typeof CATEGORIAS_CATALOGO_V2)[number]>;
  formas: TaxonomyMatch<(typeof FORMAS_CATALOGO_V2)[number]>;
  tamanos: TaxonomyMatch<number>;
};

export function clasificarTaxonomia(text: string): TaxonomyClassification {
  return {
    colores: clasificarColores(text),
    acabados: clasificarAcabados(text),
    patrones: clasificarPatrones(text),
    ocasiones: clasificarOcasiones(text),
    categorias: clasificarCategorias(text),
    formas: clasificarFormas(text),
    tamanos: clasificarTamanos(text),
  };
}

// Compatibility exports: existing ingestion and UI callers keep the old names
// while both ingestion and query parsing use the same versioned values.
export const CATEGORIAS_CATALOGO = CATEGORIAS_CATALOGO_V2;
export const PALETA_COLORES = PALETA_COLORES_V2;
export const OCASIONES_CATALOGO = OCASIONES_CATALOGO_V2;
export const FORMAS_CATALOGO = FORMAS_CATALOGO_V2;
export const DIAMETROS_REDONDOS_CATALOGO = DIAMETROS_REDONDOS_CATALOGO_V2;
