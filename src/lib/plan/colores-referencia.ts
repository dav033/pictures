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

/** Catalog-vocabulary colors of one observed color label, in reading order. */
function coloresDeEtiqueta(etiqueta: string): string[] {
  let texto = plegarTexto(etiqueta);
  for (const [patron, color] of SINONIMOS_FOTO) texto = texto.replace(patron, color);
  const clasificacion = clasificarColores(texto);
  const colores: string[] = clasificacion.status === "unknown" ? [] : [...clasificacion.values];
  if (GRIS.test(texto)) colores.push("gris");
  return colores.filter((color) => color !== "multicolor");
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
