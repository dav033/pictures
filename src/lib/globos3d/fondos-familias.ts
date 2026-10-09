import { FONDOS_CATALOGO } from "./fondos-escenografia";

/**
 * **Qué ids del catálogo de fondos se parecen entre sí y cuáles tienen una superficie donde se posan globos.** Lo usa la medida
 * con las detecciones (`medir-fondos.ts`, `medir-con-detecciones.ts`): el lector y la detección de fondos son dos llamadas
 * distintas y a la misma mesa le pueden poner ids vecinos («mesa_mantel» y «mesa_postres_mantel»), y una caja medida no debe
 * descartarse por eso. Puro.
 */

/** Los ids que se confunden entre sí a simple vista, por familia. Lo que no está aquí solo se parece a sí mismo. */
const FAMILIAS: ReadonlyArray<readonly string[]> = [
  ["mesa_mantel", "mesa_postres_mantel", "mesa_postres", "mesa_redonda_mantel", "mesa_imperial_mantel", "mesa_imperial", "mesa_redonda", "mesa_coctel", "mesa_coctel_licra", "mesa_regalos", "mesa_centro"],
  ["tapete_redondo", "alfombra_redonda"],
  ["pedestales", "peldanos", "base_hexagonal"],
  ["silla_tiffany", "silla_moderna"],
  ["sofa", "love_seat", "sillon"],
  ["aro_metalico", "aro_hexagonal", "arco_metalico"],
  ["pastel", "base_pastel"],
  ["cortina_luces", "cortina_flecos"],
];

const FAMILIA_DE: ReadonlyMap<string, number> = new Map(FAMILIAS.flatMap((ids, i) => ids.map((id): [string, number] => [id, i])));

/** ¿Los dos ids son el mismo fondo o de la misma familia? */
export const mismaFamiliaDeFondo = (a: string, b: string): boolean => a === b || (FAMILIA_DE.has(a) && FAMILIA_DE.get(a) === FAMILIA_DE.get(b));

/** Los ids de familia, para verificar contra el catálogo. */
export const IDS_CON_FAMILIA: readonly string[] = [...FAMILIA_DE.keys()];

/** Fuera de las mesas, lo que tiene una cara de arriba donde se paran dulces o globos: sus ids propios. */
const SUPERFICIES_SUELTAS = ["pedestales", "tapete_redondo", "peldanos", "base_hexagonal", "columna_griega", "alfombra_redonda", "base_pastel"] as const;

/** Los fondos y muebles de piso con una superficie encima (todas las mesas del catálogo y las bases): lo que se ve sobre ellos no es de la guirnalda. */
export const FONDOS_CON_SUPERFICIE: ReadonlySet<string> = new Set([...FONDOS_CATALOGO.filter((f) => f.grupo === "mesa").map((f) => f.id), ...SUPERFICIES_SUELTAS]);

/** Los ids sueltos declarados a mano (el test comprueba que existen en el catálogo). */
export const SUPERFICIES_DECLARADAS: readonly string[] = SUPERFICIES_SUELTAS;
