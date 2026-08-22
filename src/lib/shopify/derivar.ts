/**
 * Gramática de tamaños del catálogo Sempertex (§0.5 del plan) y derivaciones
 * de color/categoría/ocasión a partir de tags. Todo esto sale de datos
 * verificados contra la tienda pública, no de suposiciones.
 */

export type TamanoDecodificado = {
  /**
   * Forma física del globo — solo cuando el código la determina sin
   * ambigüedad (R-/C-/LOL-/T-). `null` cuando el código solo da una medida
   * (N IN, AxB CM): esos no son globos de una forma fija — "N IN" lo usan
   * tanto metalizados como el Globo Burbuja (categoría "complemento"), y
   * "AxB CM" es empaque (bolsas/kits de regalo), no un globo. La forma o el
   * acabado real de esos productos vive en `categoria`, no acá.
   */
  forma: string | null;
  diamPulg: number | null;
  largoPulg: number | null;
  anchoCm: number | null;
  altoCm: number | null;
};

/**
 * R-N: redondo, N pulgadas · C-N: corazón · LOL-N: Link-O-Loon® · T<d><ll>:
 * modelar (d" diámetro × ll" largo). "N IN" y "AxB CM" también se decodifican
 * (son medidas reales) pero no fijan `forma`: no la determinan de forma
 * confiable — ver el comentario de `TamanoDecodificado.forma`.
 */
export function decodificarTamano(codigo: string | null): TamanoDecodificado | null {
  if (!codigo) return null;
  const c = codigo.trim().toUpperCase();

  let m = c.match(/^R\s*-?\s*(\d+(?:\.\d+)?)(?:\s+.*)?$/);
  if (m) return { forma: "redondo", diamPulg: Number(m[1]), largoPulg: null, anchoCm: null, altoCm: null };

  m = c.match(/^C\s*-?\s*(\d+(?:\.\d+)?)$/);
  if (m) return { forma: "corazon", diamPulg: Number(m[1]), largoPulg: null, anchoCm: null, altoCm: null };

  // LOL-660 real en catálogo: line-o-loon de la serie 60" (6" diámetro × 60"
  // largo, mismo formato compuesto que T160/T260/T360), no un solo número —
  // sin este caso especial, el patrón genérico de abajo lo leía como 660" de
  // diámetro.
  m = c.match(/^LOL\s*-?\s*(\d)60$/);
  if (m) return { forma: "link", diamPulg: Number(m[1]), largoPulg: 60, anchoCm: null, altoCm: null };

  m = c.match(/^LOL\s*-?\s*(\d+(?:\.\d+)?)$/);
  if (m) return { forma: "link", diamPulg: Number(m[1]), largoPulg: null, anchoCm: null, altoCm: null };

  m = c.match(/^T\s*-?\s*(\d)(\d+)$/);
  if (m) return { forma: "modelar", diamPulg: Number(m[1]), largoPulg: Number(m[2]), anchoCm: null, altoCm: null };

  m = c.match(/^(\d+(?:\.\d+)?)\s*IN$/);
  if (m) return { forma: null, diamPulg: Number(m[1]), largoPulg: null, anchoCm: null, altoCm: null };

  m = c.match(/^(\d+(?:\.\d+)?)\s*X\s*(\d+(?:\.\d+)?)\s*CM$/);
  if (m) return { forma: null, diamPulg: null, largoPulg: null, anchoCm: Number(m[1]), altoCm: Number(m[2]) };

  return null;
}

/** "PAQ X 50" / "PAQUETE X 8" → 50 / 8, incluso dentro de un título de variante.
 * Devuelve null si no es parseable o es cero (nunca se asume 1 en silencio). */
export function decodificarUnidadesPaquete(codigo: string | null): number | null {
  if (!codigo) return null;
  const m = codigo.trim().toUpperCase().match(/(?:^|[^A-Z0-9])PAQ(?:UETE)?\s*X\s*(\d+)(?=$|[^A-Z0-9])/);
  const unidades = m ? Number(m[1]) : null;
  return unidades && unidades > 0 ? unidades : null;
}

const DICCIONARIO_COLOR: Record<string, string> = {
  DORADO: "dorado",
  "DORADO ROSA": "dorado rosa",
  PLATEADO: "plateado",
  ROJO: "rojo",
  ROJOS: "rojo",
  AZUL: "azul",
  AZULES: "azul",
  ROSADO: "rosado",
  ROSADOS: "rosado",
  ROSA: "rosado",
  VERDE: "verde",
  VERDES: "verde",
  BLANCO: "blanco",
  BLANCOS: "blanco",
  NEGRO: "negro",
  NEGROS: "negro",
  MORADO: "morado",
  NARANJA: "naranja",
  AMARILLO: "amarillo",
  FUCSIA: "fucsia",
  PLATA: "plateado",
  TRANSPARENTE: "transparente",
  MULTICOLOR: "multicolor",
  SURTIDO: "multicolor",
};

/** Colores presentes en tags o en el título — normalizados a una paleta corta. */
export function derivarColores(tags: string[], titulo: string): string[] {
  const encontrados = new Set<string>();
  for (const tag of tags) {
    const clave = tag.trim().toUpperCase();
    if (DICCIONARIO_COLOR[clave]) encontrados.add(DICCIONARIO_COLOR[clave]);
  }
  if (encontrados.size === 0) {
    const t = titulo.toUpperCase();
    for (const [clave, valor] of Object.entries(DICCIONARIO_COLOR)) {
      if (t.includes(clave)) encontrados.add(valor);
    }
  }
  return [...encontrados];
}

// Sempertex tagea muchos productos con el nombre en español Y en inglés a la
// vez (ver "QUINCE AÑOS" + "FIFTEEN YEARS" en el mismo producto) — parece ser
// justo el tag que alimenta las colecciones por ocasión del sitio público, así
// que hay que cubrir ambos idiomas o se pierden decenas de productos reales.
const MAPA_OCASION: Record<string, string> = {
  CUMPLEAÑOS: "cumpleanos",
  BIRTHDAY: "cumpleanos",
  "SAN VALENTIN": "san_valentin",
  "SAN VALENTÍN": "san_valentin",
  "AMOR Y AMISTAD": "san_valentin",
  "VALENTINE'S DAY": "san_valentin",
  "DIA DE LA MADRE": "dia_madre",
  "DÍA DE LA MADRE": "dia_madre",
  "MOTHER'S DAY": "dia_madre",
  "DIA DEL HOMBRE": "dia_padre",
  "DIA DEL PADRE": "dia_padre",
  "FATHER'S DAY": "dia_padre",
  "DIA DE LA MUJER": "dia_mujer",
  "WOMEN'S DAY": "dia_mujer",
  NAVIDAD: "navidad",
  CHRISTMAS: "navidad",
  HALLOWEEN: "halloween",
  GRADUACION: "graduacion",
  GRADUACIÓN: "graduacion",
  "XV AÑOS": "xv_anos",
  "QUINCE AÑOS": "xv_anos",
  "FIFTEEN YEARS": "xv_anos",
  BODA: "boda",
  WEDDING: "boda",
  "BABY SHOWER": "baby_shower",
};

function sinTildes(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Los tags de Shopify para ocasión son escasos y con redacción formal
 * ("DIA DE LA MADRE"), pero el título real del producto suele traer la
 * ocasión en lenguaje comercial suelto ("Feliz Dia Mami", "Te Amo",
 * "Tiara Árbol Navidad") que MAPA_OCASION nunca captura por tag exacto. Sin
 * esto, productos claramente atados a otra fecha quedan con `ocasiones: []`
 * y se cuelan como "genéricos" en cualquier búsqueda relajada por ocasión.
 */
const PATRONES_OCASION_TITULO: { patron: RegExp; ocasion: string }[] = [
  { patron: /\bDIA\s*(DE\s*LA\s*)?MAM[AI]\b/, ocasion: "dia_madre" },
  { patron: /\bDIA\s*(DEL\s*)?PAP[AI]\b|\bDIA\s*DEL\s*(PADRE|HOMBRE)\b/, ocasion: "dia_padre" },
  { patron: /\bDIA\s*DE\s*LA\s*MUJER\b/, ocasion: "dia_mujer" },
  { patron: /\bTE\s*AMO\b|\bTE\s*QUIERO\b|\bSAN\s*VALENTIN\b|\bAMOR\s*Y\s*AMISTAD\b/, ocasion: "san_valentin" },
  { patron: /\bNAVIDAD\b|\bPAPA\s*NOEL\b|\bREYES\s*MAGOS\b/, ocasion: "navidad" },
  { patron: /\bHALLOWEEN\b|\bCALABAZA\b|\bBRUJA\b|\bTELARA/, ocasion: "halloween" },
  { patron: /\bGRADUA/, ocasion: "graduacion" },
  { patron: /\bXV\s*ANOS\b|\bQUINCE\s*ANOS\b|\b15\s*ANOS\b/, ocasion: "xv_anos" },
  { patron: /\bBODA\b|\bMATRIMONIO\b/, ocasion: "boda" },
  { patron: /\bBABY\s*SHOWER\b/, ocasion: "baby_shower" },
  { patron: /\bCUMPLEA/, ocasion: "cumpleanos" },
];

export function derivarOcasiones(tags: string[], titulo: string): string[] {
  const encontradas = new Set<string>();
  for (const tag of tags) {
    const clave = tag.trim().toUpperCase();
    if (MAPA_OCASION[clave]) encontradas.add(MAPA_OCASION[clave]);
  }
  const tituloNormalizado = sinTildes(titulo.toUpperCase());
  for (const { patron, ocasion } of PATRONES_OCASION_TITULO) {
    if (patron.test(tituloNormalizado)) encontradas.add(ocasion);
  }
  return [...encontradas];
}

/**
 * Categoría del demo a partir de product_type + tags. Blacklist explícita
 * de tipos fuera de alcance (no son decoración de evento) — ver §0.4/§8.4:
 * cursos de capacitación, merchandising de marca para tiendas y bundles de
 * marketplace. Todo lo demás entra, incluido product_type vacío, para no
 * descartar productos buenos por una lista blanca incompleta.
 */
export const TIPOS_EXCLUIDOS = new Set(["CURSOS", "MERCHANDISING", "KIT MERCADOLIBRE"]);

export function tipoExcluido(productType: string | null): boolean {
  return productType ? TIPOS_EXCLUIDOS.has(productType.trim().toUpperCase()) : false;
}

export function derivarCategoria(productType: string | null, tags: string[]): string | null {
  const tipo = (productType ?? "").trim().toUpperCase();
  const t = new Set(tags.map((x) => x.trim().toUpperCase()));

  if (tipo === "LÁTEX" || tipo === "LATEX") {
    if (t.has("NUMEROS") || t.has("NÚMEROS") || t.has("LETRAS")) return "globo_numero_letra";
    return "globo_latex";
  }
  if (tipo.includes("METALIZAD")) return "globo_metalizado";
  if (tipo === "DESECHABLES") return "desechable";
  if (tipo === "DECORACION" || tipo === "DECORACIÓN") return "banderola_cartel";
  if (tipo.includes("VELAS")) return "vela";
  if (tipo === "FIESTAS PREDISEÑADAS") return "kit";
  if (tipo === "E-DECORS") return "guirnalda_arco";
  if (tipo.includes("COMPLEMENTOS")) return "complemento";
  if (tipo.includes("ACCESORIOS")) return "complemento";
  if (tipo.includes("EMPAQUES")) return "empaque";
  return null;
}

/** Paleta de colores controlada (plan §2.7) — valores posibles de derivarColores(). */
export const PALETA_COLORES = [...new Set(Object.values(DICCIONARIO_COLOR))];

const NOMBRES_CATEGORIA_SHOPIFY: Record<string, string> = {
  globo_latex: "Globo de látex",
  globo_metalizado: "Globo metalizado",
  globo_numero_letra: "Globo número o letra",
  banderola_cartel: "Banderola o cartel",
  vela: "Velas y accesorios",
  kit: "Kit de fiesta",
  guirnalda_arco: "Guirnalda / arco",
  complemento: "Complemento",
  empaque: "Empaque de regalo",
  desechable: "Desechable",
};

export function nombreCategoria(categoria: string | null): string {
  if (!categoria) return "Sin categoría";
  return NOMBRES_CATEGORIA_SHOPIFY[categoria] ?? categoria;
}

/** Categorías controladas (plan §2.7) — valores posibles de derivarCategoria(). */
export const CATEGORIAS_CATALOGO = Object.keys(NOMBRES_CATEGORIA_SHOPIFY);

const NOMBRES_FORMA: Record<string, string> = {
  redondo: "Redondo",
  corazon: "Corazón",
  link: "Link-O-Loon®",
  modelar: "Modelar (figuras)",
};

export function nombreForma(forma: string | null): string {
  if (!forma) return "Otra";
  return NOMBRES_FORMA[forma] ?? forma;
}

/** Formas controladas (plan de tamaños §F2) — valores posibles de `TamanoDecodificado.forma`. */
export const FORMAS_CATALOGO = Object.keys(NOMBRES_FORMA);

/**
 * Diámetros redondos estándar del catálogo (R-5/9/12/18/24/36/40) — el mismo
 * conjunto que ya usa el motor geométrico (`geometria.ts`) para sus mezclas.
 * Deja fuera diámetros raros/no-globo que aparecen sueltos en `option1` (ej.
 * "40", restos de empaque): el intérprete de consultas solo necesita
 * reconocer los tamaños que un cliente realmente pide por voz/texto.
 */
export const DIAMETROS_REDONDOS_CATALOGO = [5, 9, 12, 18, 24, 36, 40] as const;

const NOMBRES_OCASION: Record<string, string> = {
  cumpleanos: "Cumpleaños",
  san_valentin: "San Valentín",
  dia_madre: "Día de la madre",
  dia_padre: "Día del padre",
  dia_mujer: "Día de la mujer",
  navidad: "Navidad",
  halloween: "Halloween",
  graduacion: "Graduación",
  xv_anos: "XV años",
  boda: "Boda",
  baby_shower: "Baby shower",
};

export function nombreOcasion(ocasion: string): string {
  return NOMBRES_OCASION[ocasion] ?? ocasion;
}

/** Ocasiones controladas (plan §2.7) — valores posibles de derivarOcasiones(). */
export const OCASIONES_CATALOGO = Object.keys(NOMBRES_OCASION);

/** Title Case básico: el catálogo viene todo en MAYÚSCULAS, impresentable ante un consumidor final. */
export function limpiarTitulo(titulo: string): string {
  return titulo
    .toLowerCase()
    .replace(/(^|\s|\/|-)([a-záéíóúñ])/g, (_, sep, letra) => sep + letra.toUpperCase())
    .replace(/\bR-(\d)/gi, "R-$1")
    .trim();
}

/** Quita las etiquetas HTML de body_html para poder indexarlo en FTS5. */
export function textoPlano(html: string | null): string | null {
  if (!html) return null;
  const texto = html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return texto.length > 0 ? texto : null;
}
