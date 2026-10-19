/**
 * El **acabado** que el analizador vio en una pieza, sacado de las etiquetas de color que ya escribe.
 *
 * **Por qué hace falta.** El acabado no se puede recuperar del color medido, y está medido: un dorado Reflex
 * (cromado) y un Moca Fashion (mate) tienen casi el mismo color promedio en una foto, porque un cromado va de
 * un reflejo casi blanco a una caída oscura y su media cae justo donde viven los marrones mates. Probado y
 * descartado: ni el reparto de claridad del grupo (un dorado cromado da 36 y un verde mate 35) ni tomar el
 * cuarto más cromático separan las dos familias de forma fiable.
 *
 * **De dónde sale entonces.** Del modelo, que sí lo ve: en las 10 fotos de la galería escribe `chrome gold`
 * (8 veces), `chrome silver` (4), `matte white` (6), `metallic gold`, `metallic silver`, `metallic rose gold`,
 * `pastel green` y `clear` (11) — 44 de 151 etiquetas nombran acabado, y son justo las que hacen falta: las
 * distintivas. Cuando solo dice `pink` o `gold`, aquí no se inventa nada y el cruce se queda sin restringir.
 *
 * No hace falta tocar el prompt congelado (v16): `observed_colors` ya viene en el blueprint.
 *
 * Puro: sin red, sin píxeles y sin estado.
 */

/** Las familias del catálogo Sempertex, tal como las nombra la tabla de color. */
export type FamiliaSempertex =
  | "fashion"
  | "pastelDusk"
  | "pastelMate"
  | "satin"
  | "silk"
  | "neon"
  | "metal"
  | "reflex"
  | "cristal";

/**
 * De la palabra del analizador a las familias que puede ser. Varias a propósito: «chrome» en el catálogo es
 * Reflex, pero Metal también se lee cromado en una foto, y de ahí no se puede decidir.
 */
type GrupoAcabado = "brillante" | "satinado" | "mate" | "pastel" | "neon" | "transparente";

const FAMILIAS_POR_PALABRA: ReadonlyArray<readonly [RegExp, GrupoAcabado, readonly FamiliaSempertex[]]> = [
  // Cromados y metalizados: brillo de espejo.
  [/\bchrome\b|\bchromed\b|\bcromad/i, "brillante", ["reflex", "metal"]],
  [/\bmetallic\b|\bmetalizad/i, "brillante", ["metal", "reflex"]],
  [/\bmirror\b|\bespejo\b/i, "brillante", ["reflex", "metal"]],
  // Satinados y perlados.
  [/\bsatin\b|\bsatinad/i, "satinado", ["satin", "silk"]],
  [/\bpearl|\bperlad|\bnacar|\bnácar|iridescent|tornasol/i, "satinado", ["silk", "satin"]],
  // Mates.
  [/\bmatte\b|\bmatt\b|\bmate\b/i, "mate", ["fashion", "pastelMate", "neon"]],
  // Pasteles.
  [/\bpastel\b/i, "pastel", ["pastelMate", "pastelDusk"]],
  // Neón.
  [/\bneon\b|\bneón\b|\bfluor/i, "neon", ["neon"]],
  // Transparentes.
  [/\bclear\b|\btransparent|\bcristal\b|\bcrystal\b/i, "transparente", ["cristal"]],
];

/** Una etiqueta del analizador que nombra, ella sola, una referencia del catálogo. */
export type ReferenciaNombrada = {
  /** La etiqueta tal cual la escribió el analizador. */
  etiqueta: string;
  /** Los códigos de las referencias que puede ser. Varias cuando el nombre no dice el acabado. */
  codigos: string[];
  /**
   * `nombre` cuando la etiqueta **es** un nombre de la lámina (`chrome gold` = la 970) y `palabras` cuando lo
   * es el color que nombra, pero con otras palabras (`forest green` = alguno de los doce verdes). Las dos
   * cuentan como «nombrado» —decir «un verde oscuro» es nombrar un color—, pero la segunda deja que elijan
   * los píxeles entre varias, que es para lo que están.
   */
  por: "nombre" | "palabras";
};

export type AcabadoObservado = {
  /** Las familias compatibles con lo que el modelo escribió. Vacío = no dijo nada y no se restringe. */
  familias: FamiliaSempertex[];
  /** Las etiquetas que nombraron un acabado, para poder explicar de dónde salió la restricción. */
  etiquetas: string[];
  /**
   * Las etiquetas que nombran **una referencia concreta**, porque el analizador y el catálogo usan el mismo
   * vocabulario: `chrome gold` es la 970, `chrome silver` la 981, `matte white` la 005, `metallic gold` la 570,
   * `clear` la 390. No es casualidad — los nombres en inglés del catálogo se escribieron contra el vocabulario
   * de producto de este repo— y es la señal más fuerte que hay: el modelo está nombrando el globo.
   *
   * Cuál de ellas le toca a cada color medido lo deciden los píxeles, no el orden de la lista.
   */
  nombradas: ReferenciaNombrada[];
};

/** Sin acentos, sin dobles espacios y en minúsculas: así se comparan dos nombres escritos por distinta mano. */
function plegar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Lo que el analizador dejó dicho sobre el acabado y, cuando lo nombra, sobre la referencia misma.
 *
 * Las familias salen de la **unión** de los acabados que nombra: una pieza con globos cromados y mates es lo
 * normal, y quedarse con la intersección dejaría fuera la mitad de sus globos. Afinar más lo hacen las
 * referencias nombradas, donde sí hay un color por etiqueta y los píxeles pueden elegir.
 *
 * `porNombreEn` es el índice del catálogo (nombre en inglés → código) y `porPalabras` el que resuelve una
 * etiqueta que la lámina no conoce por su nombre pero sí por su color (`forest green` → los verdes). Se
 * inyectan los dos en vez de importarlos para que este módulo siga siendo puro y para no cerrar un ciclo con
 * `referencia-sempertex.ts`, que ya importa de aquí.
 */
export function acabadoObservado(
  etiquetas: readonly string[],
  porNombreEn: ReadonlyMap<string, string[]> = new Map(),
  porPalabras: (etiqueta: string) => string[] = () => [],
): AcabadoObservado {
  const familias = new Set<FamiliaSempertex>();
  const grupos = new Set<GrupoAcabado>();
  const conAcabado: string[] = [];
  const nombradas: ReferenciaNombrada[] = [];
  for (const etiqueta of etiquetas) {
    let nombra = false;
    for (const [patron, grupo, suyas] of FAMILIAS_POR_PALABRA) {
      if (!patron.test(etiqueta)) continue;
      nombra = true;
      grupos.add(grupo);
      for (const familia of suyas) familias.add(familia);
    }
    if (nombra) conAcabado.push(etiqueta);
    const codigos = porNombreEn.get(plegar(etiqueta));
    if (codigos && codigos.length > 0) {
      nombradas.push({ etiqueta, codigos: [...codigos], por: "nombre" });
    } else {
      // La lámina no conoce esa etiqueta por su nombre; puede que sí conozca el color que nombra.
      const porPalabra = porPalabras(etiqueta);
      if (porPalabra.length > 0) nombradas.push({ etiqueta, codigos: porPalabra, por: "palabras" });
    }
  }
  // La familia solo se puede imponer a toda la pieza cuando **todas** sus etiquetas nombran el mismo acabado.
  // Basta una que no lo nombre —«light pink», «beige», «sand»— para que haya globos de acabado desconocido, y
  // aplicarles la familia del cromado los manda a un cromado que no son: medido en `ejemplo-02`, con «chrome
  // gold» entre rosas sin acabado, el rosa acababa en Dorado Rosa metalizado y el beige en Champaña cromada.
  // Con dos acabados distintos pasa lo mismo. En los dos casos trabaja solo lo que el modelo nombró por su
  // nombre, que sí va color por color.
  const todasNombranAcabado = etiquetas.length > 0 && conAcabado.length === etiquetas.length;
  const coherente = todasNombranAcabado && grupos.size === 1;
  return { familias: coherente ? [...familias] : [], etiquetas: conAcabado, nombradas };
}

export { plegar as plegarEtiqueta };
