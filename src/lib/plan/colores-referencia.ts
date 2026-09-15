import type { ReferenceBlueprintV2 } from "@/lib/ia/reference-blueprint";
import { clasificarColores, PALETA_COLORES_V2, plegarTexto } from "@/lib/rag/taxonomy/v2";

/**
 * Dominant colors of a reference photo versus the colors a plan actually buys
 * (audit finding Alta #3). Regression: a burgundy photo became a silver and
 * white arch, and the columns of a second photo inherited the lilac palette of
 * the first one, all with `sustituciones: []`.
 *
 * Rule:
 * - The server copies into each plan structure with `referencia_element_id` the
 *   dominant colors of THAT element (`colores_referencia`): the first
 *   `MAX_COLORES_REFERENCIA` known colors of `appearance.observed_colors`, in the
 *   catalog vocabulary. With several photos each structure keeps the palette of
 *   its own photo. The model never writes the field.
 * - The other colors the analysis shows the customer (`coloresFotoCliente`) that
 *   no structure buys are appended to the first such structure, so no photo
 *   color is lost without a notice (E2E 2026-09-15; `aplicarColoresReferencia`).
 *   Only the element colors can make `confirmar_plan_decoracion` refuse a plan.
 * - Both resolvers (TypeScript here and `_reference_color_substitutions` in
 *   services/ai-api/app/plan.py) compare those colors with the colors of the
 *   structure's resolved lines and record every missing one in `sustituciones`,
 *   so the loss is visible in the plan and signed with it.
 *
 * Pure: no provider, HTTP, database or environment.
 */
export const MAX_COLORES_REFERENCIA = 3;

/**
 * English photo words the catalog taxonomy does not alias. "gris" is not a
 * catalog color: it is kept so a grey/graphite photo is reported as lost
 * instead of silently ignored. Names with no clear catalog color (copper,
 * bronze, taupe, terracotta) stay out on purpose: mapping them needs a product
 * decision, and inventing one would buy the wrong balloon.
 */
const SINONIMOS_FOTO: ReadonlyArray<readonly [RegExp, string]> = [
  // Before the generic "pink" alias: the catalog sells these as fucsia.
  [/\b(?:hot|neon|shocking)\s+pink\b/g, "fucsia"],
  [/\boff white\b/g, "crema"],
  [/\b(?:lilac|lavender|mauve)\b/g, "lila"],
  [/\bviolet\b/g, "violeta"],
  [/\b(?:maroon|wine|bordeaux|oxblood)\b/g, "burdeos"],
  [/\b(?:ivory|cream)\b/g, "crema"],
  [/\b(?:teal|aqua|turquoise|cyan)\b/g, "turquesa"],
  [/\b(?:peach|salmon)\b/g, "coral"],
  [/\b(?:tan|sand|khaki)\b/g, "beige"],
  [/\bnavy\b/g, "azul"],
  [/\b(?:sage|emerald|lime|olive)\b/g, "verde"],
  [/\bplum\b/g, "morado"],
];
const GRIS = /\b(?:gr[ae]y|graphite|charcoal|gris|grafito)\b/;

/**
 * Transparency is a finish, not a hue: the analyzer is told to prefix it
 * ("clear pink", "crystal blue") and the catalog sells the Cristal line in
 * several hues. Alone it is the color "transparente".
 */
const TRANSPARENCIA = /\b(?:clear|transparent|transparente|transparentes|crystal|cristal)\b/g;

/** Punctuation that joins several colors in one label ("white/gold"); the fold turns it into a space, so it has to be split first. */
const SEPARADOR_PUNTUACION = /[,;/&+]/;
/** Words that join several colors inside one observed label ("white and gold"). */
const SEPARADOR_COLORES = /\s*\b(?:and|with|plus|y|e|con)\b\s*/;

/**
 * Catalog-vocabulary color of one part of an observed label. A part is ONE
 * color: a shade written with two color words ("mint green", "wine red",
 * "silver grey") keeps its first, more specific word, so it does not report a
 * second color the photo never had.
 */
function colorDeParte(parte: string): string | undefined {
  let texto = parte;
  for (const [patron, color] of SINONIMOS_FOTO) texto = texto.replace(patron, color);
  const sinTransparencia = texto.replace(TRANSPARENCIA, " ");
  const transparente = sinTransparencia !== texto;
  texto = sinTransparencia;
  const clasificacion = clasificarColores(texto);
  const conocido = clasificacion.status === "unknown" ? undefined : clasificacion.values.find((color) => color !== "multicolor");
  return conocido ?? (GRIS.test(texto) ? "gris" : transparente ? "transparente" : undefined);
}

/** Catalog-vocabulary colors of one observed label, in reading order. */
function coloresDeEtiqueta(etiqueta: string): string[] {
  const colores: string[] = [];
  for (const bruto of etiqueta.split(SEPARADOR_PUNTUACION)) {
    for (const parte of plegarTexto(bruto).split(SEPARADOR_COLORES)) {
      const color = colorDeParte(parte);
      if (color) colores.push(color);
    }
  }
  return colores;
}

export function coloresDominantesReferencia(observados: readonly string[]): string[] {
  const colores: string[] = [];
  for (const etiqueta of observados) {
    for (const color of coloresDeEtiqueta(etiqueta)) {
      if (!colores.includes(color)) colores.push(color);
    }
  }
  return colores.slice(0, MAX_COLORES_REFERENCIA);
}

/**
 * Colors the analysis shows the customer as "the colors of your photo": the
 * first `MAX_COLORES_FOTO_CLIENTE` known colors of `palette.observed` (the
 * approved elements when the palette is empty), the same source and bound as
 * the analysis card (`coloresObservadosCliente`, presentacion-cliente.ts).
 */
export const MAX_COLORES_FOTO_CLIENTE = 5;

export function coloresFotoCliente(blueprint: Pick<ReferenceBlueprintV2, "palette" | "elements"> | undefined): string[] {
  if (!blueprint) return [];
  const observados = blueprint.palette.observed.length
    ? blueprint.palette.observed
    : blueprint.elements.filter((elemento) => elemento.approved).flatMap((elemento) => elemento.appearance.observed_colors);
  const colores: string[] = [];
  for (const etiqueta of observados) {
    for (const color of coloresDeEtiqueta(etiqueta)) {
      if (!colores.includes(color)) colores.push(color);
    }
  }
  return colores.slice(0, MAX_COLORES_FOTO_CLIENTE);
}

/** Dominant colors of one approved reference element (what `colores_referencia` starts with). */
export function coloresElementoReferencia(blueprint: Pick<ReferenceBlueprintV2, "elements"> | undefined, elementId: string | undefined): string[] {
  const elemento = elementId ? blueprint?.elements.find((item) => item.approved && item.element_id === elementId) : undefined;
  return elemento ? coloresDominantesReferencia(elemento.appearance.observed_colors) : [];
}

const COLORES_CATALOGO: ReadonlySet<string> = new Set(PALETA_COLORES_V2);

/**
 * Catalog colors a search must be able to return for a reference photo: the
 * dominant colors of its approved balloon structures, or of the photo palette
 * when it has none. A color the catalog does not sell ("gris") is left out, so
 * it never forces the relaxation ladder to drop the occasion for nothing.
 */
export function coloresFotoParaBusqueda(blueprint: Pick<ReferenceBlueprintV2, "palette" | "elements"> | undefined): string[] {
  if (!blueprint) return [];
  const estructuras = blueprint.elements.filter((elemento) => elemento.approved && elemento.category === "balloon_structure");
  const colores = estructuras.length
    ? [...new Set(estructuras.flatMap((elemento) => coloresDominantesReferencia(elemento.appearance.observed_colors)))]
    : coloresFotoCliente(blueprint).slice(0, MAX_COLORES_REFERENCIA);
  return colores.filter((color) => COLORES_CATALOGO.has(color));
}

function normalizarColor(color: string): string {
  return color.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

function unirColores(colores: readonly string[]): string {
  return colores.length <= 1 ? (colores[0] ?? "") : `${colores.slice(0, -1).join(", ")} y ${colores.at(-1)}`;
}

export type SustitucionColor = { estructura_id: string; pedido: string; entregado: string; motivo: string };

/**
 * One substitution per photo color that no resolved line of the structure has.
 * A structure without resolved lines is reported as uncovered by the resolver,
 * not as a color change. Mirror: `_reference_color_substitutions` (plan.py).
 */
export function sustitucionesColorReferencia(
  estructuraId: string,
  coloresReferencia: readonly string[],
  coloresLineas: ReadonlyArray<string | null | undefined>,
): SustitucionColor[] {
  const entregados: string[] = [];
  for (const color of coloresLineas) {
    const normalizado = color ? normalizarColor(color) : "";
    if (normalizado && !entregados.includes(normalizado)) entregados.push(normalizado);
  }
  if (entregados.length === 0) return [];
  const pedidos: string[] = [];
  for (const color of coloresReferencia) {
    const normalizado = normalizarColor(color);
    if (normalizado && !pedidos.includes(normalizado)) pedidos.push(normalizado);
  }
  return pedidos
    .filter((pedido) => !entregados.includes(pedido))
    .map((pedido) => ({
      estructura_id: estructuraId,
      pedido,
      entregado: entregados.join(", "),
      motivo: `La foto de referencia muestra ${pedido} y esta pieza no lo lleva: se armó con ${unirColores(entregados)}.`,
    }));
}

/** Size substitutions carry a size code ("R-12"); color substitutions carry a color. */
export function esSustitucionDeColor(sustitucion: { pedido: string }): boolean {
  return !/^R-\d/i.test(sustitucion.pedido.trim());
}

/** A catalog product that offers a photo color, and whether this turn's search already returned it. */
export type ProductoColorDisponible = {
  product_id: string;
  titulo: string;
  en_busqueda: boolean;
  /** Available round sizes (inches) inside the active catalog pool, when known. */
  diametros?: readonly number[];
};

export type ColorReferenciaOmitido = {
  estructura_id: string;
  nombre: string;
  color: string;
  productos: ProductoColorDisponible[];
};

/** Catalog categories whose products can build a balloon structure in a photo color. */
const CATEGORIAS_GLOBO_COLOR = new Set(["globo_latex"]);

/**
 * Photo colors each candidate of this turn's search offers as a round latex
 * balloon (the material a photo's balloon structure is built with). Pure.
 */
export function productosGloboPorColor(
  candidatos: ReadonlyArray<{ productId: string; titulo: string; categoria: string | null; colores: readonly string[]; variantes: ReadonlyArray<{ forma: string | null; colores: readonly string[]; disponible: boolean; diamPulg?: number | null }> }>,
  colores: readonly string[],
): Map<string, ProductoColorDisponible[]> {
  const buscados = new Set(colores.map(normalizarColor));
  const resultado = new Map<string, ProductoColorDisponible[]>();
  for (const candidato of candidatos) {
    if (!candidato.categoria || !CATEGORIAS_GLOBO_COLOR.has(candidato.categoria)) continue;
    const redondas = candidato.variantes.filter((variante) => variante.disponible && variante.forma === "redondo");
    if (redondas.length === 0) continue;
    const coloresProducto = new Set([...candidato.colores, ...redondas.flatMap((variante) => variante.colores)].map(normalizarColor));
    for (const color of buscados) {
      if (!coloresProducto.has(color)) continue;
      const lista = resultado.get(color) ?? [];
      if (!lista.some((item) => item.product_id === candidato.productId)) {
        const diametros = [...new Set(redondas.map((variante) => variante.diamPulg).filter((diametro): diametro is number => typeof diametro === "number"))];
        lista.push({ product_id: candidato.productId, titulo: candidato.titulo, en_busqueda: true, diametros });
      }
      resultado.set(color, lista);
    }
  }
  return resultado;
}

/**
 * Dominant photo colors a structure dropped although the catalog offers them
 * (E2E 2026-09-14: "Semiarcos rosa y plata" was quoted 100 % transparent with
 * three color notices while the active catalog had pink and silver balloons).
 * `sustitucionesColorReferencia` only reports the loss; this lets
 * `confirmar_plan_decoracion` refuse it while a real alternative exists. A color
 * the catalog does not offer (`disponibles` has no entry) is not returned: the
 * plan goes on and the resolver records the notice. Pure.
 */
export function coloresReferenciaOmitidos<E extends { estructura_id: string; nombre: string; colores_referencia?: readonly string[]; materiales: ReadonlyArray<{ color?: string }> }>(
  estructuras: readonly E[],
  disponibles: ReadonlyMap<string, readonly ProductoColorDisponible[]>,
  /** Whether a product can actually build this structure (its sizes fit the structure's mix). Default: yes. */
  sirveParaEstructura: (estructura: E, producto: ProductoColorDisponible) => boolean = () => true,
): ColorReferenciaOmitido[] {
  const omitidos: ColorReferenciaOmitido[] = [];
  for (const estructura of estructuras) {
    const usados = new Set(estructura.materiales.map((material) => normalizarColor(material.color ?? "")).filter(Boolean));
    for (const color of new Set((estructura.colores_referencia ?? []).map(normalizarColor))) {
      // A photo color no product can build in this structure's sizes is not
      // mandatory: claiming it would only trade the refusal for SIN_COBERTURA.
      const productos = (disponibles.get(color) ?? []).filter((producto) => sirveParaEstructura(estructura, producto)).map((producto) => ({ product_id: producto.product_id, titulo: producto.titulo, en_busqueda: producto.en_busqueda }));
      if (!color || usados.has(color) || productos.length === 0) continue;
      omitidos.push({ estructura_id: estructura.estructura_id, nombre: estructura.nombre, color, productos: [...productos] });
    }
  }
  return omitidos;
}
