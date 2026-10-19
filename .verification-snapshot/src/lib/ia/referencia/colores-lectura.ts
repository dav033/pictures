import type { ReferenceBlueprintV2 } from "./reference-blueprint";

/**
 * Reconciliación de los dos vocabularios de color de UNA misma lectura de la foto (2026-10-06).
 *
 * El modelo escribe cada pieza dos veces: `observed_colors` en inglés libre («matte light grey») y
 * `patron_color` con la paleta del catálogo, que no tiene gris. En el banco de la lectura, la foto de ejemplo 01
 * (dos columnas rosa, plata, blanco y transparentes) salió dos de tres veces con «matte light grey» en las
 * etiquetas y `blanco` en la disposición de la MISMA pieza: los globos blancos en sombra se nombraban grises, el
 * plan compraba gris (que el catálogo resuelve como plata) y el blanco desaparecía. Cuando la disposición pone
 * blanco y ninguna etiqueta dice blanco, el gris claro de las etiquetas ES ese blanco, con su acabado.
 *
 * Determinista y sin proveedor. Solo toca grises claros («light/pale grey»), nunca un gris a secas ni un gris
 * oscuro, y nunca cuando la pieza ya tiene una etiqueta blanca (entonces el gris claro es otro globo).
 */

type Elemento = ReferenceBlueprintV2["elements"][number];

const GRIS_CLARO = /\b(?:light|pale|very light)\s+gr[ae]y\b/i;
const ETIQUETA_BLANCA = /\b(?:white|ivory|cream|off[- ]white|blanc[oa]s?)\b/i;

export type CambioColorLectura = { element_id: string; antes: string; despues: string };

function etiquetasReconciliadas(elemento: Elemento): { etiquetas: string[]; cambios: CambioColorLectura[] } {
  const etiquetas = elemento.appearance.observed_colors;
  const patron = elemento.appearance.patron_color;
  const blancoEnLaDisposicion = Boolean(patron && [...patron.colores, ...(patron.motas ?? [])].includes("blanco"));
  if (!blancoEnLaDisposicion || etiquetas.some((etiqueta) => ETIQUETA_BLANCA.test(etiqueta)) || !etiquetas.some((etiqueta) => GRIS_CLARO.test(etiqueta))) {
    return { etiquetas, cambios: [] };
  }
  const cambios: CambioColorLectura[] = [];
  const nuevas = etiquetas.map((etiqueta) => {
    if (!GRIS_CLARO.test(etiqueta)) return etiqueta;
    const despues = etiqueta.replace(GRIS_CLARO, "white").replace(/\s+/g, " ").trim();
    cambios.push({ element_id: elemento.element_id, antes: etiqueta, despues });
    return despues;
  });
  return { etiquetas: [...new Set(nuevas)], cambios };
}

/** El blueprint con los grises claros reconciliados y la lista de cambios (para `decidir`). Mismo objeto si nada cambia. */
export function reconciliarColoresLectura(blueprint: ReferenceBlueprintV2): { blueprint: ReferenceBlueprintV2; cambios: CambioColorLectura[] } {
  const cambios: CambioColorLectura[] = [];
  const elements = blueprint.elements.map((elemento) => {
    if (!elemento.approved || elemento.category !== "balloon_structure") return elemento;
    const resultado = etiquetasReconciliadas(elemento);
    if (!resultado.cambios.length) return elemento;
    cambios.push(...resultado.cambios);
    return { ...elemento, appearance: { ...elemento.appearance, observed_colors: resultado.etiquetas } };
  });
  return cambios.length ? { blueprint: { ...blueprint, elements }, cambios } : { blueprint, cambios };
}
