// Detección SIN VISIÓN de comparaciones de tamaño mal planteadas en un caption.
//
// Motivación (chequeo visual v001, reports/resultados-chequeo-visual-proporcion-v001.md): la
// auditoría de tamaños da 0/401 "inventados" y aun así hay captions con la comparación mal.
// Son defectos distintos: aquella busca una MEDIDA que no está en el pedido; esta busca una
// RELACIÓN entre medidas que el pedido contradice. Ejemplo real (orden #13309): el caption dice
// "large gold chrome ... smaller and medium pearl white", pero el pedido trae REFLEX DORADO solo
// en R-9/R-5 y SATIN PERLA hasta R-12 -- los blancos son necesariamente los más grandes. Ninguna
// medida fue inventada, así que el audit viejo no lo veía.
//
// Diseño deliberadamente CONSERVADOR (alta precisión, baja cobertura): es un filtro para
// revisión humana, y un falso positivo cuesta más que un falso negativo porque erosiona la
// confianza en la herramienta. Por eso: solo colores con mapeo inequívoco, solo globo redondo,
// y cuando un color aparece descrito como grande Y como chico a la vez no se concluye nada.

import { decodificarTamano } from "../../src/lib/shopify/derivar";

export type LineaDesglose = { producto: string; variante?: string | null };

/**
 * Colores con traducción inequívoca entre el nombre de producto (español, Shopify) y el
 * vocabulario que usan los captions (inglés). Se omiten a propósito los ambiguos: "blue" a secas
 * no se mapea porque el catálogo tiene AZUL NAVAL, AZUL REY y AZUL CARIBE y elegir uno sería
 * adivinar. Cada entrada exige que el nombre del producto contenga `es` y el caption `en`.
 */
const COLORES: Array<{ id: string; es: RegExp; en: RegExp }> = [
  { id: "dorado", es: /\bDORADO\b/, en: /\bgold(?:en)?\b/i },
  { id: "plata", es: /\bPLATA\b/, en: /\bsilver\b/i },
  { id: "blanco", es: /\bBLANCO\b/, en: /\bwhite\b/i },
  { id: "perla", es: /\bPERLA\b|\bNACAR\b/, en: /\bpearl\b/i },
  { id: "negro", es: /\bNEGRO\b/, en: /\bblack\b/i },
  { id: "navy", es: /\bAZUL NAVAL\b/, en: /\bnavy\b/i },
  { id: "azul_rey", es: /\bAZUL REY\b/, en: /\broyal blue\b/i },
  { id: "azul_caribe", es: /\bAZUL CARIBE\b/, en: /\b(?:caribbean|turquoise|teal)\b/i },
  { id: "rosado", es: /\bROSADO\b/, en: /\bpink\b/i },
  { id: "lila", es: /\bLILA\b/, en: /\blilac\b/i },
  { id: "morado", es: /\bMORADA?\b|\bORQUIDEA\b/, en: /\b(?:purple|orchid)\b/i },
  { id: "violeta", es: /\bVIOLETA\b/, en: /\bviolet\b/i },
  { id: "rojo", es: /\bROJO\b/, en: /\bred\b/i },
  { id: "naranja", es: /\bNARANJA\b/, en: /\borange\b/i },
  { id: "amarillo", es: /\bAMARILLO\b/, en: /\byellow\b/i },
  { id: "lima", es: /\bVERDE LIMA\b/, en: /\blime\b/i },
  { id: "eucalipto", es: /\bEUCALIPTO\b/, en: /\b(?:eucalyptus|sage)\b/i },
  { id: "terracota", es: /\bTERRACOTA\b/, en: /\bterra ?cotta\b/i },
  { id: "arena", es: /\bARENA\b/, en: /\bsand\b/i },
  { id: "crema", es: /\bCREMA\b/, en: /\bcream\b/i },
  { id: "chocolate", es: /\bCHOCOLATE\b/, en: /\bchocolate\b/i },
  { id: "moca", es: /\bMOCA\b/, en: /\bmocha\b/i },
  { id: "merlot", es: /\bMERLOT\b/, en: /\b(?:merlot|burgundy)\b/i },
  { id: "coral", es: /\bCORAL\b/, en: /\bcoral\b/i },
  { id: "latte", es: /\bLATTE\b/, en: /\blatte\b/i },
  { id: "frambuesa", es: /\bFRAMBUESA\b/, en: /\braspberry\b/i },
  { id: "cafe", es: /\bCAFE\b/, en: /\b(?:coffee|brown)\b/i },
];

const GRANDE = /\b(?:large[rs]?|largest|big(?:ger|gest)?|oversized|jumbo|giant|huge)\b/gi;
const CHICO = /\b(?:small(?:er|est)?|mini|tiny|little)\b/gi;

/** "varios tamaños" declarado explícitamente, sin nombrar cuáles. */
const VARIACION = /\b(?:varying|varied|mixed|different|assorted|multiple)\s+(?:\w+\s+){0,2}sizes?\b|\bin mixed sizes\b|\bsizes? (?:vary|varies)\b|\bof varying (?:size|scale)\b/i;

function normalizar(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase();
}

/** Diámetros de globo REDONDO por color, según el pedido real. */
export function diametrosRedondosPorColor(lineas: LineaDesglose[]): Map<string, { min: number; max: number }> {
  const porColor = new Map<string, { min: number; max: number }>();
  for (const linea of lineas) {
    if (!linea.variante) continue;
    const decodificado = decodificarTamano(linea.variante.split("/")[0]?.trim() ?? "");
    if (decodificado?.forma !== "redondo" || decodificado.diamPulg == null) continue;
    const nombre = normalizar(linea.producto);
    for (const color of COLORES) {
      if (!color.es.test(nombre)) continue;
      const previo = porColor.get(color.id);
      porColor.set(color.id, {
        min: previo ? Math.min(previo.min, decodificado.diamPulg) : decodificado.diamPulg,
        max: previo ? Math.max(previo.max, decodificado.diamPulg) : decodificado.diamPulg,
      });
    }
  }
  return porColor;
}

/** Todos los diámetros redondos distintos del pedido, sin importar color. */
export function diametrosRedondos(lineas: LineaDesglose[]): number[] {
  const set = new Set<number>();
  for (const linea of lineas) {
    if (!linea.variante) continue;
    const d = decodificarTamano(linea.variante.split("/")[0]?.trim() ?? "");
    if (d?.forma === "redondo" && d.diamPulg != null) set.add(d.diamPulg);
  }
  return [...set].sort((a, b) => a - b);
}

type Marca = { indice: number; clase: "grande" | "chico" };

/**
 * Asigna a cada color mencionado el adjetivo de tamaño más cercano que lo PRECEDE, dentro de una
 * ventana corta. Elegir el más cercano precedente (y no una ventana hacia adelante) es lo que
 * hace que una enumeración funcione bien: en "small silver, pink, and lilac balloons" los tres
 * colores cuelgan del mismo "small", que es la lectura correcta.
 */
export function tamanoDeclaradoPorColor(texto: string, ventana = 80): Map<string, Set<"grande" | "chico">> {
  const marcas: Marca[] = [];
  for (const m of texto.matchAll(GRANDE)) marcas.push({ indice: m.index ?? 0, clase: "grande" });
  for (const m of texto.matchAll(CHICO)) marcas.push({ indice: m.index ?? 0, clase: "chico" });
  marcas.sort((a, b) => a.indice - b.indice);

  const resultado = new Map<string, Set<"grande" | "chico">>();
  for (const color of COLORES) {
    for (const m of texto.matchAll(new RegExp(color.en.source, "gi"))) {
      const posicion = m.index ?? 0;
      let mejor: Marca | null = null;
      for (const marca of marcas) {
        if (marca.indice >= posicion) break;
        if (posicion - marca.indice <= ventana) mejor = marca;
      }
      if (!mejor) continue;
      if (!resultado.has(color.id)) resultado.set(color.id, new Set());
      resultado.get(color.id)!.add(mejor.clase);
    }
  }
  return resultado;
}

export type HallazgoComparacion = {
  regla: "inversion_color" | "variacion_sin_respaldo" | "ratio_calculado";
  detalle: string;
};

/**
 * Ratio obtenido dividiendo los dos números del pedido en vez de mirando la foto. El caso
 * canónico es "R-9 es aproximadamente 1.8 veces el diámetro de R-5" (9÷5 = 1.8), que aparece
 * literalmente en 16 captions distintos: no describe ninguna imagen en particular, y en al menos
 * uno (#950000181) la foto lo desmiente porque los anclajes reales son varias veces mayores.
 *
 * A diferencia de las otras dos reglas, esta NO depende de que el desglose esté completo -- es
 * una propiedad del texto -- así que corre también sobre las entradas del blog, que es
 * justamente donde está el problema.
 */
const RATIO_CALCULADO = /\b(?:roughly|about|approximately|around)?\s*(\d+(?:\.\d+)?)\s*times\s+(?:the\s+)?(?:diameter|size|larger)/i;

export function detectarRatioCalculado(texto: string): HallazgoComparacion | null {
  const m = texto.match(RATIO_CALCULADO);
  if (!m) return null;
  const ratio = Number(m[1]);
  // Los cocientes exactos entre calibres del catálogo (9/5=1.8, 12/9≈1.33, 18/12=1.5, 24/12=2,
  // 36/12=3, 12/5=2.4) son la firma de la división. Un número redondo observado a ojo ("about
  // twice") se escribe con palabras, no con un decimal.
  const sospechosos = [1.8, 1.3, 1.33, 1.5, 2.4, 3.6, 2.2];
  if (!sospechosos.includes(ratio)) return null;
  return {
    regla: "ratio_calculado",
    detalle: `cita un ratio de ${ratio}x que es el cociente exacto entre dos calibres del catálogo -- se calculó dividiendo, no mirando la foto ("${m[0].trim()}")`,
  };
}

/**
 * Regla A -- inversión entre colores: el texto llama grande a un color cuyo diámetro máximo
 * comprado está POR DEBAJO del máximo de otro color al que llama chico. Contradicción dura
 * contra el pedido, sin necesidad de ver la foto.
 *
 * Regla B -- variación sin respaldo: el texto afirma varios tamaños (o usa grande y chico a la
 * vez) cuando el pedido confirma UN SOLO diámetro redondo. Es la clase de error de la orden
 * #13599, donde la diferencia "de tamaño" descrita era en realidad distancia a la cámara.
 */
export function analizarComparacion(
  texto: string,
  lineas: LineaDesglose[],
  opciones: { desgloseEnumeraTodo: boolean },
): HallazgoComparacion[] {
  // Las DOS reglas comparten una premisa: que el desglose enumera todos los tamaños presentes en
  // la foto. Eso vale para una orden real de Shopify (es lo que el cliente compró y montó), pero
  // NO para las entradas scrapeadas del blog, cuyo desglose es el carrusel "Adquiere los
  // productos de este blog" -- una lista inferida y habitualmente incompleta. Correr las reglas
  // ahí produce falsos positivos garantizados: se comprobó mirando las fotos de #950000058 y
  // #950000136, donde la variación de tamaño descrita es real y visible, y lo que falla es el
  // desglose. Sin la premisa no hay inferencia posible, así que no se opina.
  const hallazgos: HallazgoComparacion[] = [];

  // Esta corre siempre: no depende del desglose, es una propiedad del texto.
  const ratio = detectarRatioCalculado(texto);
  if (ratio) hallazgos.push(ratio);

  if (!opciones.desgloseEnumeraTodo) return hallazgos;
  const porColor = diametrosRedondosPorColor(lineas);
  const declarados = tamanoDeclaradoPorColor(texto);

  // Un color descrito como grande Y chico a la vez es una mezcla legítima: no concluir nada.
  const grandes = [...declarados].filter(([, c]) => c.has("grande") && !c.has("chico")).map(([id]) => id);
  const chicos = [...declarados].filter(([, c]) => c.has("chico") && !c.has("grande")).map(([id]) => id);

  for (const g of grandes) {
    const dg = porColor.get(g);
    if (!dg) continue;
    for (const c of chicos) {
      const dc = porColor.get(c);
      if (!dc || g === c) continue;
      if (dg.max < dc.max) {
        hallazgos.push({
          regla: "inversion_color",
          detalle: `el texto llama GRANDE a "${g}" (máx R-${dg.max} en el pedido) y CHICO a "${c}" (máx R-${dc.max}) -- está invertido respecto del pedido`,
        });
      }
    }
  }

  const diametros = diametrosRedondos(lineas);
  if (diametros.length === 1) {
    // Solo la frase EXPLÍCITA de variación, y solo si está pegada a una referencia de globo
    // redondo/látex. Es deliberadamente estrecho: una versión anterior también disparaba cuando
    // el texto usaba "large" y "small" a la vez, y eso daba falsos positivos legítimos -- en la
    // orden #8248 el caption contrasta el látex R-12 contra un número foil gigante y un globo
    // dinosaurio, ninguno de los dos comprado. Contrastar contra algo que no es globo redondo
    // del pedido es correcto, no un error, así que esa heurística se quitó.
    const m = texto.match(VARIACION);
    if (m && m.index !== undefined) {
      const contexto = texto.slice(Math.max(0, m.index - 70), m.index + m[0].length + 70);
      if (/\b(?:round|latex)\b/i.test(contexto)) {
        hallazgos.push({
          regla: "variacion_sin_respaldo",
          detalle: `describe variación de tamaño ("${m[0]}") pero el pedido confirma UN SOLO diámetro redondo (R-${diametros[0]}) -- puede ser perspectiva leída como tamaño`,
        });
      }
    }
  }

  return hallazgos;
}
