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

export type CategoriaCatalogoV2 = (typeof CATEGORIAS_CATALOGO_V2)[number];

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

/**
 * Color nominal de cada entrada de la paleta, en hex.
 *
 * Es una aproximación de pantalla para reconocer la paleta, no un color medido
 * de fábrica ni de una foto de producto. Vive aquí, junto a la paleta, porque
 * lo leen dos consumidores que no deben divergir: la muestra visual que ve el
 * cliente (`presentacion-cliente.ts`) y la distancia cromática que decide qué
 * color sustituye a cuál (`similitud-color.ts`, y su espejo en `catalog.py` a
 * través del contrato). Una segunda copia haría que el cliente viera un tono y
 * el catálogo midiera otro.
 */
export const HEX_COLORES_V2: Readonly<Record<(typeof PALETA_COLORES_V2)[number], string>> = {
  dorado: "#c9a227",
  "dorado rosa": "#d4a59a",
  plateado: "#b8bcc4",
  rojo: "#d32f2f",
  azul: "#1f4fbf",
  rosado: "#f2a7c3",
  verde: "#2e9d57",
  blanco: "#ffffff",
  negro: "#1b1b1b",
  morado: "#7b3fa0",
  naranja: "#f28c28",
  amarillo: "#f5d33a",
  fucsia: "#d6247a",
  transparente: "#ffffff",
  multicolor: "#ffffff",
  lila: "#c7a4e0",
  turquesa: "#1fb5b0",
  beige: "#e6d3b3",
  cafe: "#7a4b2a",
  champagne: "#e8d3a2",
  violeta: "#8a4fd1",
  coral: "#f6765e",
  menta: "#a6e3c8",
  crema: "#f6ecd2",
  nude: "#e0b89c",
  burdeos: "#7d1d34",
};

/**
 * "gris" no es un color del catálogo (no se vende un globo gris liso), pero el
 * analizador lo observa en las fotos y la sustitución tiene que poder medirlo
 * para mandarlo a plateado en vez de a negro. Se mantiene fuera de la paleta a
 * propósito: se puede medir, no se puede comprar.
 */
export const HEX_COLORES_OBSERVABLES: Readonly<Record<string, string>> = {
  ...HEX_COLORES_V2,
  gris: "#8e9295",
};

/**
 * El LoRA de estilo Sempertex se entrenó con captions 100% en inglés
 * (según el corpus de captions vigente) — pasarle un color en español
 * queda fuera de esa distribución igual que un prompt con secciones
 * etiquetadas. Este mapa es la única traducción ES→EN de color que necesita
 * ese prompt; no cubre nada fuera de `PALETA_COLORES_V2`.
 */
export const PALETA_COLORES_EN_V2: Record<(typeof PALETA_COLORES_V2)[number], string> = {
  dorado: "gold",
  "dorado rosa": "rose gold",
  plateado: "silver",
  rojo: "red",
  azul: "blue",
  rosado: "pink",
  verde: "green",
  blanco: "white",
  negro: "black",
  morado: "purple",
  naranja: "orange",
  amarillo: "yellow",
  fucsia: "fuchsia",
  transparente: "clear",
  multicolor: "multicolor",
  lila: "lilac",
  turquesa: "turquoise",
  beige: "beige",
  cafe: "brown",
  champagne: "champagne",
  violeta: "violet",
  coral: "coral",
  menta: "mint",
  crema: "cream",
  nude: "nude",
  burdeos: "burgundy",
};

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

export type Alias<T extends string> = { value: T; aliases: readonly string[] };

const COLORS: readonly Alias<(typeof PALETA_COLORES_V2)[number]>[] = [
  { value: "dorado rosa", aliases: ["dorado rosa", "oro rosa", "rose gold", "rosé gold"] },
  { value: "dorado", aliases: ["dorado", "dorados", "dorada", "doradas", "oro", "gold"] },
  { value: "plateado", aliases: ["plateado", "plateados", "plateada", "plateadas", "plata", "silver"] },
  { value: "rojo", aliases: ["rojo", "rojos", "roja", "rojas", "red"] },
  // Los tonos claros (`TONOS_CLAROS_V2`) son de su familia del catálogo: «celeste» es azul para los filtros, las
  // restricciones y Python (que solo conocen familias), y `clasificarTonos` conserva el tono para la vista guiada.
  // Antes «celeste» no era ningún color: «rosa, lila, celeste y dorado» se leía como tres colores (probador, 2026-10-07).
  { value: "azul", aliases: ["azul", "azules", "azul rey", "azul caribe", "azul naval", "blue", "celeste", "celestes", "azul celeste", "azul claro", "azul cielo", "azul bebe", "azul pastel", "azul palido"] },
  // "rose"/"dusty rose" are how a photo analysis names old pink ("rose gold" is
  // longer and wins at the same span).
  { value: "rosado", aliases: ["rosado", "rosados", "rosada", "rosadas", "rosa", "pink", "rose", "dusty rose", "blush"] },
  { value: "verde", aliases: ["verde", "verdes", "lima", "esmeralda", "green"] },
  { value: "blanco", aliases: ["blanco", "blancos", "blanca", "blancas", "white"] },
  { value: "negro", aliases: ["negro", "negros", "negra", "negras", "black"] },
  { value: "morado", aliases: ["morado", "morados", "morada", "moradas", "purple"] },
  // «durazno» NO va aquí: como color de paleta sería naranja y un plan «naranja» compraría el Fashion Naranja vivo. Es un
  // tono (`TONOS_V2.durazno`): la búsqueda se queda con el Fashion Durazno y su familia del catálogo sigue siendo naranja.
  { value: "naranja", aliases: ["naranja", "naranjas", "orange"] },
  { value: "amarillo", aliases: ["amarillo", "amarillos", "amarilla", "amarillas", "yellow"] },
  { value: "fucsia", aliases: ["fucsia", "magenta", "fuchsia"] },
  // "clear" es la palabra que escribe el analizador de fotos cuando ve un globo
  // burbuja, y faltaba: una referencia con burbujas transparentes perdía ese
  // color antes de llegar al catálogo. "cristal" NO va aquí a propósito, va en
  // los acabados: el catálogo tiene cinco `Cristal Pastel <color>`, donde
  // Cristal es el acabado translúcido SOBRE un color, y ponerlo como color
  // haría que esos cinco productos se leyeran a la vez como transparentes y
  // como su color real.
  { value: "transparente", aliases: ["transparente", "transparentes", "transparent", "crystal", "clear"] },
  { value: "multicolor", aliases: ["multicolor", "surtido", "rainbow", "arcoiris"] },
  { value: "lila", aliases: ["lila", "lilas", "lilac", "lavender", "lavanda"] },
  { value: "turquesa", aliases: ["turquesa", "turquesas", "turquoise"] },
  { value: "beige", aliases: ["beige", "arena"] },
  { value: "cafe", aliases: ["cafe", "marron", "marrón", "chocolate", "brown"] },
  { value: "champagne", aliases: ["champagne", "champana", "champaña"] },
  { value: "violeta", aliases: ["violeta"] },
  { value: "coral", aliases: ["coral"] },
  { value: "menta", aliases: ["menta", "mint"] },
  { value: "crema", aliases: ["crema", "crudo", "ivory"] },
  { value: "nude", aliases: ["nude", "piel"] },
  // Wine shades in Spanish and English. Multi-word aliases ("rojo vino", "wine
  // red") are longer than "rojo"/"red" at the same span, so they stay one color.
  { value: "burdeos", aliases: ["burdeos", "vino", "borgona", "burgundy", "rojo vino", "vino tinto", "vinotinto", "granate", "marsala", "wine", "wine red", "maroon", "bordeaux", "oxblood", "merlot"] },
];

/**
 * Alias de cada color del catálogo. La taxonomía es la dueña de los sinónimos de
 * color, así que el vocabulario de colores del cliente (`plan/restricciones.ts`)
 * se deriva de aquí en vez de mantener una segunda lista a mano. Solo lectura:
 * agregar un alias aquí cambia también lo que el cliente puede exigir.
 */
export const ALIAS_COLORES_V2: readonly Alias<(typeof PALETA_COLORES_V2)[number]>[] = COLORS;

/**
 * Tonos claros que el catálogo vende y que la paleta junta con su familia: «celeste» (Fashion Azul Celeste, Pastel
 * Mate Azul…), «rosa pastel» (Pastel Mate Rosado, Fashion Rosado) y «durazno» (Fashion Durazno). Lila y menta ya son
 * colores de la paleta.
 *
 * Por qué no entran a `PALETA_COLORES_V2` (probador, 2026-10-07: «rosa, lila, celeste y dorado» salió «Azul cromado»,
 * un azul petróleo): la paleta viaja a Python por el contrato (`x-paleta-colores`, `x-hex-colores`) y es el vocabulario
 * de los colores derivados que guarda el catálogo (`derived_colors`): el globo «FASHION AZUL CELESTE» está guardado como
 * «azul» y el Python del VPS exige que el color de cada material sea uno de los guardados. Un «celeste» de paleta
 * rompería la cobertura del plan hasta reingestar el catálogo y desplegar Python. El tono vive del lado de TypeScript:
 * la vista guiada lo nombra y lo propone, la búsqueda del catálogo se queda con los globos de ese tono
 * (`src/lib/plan/tonos-color.ts`) y a Python le llega la familia de siempre.
 */
export const TONOS_CLAROS_V2 = ["celeste", "rosa pastel", "durazno"] as const;
export type TonoClaroV2 = (typeof TONOS_CLAROS_V2)[number];
type ColorPaletaV2 = (typeof PALETA_COLORES_V2)[number];

export type DefinicionTonoV2 = {
  /** La familia del catálogo con que lo guardan los productos y lo filtra Python. */
  familia: ColorPaletaV2;
  /** Cómo se le dice al cliente. */
  nombre: string;
  /** Aproximación de pantalla, como `HEX_COLORES_V2`. */
  hex: string;
  /** Nombre en inglés para los textos de imagen. */
  en: string;
  /** Palabras que lo nombran en lo que escribe el cliente (plegadas como `plegarTexto`). */
  aliases: readonly string[];
  /** Palabras del TÍTULO de un producto que lo hacen de este tono («FASHION AZUL CELESTE»). */
  titulo: readonly string[];
  /** Un título con «pastel» y la familia es de este tono («PASTEL MATE AZUL», «CRISTAL PASTEL ROSADO»). */
  pastel: boolean;
  /** `nombreBase` de la lámina Sempertex (`tabla-color.json`) de las referencias de este tono. */
  basesSempertex: readonly string[];
};

export const TONOS_V2: Readonly<Record<TonoClaroV2, DefinicionTonoV2>> = {
  celeste: {
    familia: "azul",
    nombre: "Celeste",
    hex: "#8fd0f2",
    en: "light blue",
    aliases: ["celeste", "celestes", "azul celeste", "azul claro", "azul cielo", "azul bebe", "azul pastel", "azul palido", "baby blue", "light blue", "sky blue", "pale blue", "pastel blue"],
    titulo: ["celeste", "cielo", "bebe"],
    pastel: true,
    basesSempertex: ["light blue", "pale blue"],
  },
  "rosa pastel": {
    familia: "rosado",
    nombre: "Rosa pastel",
    hex: "#f6c4d4",
    en: "pastel pink",
    aliases: ["rosa pastel", "rosado pastel", "rosada pastel", "rosa bebe", "rosado bebe", "rosa claro", "rosado claro", "rosa palido", "baby pink", "light pink", "pale pink", "pastel pink"],
    titulo: [],
    pastel: true,
    basesSempertex: ["light pink", "pale pink"],
  },
  durazno: {
    familia: "naranja",
    nombre: "Durazno",
    hex: "#ffb38a",
    en: "peach",
    aliases: ["durazno", "duraznos", "melocoton", "peach"],
    titulo: ["durazno", "melocoton", "peach"],
    pastel: false,
    basesSempertex: ["peach"],
  },
};

const TONOS: readonly Alias<TonoClaroV2>[] = TONOS_CLAROS_V2.map((tono) => ({ value: tono, aliases: TONOS_V2[tono].aliases }));

/** Los tonos claros que nombra un texto: «rosa, lila, celeste y dorado» → [celeste]. */
export function clasificarTonos(text: string): TaxonomyMatch<TonoClaroV2> {
  return matchAliases(text, TONOS);
}

/**
 * Los colores que puede llevar una propuesta de la vista guiada: la paleta y los tonos claros. Es solo de TypeScript
 * (`PropuestaComposicionSchema`): el plan que llega a Python lleva la familia (`familiaDeColorPropuesta`).
 */
export const COLORES_PROPUESTA_V2 = [...PALETA_COLORES_V2, ...TONOS_CLAROS_V2] as const;
export type ColorPropuestaV2 = (typeof COLORES_PROPUESTA_V2)[number];

/** El tono claro que ES este color («Celeste», «rosa pastel»), o null si es otro. */
export function tonoClaroDe(color: string): TonoClaroV2 | null {
  const plegado = fold(color);
  return TONOS_CLAROS_V2.find((tono) => tono === plegado) ?? null;
}

/** «celeste» → «azul»; un color de la paleta se queda como está. */
export function familiaDeColorPropuesta(color: string): string {
  const tono = tonoClaroDe(color);
  return tono ? TONOS_V2[tono].familia : color;
}

/**
 * Los colores claros que el catálogo vende, en el orden en que se ofrecen al cliente («Añadir un color», chips de
 * colores): celeste, rosa pastel, lila, menta y durazno.
 */
export const COLORES_CLAROS_V2: readonly ColorPropuestaV2[] = ["celeste", "rosa pastel", "lila", "menta", "durazno"];

const FINISHES: readonly Alias<(typeof ACABADOS_CATALOGO_V2)[number]>[] = [
  { value: "satin", aliases: ["satin", "satín", "satinado"] },
  { value: "metal", aliases: ["metal", "metal metals", "metal dorado", "metal plateado"] },
  { value: "fashion", aliases: ["fashion", "fashion color"] },
  { value: "metalizado", aliases: ["metalizado", "metalizados", "metallic", "foil"] },
  { value: "mate", aliases: ["mate", "matte"] },
  { value: "reflex", aliases: ["reflex", "reflectivo", "reflectante"] },
  { value: "perlado", aliases: ["perlado", "perlados", "perla", "pearl"] },
  // "cristal" es el nombre de la familia del catálogo (`Cristal Pastel <color>`)
  // y pertenece a este eje, no al de color: así `Cristal Pastel Rosado` se lee
  // como acabado cristal + color rosado, que es lo que es.
  { value: "transparente", aliases: ["transparente", "translucido", "crystal", "cristal"] },
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

/**
 * Negative lookahead (folded text) for a number that counts people or age,
 * never a balloon size: "cumpleaños de 40 invitados", "fiesta de 12 niños",
 * "de 5 años". Every "de N" size pattern must append it; explicit size forms
 * ("R-12", "12 pulgadas", "de 40 pulgadas") are unaffected.
 */
export const CONTEO_NO_TAMANO_LOOKAHEAD =
  "(?!\\s*(?:invitad[oa]s?|personas?|asistentes?|ninos?|ninas?|adultos?|comensales?|huespedes|anos?)\\b)";

const TAMANO_POR_PALABRA = new RegExp(`\\b(?:tamano|talla|medida|de)\\s*(5|9|12|18|24|36|40)\\b${CONTEO_NO_TAMANO_LOOKAHEAD}`, "gi");

export function clasificarTamanos(text: string): TaxonomyMatch<number> {
  const normalized = fold(text);
  const values = new Set<number>();
  // A bare quantity such as "12 globos" is not a size. Require either the
  // catalog R- code or an explicit inch unit, then handle human size words.
  for (const match of normalized.matchAll(/\br\s*-?\s*(5|9|12|18|24|36|40)\b/gi)) values.add(Number(match[1]));
  for (const match of normalized.matchAll(/\b(5|9|12|18|24|36|40)\s*(?:pulgadas?|in)\b/gi)) values.add(Number(match[1]));
  for (const match of normalized.matchAll(TAMANO_POR_PALABRA)) values.add(Number(match[1]));
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
