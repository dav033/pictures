/**
 * El color del globo **inflado**, medido sobre la foto de producto de la tienda.
 * No es el color del catálogo.
 *
 * **Por qué existe.** El hexadecimal de la matriz de color de Sempertex es la
 * conversión del código PMS a sRGB, o sea el color de la **tinta**. El látex
 * inflado se estira, es translúcido y le entra luz, así que no es el mismo
 * color. Con el Frambuesa: la matriz dice `#a50050` y el globo medido es
 * `#e1375d`, **ΔE 23** — antes de que ningún modelo opine. Y el modelo obedece
 * la palabra: pedirle «wine red» por el tono de la tinta devolvió un burdeos
 * dos veces, a ΔE 38 y 33 del globo real.
 *
 * Sobre las 71 filas de esta tabla, la distancia entre la tinta y el globo es de
 * **ΔE 18,7 de media (mediana 17,2) y pasa de 10 en 59 de ellas**, en las dos
 * direcciones: el Dorado se aclara 28 puntos de L\* y el Rosado se oscurece 22.
 * No hay una regla que sustituya a medir.
 *
 * **Cómo se midió.** Promedio de los píxeles cromáticos de la foto de producto,
 * descartando los neutros (el fondo blanco de estudio y la sombra). Salieron 70
 * de las 88 referencias con foto. Las 18 que faltan son las que **no se pueden
 * medir así** y quedan fuera a propósito: un globo blanco, negro, plata, perla,
 * crema o cristal casi no tiene píxeles cromáticos, así que el promedio se
 * calcularía sobre el ruido del borde. El corte está en 10.000 píxeles y no es
 * discutible: las buenas tienen entre 24.000 y 82.000, y las malas 336 o menos
 * — no hay nada en medio. El caso extremo fue `809` Rosa Primaveral, con **1
 * píxel**, que es justo la referencia que `descriptor-perceptual.ts` describe a
 * mano y verificada: esta tabla no la reemplaza, la complementa.
 *
 * Es una medición sobre una foto de estudio, no un colorímetro: sirve para
 * decirle a un modelo de imagen cuán claro es de verdad el globo, no para
 * control de calidad de fábrica.
 *
 * **De dónde viene.** Se midió en el proyecto hermano `clasificador-decoraciones`
 * (`src/lib/colores/inflado.ts`, 2026-09-27) y aquí entra como DATO de este
 * repositorio, cruzado con la matriz de color por el código de referencia. No se
 * importa código del otro repositorio: se trae la medición.
 *
 * `color` y `familia` son la clave porque son lo que trae el vocabulario de
 * producto (`visual.color` y `visual.finish`): 19 nombres en inglés se repiten
 * en dos familias distintas —un «light pink» Fashion y uno Silk no son el mismo
 * globo—, así que el nombre solo no alcanza.
 */

/** Familias de textura de la matriz de color, tal como las nombra el catálogo. */
export type FamiliaSempertex =
  | "fashion"
  | "pastelMate"
  | "pastelDusk"
  | "satin"
  | "silk"
  | "neon"
  | "metal"
  | "reflex";

export type ColorInfladoMedido = {
  /** Código de referencia de la matriz de color. */
  codigo: string;
  /** Nombre en inglés, el mismo que usa el vocabulario de producto. */
  color: string;
  familia: FamiliaSempertex;
  /** El color medido del globo inflado. */
  inflado: string;
  /** El de la matriz (la tinta), para poder comparar. */
  tinta: string;
  /** Nombre comercial, solo para poder rastrear la fila. Nunca va a un prompt. */
  sempertex: string;
};

export const COLORES_INFLADOS_MEDIDOS: readonly ColorInfladoMedido[] = [
  { codigo: "009", color: "light pink", familia: "fashion", inflado: "#f2b6c8", tinta: "#f8a3bc", sempertex: "Rosado" },
  { codigo: "010", color: "blush pink", familia: "fashion", inflado: "#d8a1a3", tinta: "#d191a5", sempertex: "Palo de Rosa" },
  { codigo: "011", color: "pink", familia: "fashion", inflado: "#f2b6c8", tinta: "#e04b87", sempertex: "Rosa" },
  { codigo: "012", color: "hot pink", familia: "fashion", inflado: "#e44a80", tinta: "#e0457b", sempertex: "Fucsia" },
  { codigo: "014", color: "raspberry", familia: "fashion", inflado: "#e1375d", tinta: "#a50050", sempertex: "Frambuesa" },
  { codigo: "015", color: "red", familia: "fashion", inflado: "#e01b2b", tinta: "#e4002b", sempertex: "Rojo" },
  { codigo: "016", color: "dark red", familia: "fashion", inflado: "#820101", tinta: "#ba0c2f", sempertex: "Rojo Imperial" },
  { codigo: "018", color: "wine red", familia: "fashion", inflado: "#812a28", tinta: "#862633", sempertex: "Merlot" },
  { codigo: "020", color: "yellow", familia: "fashion", inflado: "#f6e702", tinta: "#fedd00", sempertex: "Amarillo" },
  { codigo: "021", color: "golden yellow", familia: "fashion", inflado: "#f4c505", tinta: "#f6be00", sempertex: "Amarillo Miel" },
  { codigo: "023", color: "mustard yellow", familia: "fashion", inflado: "#ddaa1d", tinta: "#b08a2e", sempertex: "Mostaza" },
  { codigo: "027", color: "sage green", familia: "fashion", inflado: "#95aa85", tinta: "#c0ccc0", sempertex: "Eucalipto" },
  { codigo: "029", color: "green", familia: "fashion", inflado: "#02ae26", tinta: "#00b140", sempertex: "Verde Trébol" },
  { codigo: "030", color: "green", familia: "fashion", inflado: "#43b88e", tinta: "#00af66", sempertex: "Verde" },
  { codigo: "031", color: "lime green", familia: "fashion", inflado: "#8ac85b", tinta: "#97d700", sempertex: "Verde Lima" },
  { codigo: "032", color: "dark green", familia: "fashion", inflado: "#007b45", tinta: "#007a53", sempertex: "Verde Selva" },
  { codigo: "035", color: "teal", familia: "fashion", inflado: "#015671", tinta: "#007396", sempertex: "Turquesa Profundo" },
  { codigo: "037", color: "aquamarine", familia: "fashion", inflado: "#7ec4c5", tinta: "#6bcaba", sempertex: "Aguamarina" },
  { codigo: "038", color: "turquoise", familia: "fashion", inflado: "#4bbbcf", tinta: "#008eaa", sempertex: "Azul Caribe" },
  { codigo: "040", color: "light blue", familia: "fashion", inflado: "#01b2e8", tinta: "#62b5e5", sempertex: "Azul" },
  { codigo: "041", color: "royal blue", familia: "fashion", inflado: "#2d4f9c", tinta: "#001489", sempertex: "Azul Rey" },
  { codigo: "044", color: "navy blue", familia: "fashion", inflado: "#172c59", tinta: "#1e22aa", sempertex: "Azul Naval" },
  { codigo: "050", color: "lavender", familia: "fashion", inflado: "#b698c1", tinta: "#9b7fd4", sempertex: "Lila" },
  { codigo: "051", color: "purple", familia: "fashion", inflado: "#542d86", tinta: "#440099", sempertex: "Violeta" },
  { codigo: "056", color: "purple", familia: "fashion", inflado: "#a42287", tinta: "#6b2c91", sempertex: "Orquídea Morada" },
  { codigo: "059", color: "coral", familia: "fashion", inflado: "#f58a84", tinta: "#f26b5b", sempertex: "Coral Tropical" },
  { codigo: "060", color: "peach", familia: "fashion", inflado: "#f6c09e", tinta: "#ffa06a", sempertex: "Durazno" },
  { codigo: "061", color: "orange", familia: "fashion", inflado: "#e75d1d", tinta: "#fe5000", sempertex: "Naranja" },
  { codigo: "062", color: "burnt orange", familia: "fashion", inflado: "#cc4b0c", tinta: "#be531c", sempertex: "Naranja Cobrizo" },
  { codigo: "070", color: "tan", familia: "fashion", inflado: "#976c41", tinta: "#c6a886", sempertex: "Moca" },
  { codigo: "071", color: "beige", familia: "fashion", inflado: "#decdaf", tinta: "#d3c3b0", sempertex: "Arena" },
  { codigo: "073", color: "nude beige", familia: "fashion", inflado: "#ca9e5d", tinta: "#c4a484", sempertex: "Latte" },
  { codigo: "074", color: "brown", familia: "fashion", inflado: "#835836", tinta: "#6b4c34", sempertex: "Café" },
  { codigo: "076", color: "dark brown", familia: "fashion", inflado: "#684c41", tinta: "#4a3728", sempertex: "Chocolate" },
  { codigo: "126", color: "sage green", familia: "pastelDusk", inflado: "#aad5ba", tinta: "#b2c2b0", sempertex: "Té Verde" },
  { codigo: "140", color: "light blue", familia: "pastelDusk", inflado: "#7396a9", tinta: "#a2b2bd", sempertex: "Azul" },
  { codigo: "150", color: "lavender", familia: "pastelDusk", inflado: "#ad809f", tinta: "#c9aec4", sempertex: "Lavanda" },
  { codigo: "620", color: "pale yellow", familia: "pastelMate", inflado: "#fbf6d1", tinta: "#fbf3b5", sempertex: "Amarillo" },
  { codigo: "640", color: "pale blue", familia: "pastelMate", inflado: "#a3d1ed", tinta: "#c3d7e4", sempertex: "Azul" },
  { codigo: "661", color: "nude beige", familia: "pastelMate", inflado: "#edd5bd", tinta: "#e0bba8", sempertex: "Nude" },
  { codigo: "663", color: "pale pink", familia: "pastelMate", inflado: "#e0c4b8", tinta: "#ecc7cd", sempertex: "Melón" },
  { codigo: "409", color: "light pink", familia: "satin", inflado: "#eea5be", tinta: "#f49fc9", sempertex: "Rosado" },
  { codigo: "412", color: "pink", familia: "satin", inflado: "#e581a4", tinta: "#f5b6cd", sempertex: "Fucsia" },
  { codigo: "440", color: "light blue", familia: "satin", inflado: "#b1d5e0", tinta: "#69b3e7", sempertex: "Azul" },
  { codigo: "450", color: "lavender", familia: "satin", inflado: "#b595ca", tinta: "#a3a9d5", sempertex: "Lila" },
  { codigo: "826", color: "mint green", familia: "silk", inflado: "#8cb0ae", tinta: "#a8d5ba", sempertex: "Verde Menta" },
  { codigo: "839", color: "light blue", familia: "silk", inflado: "#7d9bab", tinta: "#a9c9de", sempertex: "Azul Ártico" },
  { codigo: "850", color: "lavender", familia: "silk", inflado: "#9088aa", tinta: "#9b8bb4", sempertex: "Amatista" },
  { codigo: "870", color: "gold", familia: "silk", inflado: "#af9b78", tinta: "#c9a227", sempertex: "Dorado" },
  { codigo: "212", color: "hot pink", familia: "neon", inflado: "#ea5190", tinta: "#d0006f", sempertex: "Fucsia" },
  { codigo: "220", color: "yellow", familia: "neon", inflado: "#dee94d", tinta: "#ffe900", sempertex: "Amarillo" },
  { codigo: "230", color: "green", familia: "neon", inflado: "#95cd49", tinta: "#44d62c", sempertex: "Verde" },
  { codigo: "240", color: "blue", familia: "neon", inflado: "#609fd6", tinta: "#009ace", sempertex: "Azul" },
  { codigo: "261", color: "orange", familia: "neon", inflado: "#f09356", tinta: "#ff8200", sempertex: "Naranja" },
  { codigo: "512", color: "hot pink", familia: "metal", inflado: "#e3437f", tinta: "#da1884", sempertex: "Fucsia" },
  { codigo: "515", color: "red", familia: "metal", inflado: "#b21827", tinta: "#d50032", sempertex: "Rojo" },
  { codigo: "530", color: "dark green", familia: "metal", inflado: "#158536", tinta: "#046a38", sempertex: "Verde" },
  { codigo: "540", color: "navy blue", familia: "metal", inflado: "#005f9f", tinta: "#003087", sempertex: "Azul" },
  { codigo: "568", color: "rose gold", familia: "metal", inflado: "#eea798", tinta: "#b76e79", sempertex: "Dorado Rosa" },
  { codigo: "570", color: "gold", familia: "metal", inflado: "#deb25b", tinta: "#8c6b30", sempertex: "Dorado" },
  { codigo: "909", color: "light pink", familia: "reflex", inflado: "#a06973", tinta: "#e4a0b7", sempertex: "Rosado" },
  { codigo: "912", color: "magenta", familia: "reflex", inflado: "#82455b", tinta: "#c71585", sempertex: "Fucsia" },
  { codigo: "915", color: "red", familia: "reflex", inflado: "#a62d2f", tinta: "#c8102e", sempertex: "Cristal Rojo" },
  { codigo: "931", color: "lime green", familia: "reflex", inflado: "#83a35a", tinta: "#a4d65e", sempertex: "Verde Lima" },
  { codigo: "932", color: "teal", familia: "reflex", inflado: "#3b8b7c", tinta: "#00a499", sempertex: "Verde Aurora" },
  { codigo: "940", color: "blue", familia: "reflex", inflado: "#417693", tinta: "#0076a8", sempertex: "Azul" },
  { codigo: "944", color: "navy blue", familia: "reflex", inflado: "#4c5b72", tinta: "#2a3a6b", sempertex: "Azul Galaxy" },
  { codigo: "951", color: "purple", familia: "reflex", inflado: "#815b9d", tinta: "#7a4183", sempertex: "Violeta" },
  { codigo: "968", color: "rose gold", familia: "reflex", inflado: "#c27469", tinta: "#c08081", sempertex: "Dorado Rosa" },
  { codigo: "970", color: "gold", familia: "reflex", inflado: "#a08344", tinta: "#c5a253", sempertex: "Dorado" },
  { codigo: "971", color: "champagne beige", familia: "reflex", inflado: "#b19c89", tinta: "#dccfb4", sempertex: "Champaña" },
];

/**
 * Cómo se dice cada familia en `visual.finish` del vocabulario de producto.
 * Un acabado que no esté aquí no tiene medición y se queda como está.
 */
const FAMILIA_DE_ACABADO: Readonly<Record<string, FamiliaSempertex>> = {
  "solid fashion": "fashion",
  fashion: "fashion",
  "pastel matte": "pastelMate",
  "pastel dusk muted": "pastelDusk",
  "pastel dusk": "pastelDusk",
  satin: "satin",
  "silk satin": "silk",
  silk: "silk",
  "neon fluorescent": "neon",
  neon: "neon",
  metallic: "metal",
  "matte metallic": "metal",
  "metallic sheen": "metal",
  "reflex high-shine": "reflex",
  "glossy chrome": "reflex",
};

const normalizar = (valor: string) => valor.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Las mediciones por `color|familia`, y **cuántas** hay con esa clave.
 *
 * Dos claves tienen dos filas cada una: `green|fashion` (el Verde Trébol `029`
 * y el Verde `030`) y `purple|fashion` (el Violeta `051` y la Orquídea Morada
 * `056`). El catálogo les puso el mismo nombre en inglés y son globos
 * distintos —el Trébol mide `#02ae26` y el Verde `#43b88e`—, así que con el
 * nombre y el acabado no se puede saber cuál es. Esas cuatro filas se consultan
 * como **ambiguas** y no se usan: mejor quedarse con el nombre del catálogo que
 * describir el globo equivocado. Siguen en la tabla porque son mediciones
 * válidas y, con una clave mejor (el código de referencia), servirían.
 */
const POR_CLAVE = new Map<string, { fila: ColorInfladoMedido; cuantas: number }>();
for (const fila of COLORES_INFLADOS_MEDIDOS) {
  const clave = `${normalizar(fila.color)}|${fila.familia}`;
  const previo = POR_CLAVE.get(clave);
  POR_CLAVE.set(clave, { fila: previo?.fila ?? fila, cuantas: (previo?.cuantas ?? 0) + 1 });
}

/** La familia de un `visual.finish`, o `null` si ese acabado no es de la matriz. */
export function familiaDeAcabado(acabado: string): FamiliaSempertex | null {
  return FAMILIA_DE_ACABADO[normalizar(acabado)] ?? null;
}

/**
 * La medición del globo inflado de ese color y ese acabado, o `null`.
 *
 * `null` es lo normal en un neutro (no se puede medir), en un surtido («assorted
 * colors»), en un color que no está en la matriz y en las dos claves ambiguas:
 * quien pregunta se queda con lo que ya decía.
 */
export function colorInfladoMedido(color: string, acabado: string): ColorInfladoMedido | null {
  const familia = familiaDeAcabado(acabado);
  if (!familia) return null;
  const encontrado = POR_CLAVE.get(`${normalizar(color)}|${familia}`);
  return encontrado && encontrado.cuantas === 1 ? encontrado.fila : null;
}

/** Si ese color y ese acabado caen en una clave que describe dos globos distintos. */
export function medicionAmbigua(color: string, acabado: string): boolean {
  const familia = familiaDeAcabado(acabado);
  if (!familia) return false;
  return (POR_CLAVE.get(`${normalizar(color)}|${familia}`)?.cuantas ?? 0) > 1;
}
