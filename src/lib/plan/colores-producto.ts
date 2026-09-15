/**
 * Real colors of a catalog product.
 *
 * The derived catalog colors file grey balloons under "plateado" (Fashion Gris:
 * `derived.colors = ["plateado"]`, no variant colors), but grey is not silver:
 * the model read "plateado" in the search result, bought Fashion Gris as silver,
 * and the resolver told the customer "la foto muestra gris y esta pieza no lo
 * lleva" while the piece was the grey balloon (E2E 2026-09-15, ejemplo-07, rid
 * 849d29ca). A plan that asked for Fashion Gris in "gris" found no variant and
 * looped on SIN_COBERTURA.
 *
 * Rule: a product whose title names grey ("gris") and not silver ("plata",
 * "plateado", "silver") has the color "gris" instead of "plateado". Every
 * other product keeps its catalog colors. Colors are folded (lowercase, no
 * accents) and deduplicated in order.
 *
 * Mirror: `_product_colors` in services/ai-api/app/plan.py (parity vector
 * 19-gris-no-es-plateado). Pure: no provider, HTTP, database or environment.
 */
export const COLOR_GRIS = "gris";

function plegar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

const TITULO_GRIS = /\bgris\b/;
const TITULO_PLATA = /\b(?:plata|plateado|plateada|silver)\b/;

export function coloresRealesProducto(titulo: string | null | undefined, colores: readonly string[]): string[] {
  const plegados = [...new Set(colores.map(plegar).filter(Boolean))];
  const tituloPlegado = plegar(titulo ?? "");
  if (!TITULO_GRIS.test(tituloPlegado) || TITULO_PLATA.test(tituloPlegado)) return plegados;
  return [...new Set([COLOR_GRIS, ...plegados.filter((color) => color !== "plateado")])];
}

/**
 * Real colors of ONE variant, for the two decisions that need a single color:
 * which color a one-color product forces (coverage rule 1) and how a resolved
 * line is labelled.
 *
 * The ingest keeps sibling-variant and tag colors out of `derived_colors`, but a
 * product's `derived.colors` come from its tags too, which are Shopify color
 * FAMILIES: "Fashion Violeta" is tagged MORADOS, "Pastel Mate Nude" NARANJAS.
 * Merging both made a one-color balloon look multi-color, so the plan could
 * quote a violet balloon as "morado".
 *
 * Rule: the variant's colors when it has any; otherwise the merged set, never
 * an empty list (25 round latex products have no variant colors and two or more
 * product colors — Fashion Merlot [rojo, burdeos] — and an empty list is
 * uncoverable for the resolvers). Then the same grey correction.
 *
 * Mirror: `_variant_real_colors` in services/ai-api/app/plan.py (parity vector
 * 25-color-variante-primero).
 */
export function coloresRealesVariante(
  titulo: string | null | undefined,
  coloresVariante: readonly string[],
  coloresProducto: readonly string[],
): string[] {
  const propios = coloresVariante.map(plegar).filter(Boolean);
  return coloresRealesProducto(titulo, propios.length ? propios : [...coloresVariante, ...coloresProducto]);
}
