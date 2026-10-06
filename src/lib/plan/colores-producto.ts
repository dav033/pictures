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
 * "plateado", "silver") has the color "gris" instead of "plateado"; one whose
 * title names a wine shade (`TITULO_VINO`) has "burdeos" instead of "rojo".
 * Every other product keeps its catalog colors. Colors are folded (lowercase,
 * no accents) and deduplicated in order.
 *
 * Mirror: `_product_colors` in services/ai-api/app/plan.py (parity vector
 * 19-gris-no-es-plateado). Pure: no provider, HTTP, database or environment.
 */
export const COLOR_GRIS = "gris";
export const COLOR_BURDEOS = "burdeos";
/**
 * The catalog family each title-corrected color is filed under. A lookup by the stored colors has to ask for the
 * family too and then keep only the products whose real color (`coloresRealesProducto`) is the one asked for.
 */
export const FAMILIA_ARCHIVADA: Readonly<Record<string, string>> = { [COLOR_GRIS]: "plateado", [COLOR_BURDEOS]: "rojo" };

function plegar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

const TITULO_GRIS = /\bgris\b/;
const TITULO_PLATA = /\b(?:plata|plateado|plateada|silver)\b/;
/**
 * A wine shade in the title. The live catalog files all four wine products (Fashion Merlot round, Link-O-Loon and
 * Tubito, Metal Vinotinto) as "rojo", the Shopify color family. Auditoría de propiedades huérfanas (2026-10-05,
 * CASE-006): coverage rule 1 turned the photo's burgundy material into "rojo", the resolver then warned «la foto
 * muestra burdeos y esta pieza no lo lleva», and the material either left the plan or was painted red.
 */
const TITULO_VINO = /\b(?:merlot|vinotinto|vino tinto|burdeos|borgona|granate|marsala|burgundy|wine)\b/;

/**
 * The title rule of a color the catalog files under another family, as a Postgres regex (`\y` is ARE's word
 * boundary), for the search's hard color filter: asking for "burdeos" filtered on the stored "rojo" and never
 * returned Fashion Merlot or Metal Vinotinto. Same pattern as `TITULO_VINO`; `undefined` for any other color.
 */
export function patronTituloDeColorSql(color: string): string | undefined {
  return plegar(color) === COLOR_BURDEOS ? TITULO_VINO.source.replaceAll("\\b", "\\y") : undefined;
}

export function coloresRealesProducto(titulo: string | null | undefined, colores: readonly string[]): string[] {
  const tituloPlegado = plegar(titulo ?? "");
  const crudos = [...new Set(colores.map(plegar).filter(Boolean))];
  const plegados = TITULO_VINO.test(tituloPlegado) ? [...new Set(crudos.map((color) => (color === "rojo" ? COLOR_BURDEOS : color)))] : crudos;
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
