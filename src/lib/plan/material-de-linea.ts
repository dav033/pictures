/**
 * De qué material de su pieza sale cada línea que Python resolvió. Puro, sin red ni React: lo usan el editor de la
 * guiada (cuántos globos lleva cada color), la leyenda de la pieza (nombre y tono Sempertex de cada número) y el
 * blueprint de la imagen (papel y orden de cada color). NO cuenta globos: reparte entre los materiales las unidades
 * que Python ya contó.
 *
 * Por qué existe (verificador 127, 2026-10-07): los tres sitios emparejaban línea y material solo por `product_id`.
 * Un plan con `variant_overrides` (la idea «Dos columnas rosa, lila y dorado» compra el lila como Pastel Dusk Lavanda,
 * otro producto) dejaba el lila con 0 globos: «Que lleve N globos» devolvía null y el cliente leía «deja al menos un
 * globo de cada color», el rótulo salía sin nombre Sempertex y en la imagen el lila pasaba a «principal».
 *
 * Orden de lectura de una línea (la primera que responde gana):
 * 1. La suya: misma variante, o mismo producto y color (`indice_material_para_linea` de Python; un material sin
 *    color se queda las líneas de su producto, como hacía el editor).
 * 2. La de una sustitución: la línea la compra un `variant_overrides` (su producto y su variante; o su producto y su
 *    color, si el reparto de paquetes la compró en otra presentación). Va al material cuya variante sustituye
 *    (`objetivo_variant_id`); si sustituye otro tamaño de ese material, al material de las otras sustituciones del
 *    mismo globo; si no, al único material sin líneas propias del color sustituido, o al único sin líneas propias.
 * 3. Mismo producto aunque el color no coincida (Python renombra el color de una línea con `_line_color`): el
 *    primer material de ese producto, como hacía el blueprint.
 */

export type MaterialDeLinea = { product_id: string; variant_id?: string | undefined; color?: string | undefined };
export type SustitucionDeLinea = { objetivo_variant_id: string; product_id: string; variant_id: string; color?: string | undefined };
export type PiezaDeLineas = { materiales: readonly MaterialDeLinea[]; variant_overrides?: readonly SustitucionDeLinea[] | undefined };
export type LineaDeMaterial = { product_id: string; variant_id: string; color?: string | null | undefined };

function normal(texto: string | null | undefined): string {
  return (texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLocaleLowerCase("es");
}

/** La línea salió de este material por sí misma: misma variante, o mismo producto y color (o material sin color). */
export function esLineaPropia(material: MaterialDeLinea, linea: LineaDeMaterial): boolean {
  if (material.product_id !== linea.product_id) return false;
  if (material.variant_id && material.variant_id === linea.variant_id) return true;
  return !material.color || normal(material.color) === normal(linea.color);
}

/**
 * El material del que la línea sale por sí misma (paso 1), o -1. Es lo que Python acepta como objetivo de «quitar»:
 * una línea comprada por una sustitución no la encuentra (`material_no_editable`).
 */
export function indiceMaterialPropio(materiales: readonly MaterialDeLinea[], linea: LineaDeMaterial): number {
  const exacta = materiales.findIndex((material) => material.product_id === linea.product_id && Boolean(material.variant_id) && material.variant_id === linea.variant_id);
  return exacta >= 0 ? exacta : materiales.findIndex((material) => esLineaPropia(material, linea));
}

/** Las sustituciones de la pieza que compran esta línea (por variante; si ninguna, por producto y color). */
function sustitucionesDeLinea(pieza: PiezaDeLineas, linea: LineaDeMaterial): SustitucionDeLinea[] {
  const sustituciones = pieza.variant_overrides ?? [];
  const porVariante = sustituciones.filter((item) => item.product_id === linea.product_id && item.variant_id === linea.variant_id);
  if (porVariante.length) return porVariante;
  const color = normal(linea.color);
  return color ? sustituciones.filter((item) => item.product_id === linea.product_id && Boolean(item.color) && normal(item.color) === color) : [];
}

/** El material que una sustitución reemplaza (paso 2), o -1. `sinPropias`: materiales sin ninguna línea propia. */
function materialDeSustitucion(pieza: PiezaDeLineas, sustitucion: SustitucionDeLinea, sinPropias: ReadonlySet<number>): number {
  const { materiales } = pieza;
  const porObjetivo = (objetivo: string) => materiales.findIndex((material) => Boolean(material.variant_id) && material.variant_id === objetivo);
  const directo = porObjetivo(sustitucion.objetivo_variant_id);
  if (directo >= 0) return directo;
  // Otro tamaño del mismo material: las sustituciones hermanas (mismo globo nuevo) que sí apuntan a su variante.
  const hermanas = new Set((pieza.variant_overrides ?? [])
    .filter((item) => item.product_id === sustitucion.product_id && normal(item.color) === normal(sustitucion.color))
    .map((item) => porObjetivo(item.objetivo_variant_id))
    .filter((indice) => indice >= 0));
  if (hermanas.size === 1) return [...hermanas][0]!;
  const libres = [...sinPropias];
  const delColor = sustitucion.color ? libres.filter((indice) => normal(materiales[indice]?.color) === normal(sustitucion.color)) : [];
  if (delColor.length === 1) return delColor[0]!;
  return libres.length === 1 ? libres[0]! : -1;
}

/**
 * El índice del material de cada línea de la pieza (en el orden de `lineas`), o -1 si ninguno la explica. Cada línea
 * va a UN material, así que la suma por material es el total de la pieza.
 */
export function materialesDeLineas(pieza: PiezaDeLineas, lineas: readonly LineaDeMaterial[]): number[] {
  const propias = lineas.map((linea) => indiceMaterialPropio(pieza.materiales, linea));
  const conPropias = new Set(propias.filter((indice) => indice >= 0));
  const sinPropias = new Set(pieza.materiales.map((_, indice) => indice).filter((indice) => !conPropias.has(indice)));
  return lineas.map((linea, posicion) => {
    const propia = propias[posicion]!;
    if (propia >= 0) return propia;
    for (const sustitucion of sustitucionesDeLinea(pieza, linea)) {
      const indice = materialDeSustitucion(pieza, sustitucion, sinPropias);
      if (indice >= 0) return indice;
    }
    return pieza.materiales.findIndex((material) => material.product_id === linea.product_id);
  });
}

/** Las líneas de cada material, en el orden de `materiales` (cada línea en uno solo). */
export function lineasPorMaterial<L extends LineaDeMaterial>(pieza: PiezaDeLineas, lineas: readonly L[]): L[][] {
  const indices = materialesDeLineas(pieza, lineas);
  return pieza.materiales.map((_, indice) => lineas.filter((__, posicion) => indices[posicion] === indice));
}
