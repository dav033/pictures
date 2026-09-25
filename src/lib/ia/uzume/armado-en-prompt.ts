import type { ArmadoBouquetResuelto } from "@/lib/plan/armado-bouquet";

/**
 * Lo que el prompt de imagen dice de una pieza con armado de bouquet
 * (ADR-0030), fuera de la frase que escribe Python.
 *
 * Python es el único dueño del armado y de su frase (`prompt_gemini`,
 * `prompt_lora`), que los constructores insertan tal cual. Lo que vive aquí es
 * el texto propio del prompt que tenía que dejar de contradecirla: el contrato
 * de cardinalidad y el de instancias ("exactamente una estructura") frente a un
 * armado de dos bouquets, la regla de conteo "aproximado" frente a un bouquet
 * de cinco globos contados uno a uno, y el bloque de tamaños que llamaba
 * "latex balloon" a un globo número o a una burbuja. Nada de esto cuenta ni
 * redacta un armado: lee `grupos` y el tipo de cada globo de la leyenda, que
 * decidió Python.
 *
 * Sin armado nada de esto se usa y el prompt es byte a byte el de siempre.
 *
 * Puro: sin proveedor, HTTP, base de datos ni variables de entorno.
 */

/**
 * Sustantivo del contrato de cardinalidad para una pieza cuyo armado forma dos
 * bouquets por instancia (un número a cada lado; Python no admite otro número
 * de grupos): "pair of matching balloon bouquets". Una pieza de un solo
 * bouquet conserva su sustantivo.
 */
export function sustantivoCardinalidadConArmado(sustantivo: string, grupos: number): string {
  return grupos === 2 ? `pair of matching ${sustantivo}s` : sustantivo;
}

/** Plural del sustantivo anterior ("pairs of matching balloon bouquets"), o `undefined` si no es uno de ellos. */
export function pluralCardinalidadConArmado(sustantivo: string): string | undefined {
  return sustantivo.startsWith("pair of matching ") ? `pairs${sustantivo.slice("pair".length)}` : undefined;
}

/**
 * Frase del contrato de cardinalidad cuando alguna pieza forma dos bouquets:
 * sin ella, "render exactly one structure" contradecía el "build two matching
 * bouquets" del armado.
 */
export const CARDINALIDAD_CON_PAR_DE_BOUQUETS = " A pair of matching balloon bouquets counts as one listed structure built as two separate bouquets standing side by side: render both bouquets.";

/**
 * Cierre de la línea del INSTANCE CONTRACT de una pieza con armado: su armado
 * (en COLOR VARIETY y en su `color_pattern`) manda sobre las instrucciones
 * genéricas de agrupar globos en arcos, guirnaldas o racimos.
 */
export function fraseInstanciaConArmado(grupos: number): string {
  const piezas = grupos === 2
    ? "two matching freestanding bouquets side by side that together hold its installed quantity"
    : "one freestanding bouquet";
  return ` Build it exactly as its BOUQUET ASSEMBLY in COLOR VARIETY says: ${piezas}, with exactly the balloons, levels and positions listed there; never merge its balloons into another structure or scatter them as loose balloons.`;
}

/**
 * Excepción a la regla de conteo perceptual del bloque DESIGN MATERIAL
 * ESTIMATE: un bouquet con armado se arma globo a globo.
 */
export const EXCEPCION_CONTEO_CON_ARMADO = " Exception: a structure with a BOUQUET ASSEMBLY is counted balloon by balloon; render exactly the balloons its assembly lists.";

/** Formas de látex del catálogo (`decodificarTamano`): R-, C-, LOL- y T-. */
const FORMAS_LATEX = new Set(["redondo", "corazon", "link", "modelar"]);

/**
 * Tipo de globo de la leyenda de Python en palabras del bloque de tamaños
 * (`descripcionFisicaTamano` usa la forma tal cual cuando no la conoce).
 */
const FORMA_POR_TIPO: Readonly<Record<string, string>> = {
  metalizado: "foil",
  numero: "foil number",
  burbuja: "bubble",
};

export type LineaMezclaReal = { diam_pulg: number; forma: string | null; unidades: number };

/**
 * `mezcla_real` de una estructura para el bloque BALLOON SIZE MIX
 * (`bloqueMezclaPorEstructura`).
 *
 * Sin armado, la de Python tal cual. Con armado, una línea que no es de látex
 * (un metalizado, un número o una burbuja: su código "32 IN" llega sin forma)
 * se nombra por el tipo que la leyenda de Python da a los globos de ese
 * diámetro. Sin esto el bloque, que es una restricción dura, pedía un
 * "32-inch latex balloon" donde el armado pone un número metalizado. Las
 * unidades y los diámetros son los de Python; solo cambia el nombre.
 */
export function mezclaRealConArmado(
  mezcla: readonly LineaMezclaReal[],
  armado?: Pick<ArmadoBouquetResuelto, "leyenda">,
): Array<{ diamPulg: number; forma: string | null; unidades: number }> {
  return mezcla.map((linea) => {
    const base = { diamPulg: linea.diam_pulg, forma: linea.forma, unidades: linea.unidades };
    if (!armado || (linea.forma !== null && FORMAS_LATEX.has(linea.forma))) return base;
    const tipos = [...new Set(armado.leyenda
      .filter((entrada) => entrada.tipo_globo !== "latex" && entrada.tamano_pulg === linea.diam_pulg)
      .map((entrada) => FORMA_POR_TIPO[entrada.tipo_globo])
      .filter((forma): forma is string => Boolean(forma)))];
    return tipos.length ? { ...base, forma: tipos.join(" or ") } : base;
  });
}
