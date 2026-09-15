import { clasificarColores, plegarTexto } from "@/lib/rag/taxonomy/v2";

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
 * instead of silently ignored.
 */
const SINONIMOS_FOTO: ReadonlyArray<readonly [RegExp, string]> = [
  [/\boff white\b/g, "crema"],
  [/\b(?:lilac|lavender)\b/g, "lila"],
  [/\bviolet\b/g, "violeta"],
  [/\b(?:maroon|wine|bordeaux|oxblood)\b/g, "burdeos"],
  [/\b(?:ivory|cream)\b/g, "crema"],
  [/\b(?:teal|aqua|turquoise|cyan)\b/g, "turquesa"],
  [/\b(?:peach|salmon)\b/g, "coral"],
  [/\b(?:tan|sand|khaki)\b/g, "beige"],
  [/\b(?:clear|transparent)\b/g, "transparente"],
];
const GRIS = /\b(?:gr[ae]y|graphite|charcoal|gris|grafito)\b/;

/** Words that join several colors inside one observed label ("white and gold"). */
const SEPARADOR_COLORES = /\s*(?:[,;/&+]|\b(?:and|with|plus|y|e|con)\b)\s*/;

/**
 * Catalog-vocabulary colors of one observed label, in reading order. Each part
 * of the label is ONE color: a shade written with two color words ("mint
 * green", "wine red", "silver grey") keeps its first, more specific word, so
 * it does not report a second color the photo never had.
 */
function coloresDeEtiqueta(etiqueta: string): string[] {
  const colores: string[] = [];
  for (const parte of plegarTexto(etiqueta).split(SEPARADOR_COLORES)) {
    let texto = parte;
    for (const [patron, color] of SINONIMOS_FOTO) texto = texto.replace(patron, color);
    const clasificacion = clasificarColores(texto);
    const conocido = clasificacion.status === "unknown" ? undefined : clasificacion.values.find((color) => color !== "multicolor");
    const color = conocido ?? (GRIS.test(texto) ? "gris" : undefined);
    if (color) colores.push(color);
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
export type ProductoColorDisponible = { product_id: string; titulo: string; en_busqueda: boolean };

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
  candidatos: ReadonlyArray<{ productId: string; titulo: string; categoria: string | null; colores: readonly string[]; variantes: ReadonlyArray<{ forma: string | null; colores: readonly string[]; disponible: boolean }> }>,
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
      if (!lista.some((item) => item.product_id === candidato.productId)) lista.push({ product_id: candidato.productId, titulo: candidato.titulo, en_busqueda: true });
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
export function coloresReferenciaOmitidos(
  estructuras: ReadonlyArray<{ estructura_id: string; nombre: string; colores_referencia?: readonly string[]; materiales: ReadonlyArray<{ color?: string }> }>,
  disponibles: ReadonlyMap<string, readonly ProductoColorDisponible[]>,
): ColorReferenciaOmitido[] {
  const omitidos: ColorReferenciaOmitido[] = [];
  for (const estructura of estructuras) {
    const usados = new Set(estructura.materiales.map((material) => normalizarColor(material.color ?? "")).filter(Boolean));
    for (const color of new Set((estructura.colores_referencia ?? []).map(normalizarColor))) {
      const productos = disponibles.get(color) ?? [];
      if (!color || usados.has(color) || productos.length === 0) continue;
      omitidos.push({ estructura_id: estructura.estructura_id, nombre: estructura.nombre, color, productos: [...productos] });
    }
  }
  return omitidos;
}
