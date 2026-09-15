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
