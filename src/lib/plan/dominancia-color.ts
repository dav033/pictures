import { labDeRgb, LAB_COLORES, type Lab } from "@/lib/rag/catalog/similitud-color";

/**
 * Cuánto ocupa cada color del catálogo en una región de una foto, medido sobre
 * los píxeles.
 *
 * POR QUÉ. Hasta ahora la paleta de una foto era `slice(0, 3)` de una lista sin
 * orden: las tres primeras etiquetas que el analizador hubiera escrito, en el
 * orden en que las escribió. Eso no es dominancia, es orden de redacción, y
 * explica que la misma foto diera cuatro paletas distintas en cinco corridas.
 * El analizador sigue proponiendo NOMBRES —es lo que sabe hacer—, pero el
 * ORDEN y la PARTICIPACIÓN salen de aquí.
 *
 * QUÉ SE MIDE Y QUÉ NO. Se mide dentro de la caja del elemento, no sobre la foto
 * entera: un arco de globos en un jardín es un 5 % de los píxeles y el 95 %
 * restante es césped y cielo, así que medir la foto completa reportaría «verde»
 * como color dominante de toda decoración al aire libre. La caja es la unidad
 * correcta porque es la que `colores_referencia` ya usa por estructura.
 *
 * Puro: sin proveedor, HTTP, base de datos ni entorno. Quien decodifica los
 * píxeles es `medir-dominancia.ts`, que sí toca disco.
 */

/** Píxeles RGB de 8 bits, 3 bytes por píxel, en orden de filas. */
export type MuestraPixeles = { ancho: number; alto: number; rgb: Uint8Array };

/** Caja relativa al ancho/alto de la imagen, igual que `reference_bbox`. */
export type CajaRelativa = { x: number; y: number; width: number; height: number };

export type ParticipacionColor = { color: string; participacion: number };

export type MedicionDominancia = {
  /** Colores con participación suficiente, de mayor a menor. */
  dominantes: ParticipacionColor[];
  /**
   * Fracción de la región que no se parece a ningún color del catálogo. Alta
   * significa que la medida dice poco: madera, piel, follaje o sombra profunda
   * ocupan la caja.
   */
  sinClasificar: number;
  /** Píxeles efectivamente muestreados. 0 si la caja cae fuera de la imagen. */
  pixelesMedidos: number;
};

/**
 * ΔE máximo para dar un píxel por un color del catálogo. No es el mismo umbral
 * que `DELTA_E_MAXIMO` (45) y no debe serlo: aquel decide si un color PEDIDO se
 * puede sustituir por otro que el catálogo sí vende, y ahí conviene ser
 * generoso. Este decide si un píxel ES de ese color, y ahí ser generoso
 * convierte cualquier cosa en catálogo.
 *
 * El número está medido, no elegido: `scripts/eval/calibrar-dominancia.ts` imprime el
 * reparto real de cada radio candidato sobre las cuatro fotos de referencia y
 * sobre una foto de jardín. El corte aparece solo y es nítido. En la foto de
 * jardín, con radio 30 el césped deja el 24 % de la imagen sin clasificar y
 * `verde` se queda en 7 %; con radio 35 el prado entra de golpe y `verde` salta
 * a 24 %. La diferencia entre un globo verde (#2e9d57, saturado) y un prado
 * (verde oliva apagado, ΔE 34-36) cae justo en esa franja.
 *
 * No es un filtro perfecto y no pretende serlo: la hierba a pleno sol sí se
 * parece a un globo verde y ese 7 % es ella. Lo que el radio compra es que el
 * paisaje no gane la medición, no que desaparezca.
 *
 * En las cuatro fotos de referencia, que son de estudio, el radio casi no actúa
 * (1-3 % sin clasificar con 30, 0 % con 35): ahí la paleta cubre el espacio LAB
 * de sobra y la clasificación es en la práctica el vecino más cercano. El radio
 * existe para las fotos de exteriores, que es donde hay algo que excluir.
 */
export const DELTA_E_CLASIFICACION = 30;

/**
 * Participación por debajo de la cual un color es ruido de compresión o un
 * reflejo, no un color de la decoración. Con 2 % un globo suelto en una caja de
 * arco todavía cuenta; con menos entran los bordes JPEG.
 */
export const PARTICIPACION_MINIMA = 0.02;

/**
 * Techo de píxeles a clasificar. Muestrear con paso fijo en vez de redimensionar
 * mantiene la medida exactamente reproducible —ninguna interpolación de por
 * medio— y 20 000 píxeles ya estabilizan la participación en la tercera cifra.
 */
export const MAX_PIXELES_MUESTRA = 20_000;

/**
 * Etiquetas de la paleta que no son un tono y por tanto no se pueden medir en un
 * píxel. `transparente` es un acabado (el catálogo vende la línea Cristal en
 * varios tonos) y `multicolor` es la ausencia de un color único; las tres —con
 * `blanco`— comparten el hex `#ffffff`, así que en la tabla LAB distan 0 entre
 * sí. Dejarlas dentro haría que el color de un píxel blanco lo decidiera el
 * desempate alfabético y no la foto. Solo se excluyen de la CLASIFICACIÓN: en la
 * tabla de sustitución siguen, porque ahí sí son colores que un plan puede pedir.
 */
const NO_MEDIBLES: ReadonlySet<string> = new Set(["transparente", "multicolor"]);

const TABLA: ReadonlyArray<readonly [string, Lab]> = Object.entries(LAB_COLORES).filter(([color]) => !NO_MEDIBLES.has(color));

/** El color del catálogo más cercano a un píxel, o `undefined` si ninguno lo está. */
function clasificarPixel(rojo: number, verde: number, azul: number): string | undefined {
  const lab = labDeRgb(rojo, verde, azul);
  let mejor: string | undefined;
  let mejorDistancia = DELTA_E_CLASIFICACION;
  for (const [color, candidato] of TABLA) {
    const distancia = Math.hypot(lab[0] - candidato[0], lab[1] - candidato[1], lab[2] - candidato[2]);
    // El desempate alfabético solo existe para que la medida sea determinista
    // cuando un píxel cae justo entre dos colores.
    if (distancia < mejorDistancia || (distancia === mejorDistancia && mejor !== undefined && color < mejor)) {
      mejorDistancia = distancia;
      mejor = color;
    }
  }
  return mejor;
}

/** Recorta la caja a los límites de la imagen. `null` cuando no queda región. */
function regionDe(muestra: MuestraPixeles, caja: CajaRelativa | undefined): { x0: number; y0: number; x1: number; y1: number } | null {
  const { ancho, alto } = muestra;
  if (!caja) return ancho > 0 && alto > 0 ? { x0: 0, y0: 0, x1: ancho, y1: alto } : null;
  const x0 = Math.max(0, Math.floor(caja.x * ancho));
  const y0 = Math.max(0, Math.floor(caja.y * alto));
  const x1 = Math.min(ancho, Math.ceil((caja.x + caja.width) * ancho));
  const y1 = Math.min(alto, Math.ceil((caja.y + caja.height) * alto));
  return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null;
}

export function medirDominanciaColor(muestra: MuestraPixeles, caja?: CajaRelativa): MedicionDominancia {
  const region = regionDe(muestra, caja);
  if (!region) return { dominantes: [], sinClasificar: 0, pixelesMedidos: 0 };

  const anchoRegion = region.x1 - region.x0;
  const altoRegion = region.y1 - region.y0;
  const paso = Math.max(1, Math.ceil(Math.sqrt((anchoRegion * altoRegion) / MAX_PIXELES_MUESTRA)));

  const conteo = new Map<string, number>();
  let medidos = 0;
  let clasificados = 0;
  for (let y = region.y0; y < region.y1; y += paso) {
    for (let x = region.x0; x < region.x1; x += paso) {
      const base = (y * muestra.ancho + x) * 3;
      const color = clasificarPixel(muestra.rgb[base] ?? 0, muestra.rgb[base + 1] ?? 0, muestra.rgb[base + 2] ?? 0);
      medidos += 1;
      if (!color) continue;
      clasificados += 1;
      conteo.set(color, (conteo.get(color) ?? 0) + 1);
    }
  }
  if (medidos === 0) return { dominantes: [], sinClasificar: 0, pixelesMedidos: 0 };

  // El denominador son los píxeles medidos, no los clasificados: si media caja
  // es madera, la participación tiene que reflejarlo en vez de repartir el 100 %
  // entre los pocos píxeles que sí eran del catálogo.
  const dominantes = [...conteo.entries()]
    .map(([color, veces]) => ({ color, participacion: veces / medidos }))
    .filter((entrada) => entrada.participacion >= PARTICIPACION_MINIMA)
    .sort((uno, otro) => otro.participacion - uno.participacion || (uno.color < otro.color ? -1 : 1));

  return { dominantes, sinClasificar: (medidos - clasificados) / medidos, pixelesMedidos: medidos };
}

/**
 * Los colores medidos de una región, en orden de dominancia y recortados a
 * `maximo`. Es el reemplazo directo del `slice(0, 3)` sobre una lista sin orden:
 * misma forma de salida, pero el orden ahora significa algo.
 */
export function coloresPorDominancia(medicion: MedicionDominancia, maximo: number): string[] {
  return medicion.dominantes.slice(0, maximo).map((entrada) => entrada.color);
}

/**
 * Participación mínima ya renormalizada para que un color entre en la medida de
 * un elemento. Más laxa que `PARTICIPACION_MINIMA` porque el filtro de
 * enriquecimiento ya quitó el fondo: lo que queda es decoración, y un acento
 * pequeño de verdad cuenta.
 */
const PARTICIPACION_MINIMA_ELEMENTO = 0.03;

/**
 * Cuántas veces más concentrado tiene que estar un color DENTRO de la caja que
 * fuera para contar como color de la decoración y no del sitio.
 *
 * 1,5 sale del fallo que lo motivó, no de la intuición: en la primera corrida
 * medida, `gris` salió dominante en tres de las cuatro fotos de referencia con
 * 32-48 %, y el QA visual cayó de 2/4 a 1/4. Ese gris es la pared del estudio.
 * La caja de un elemento es un RECTÁNGULO alrededor de un arco, y la mayor
 * parte de ese rectángulo es fondo visible entre y alrededor de los globos, así
 * que restringir a la caja era necesario pero no suficiente.
 *
 * Un fondo está igual de presente dentro que fuera de la caja (razón ≈ 1); un
 * globo rosa está dentro y no fuera (razón alta). Eso lo distingue sin tener que
 * suponer que la decoración es saturada — suponerlo mataría los globos blancos,
 * plateados y negros, que el catálogo sí vende.
 */
export const ENRIQUECIMIENTO_MINIMO = 1.5;

/**
 * Fracción de imagen por encima de la cual la caja no deja "fuera" suficiente
 * para comparar. Con el elemento ocupando casi todo el encuadre no hay fondo
 * contra el que contrastar y el filtro se apaga en vez de inventarse un número.
 */
const COBERTURA_SIN_FUERA = 0.8;

/** Medida de la región complementaria a la caja. */
function medirFuera(muestra: MuestraPixeles, caja: CajaRelativa): Map<string, number> {
  const region = regionDe(muestra, caja);
  const conteo = new Map<string, number>();
  if (!region) return conteo;
  const paso = Math.max(1, Math.ceil(Math.sqrt((muestra.ancho * muestra.alto) / MAX_PIXELES_MUESTRA)));
  let medidos = 0;
  for (let y = 0; y < muestra.alto; y += paso) {
    for (let x = 0; x < muestra.ancho; x += paso) {
      if (x >= region.x0 && x < region.x1 && y >= region.y0 && y < region.y1) continue;
      const base = (y * muestra.ancho + x) * 3;
      const color = clasificarPixel(muestra.rgb[base] ?? 0, muestra.rgb[base + 1] ?? 0, muestra.rgb[base + 2] ?? 0);
      medidos += 1;
      if (color) conteo.set(color, (conteo.get(color) ?? 0) + 1);
    }
  }
  if (medidos === 0) return new Map();
  for (const [color, veces] of conteo) conteo.set(color, veces / medidos);
  return conteo;
}

/**
 * Los colores de LA DECORACIÓN de un elemento: lo que hay dentro de su caja
 * descontando lo que el sitio ya ponía. Es lo que debe alimentar
 * `colores_referencia`; `medirDominanciaColor` a secas mide una región y no
 * sabe qué es fondo.
 *
 * Las participaciones se renormalizan sobre los colores que sobreviven, así que
 * suman ~1 y siguen siendo comparables con `participacion` del plan.
 */
export function medirDominanciaElemento(muestra: MuestraPixeles, caja: CajaRelativa): MedicionDominancia {
  const dentro = medirDominanciaColor(muestra, caja);
  if (dentro.dominantes.length === 0) return dentro;

  const cobertura = Math.min(1, Math.max(0, caja.width)) * Math.min(1, Math.max(0, caja.height));
  if (cobertura >= COBERTURA_SIN_FUERA) return dentro;

  const fuera = medirFuera(muestra, caja);
  if (fuera.size === 0) return dentro;

  const sobreviven = dentro.dominantes.filter((entrada) => {
    const afuera = fuera.get(entrada.color) ?? 0;
    // Un color que no está fuera en absoluto es decoración por definición.
    return afuera <= 0 || entrada.participacion / afuera >= ENRIQUECIMIENTO_MINIMO;
  });
  // Si el filtro se lo lleva todo, la caja es indistinguible del fondo y lo
  // honesto es devolver la medida cruda en vez de un vacío que se leería como
  // "esta pieza no tiene color".
  if (sobreviven.length === 0) return dentro;

  const total = sobreviven.reduce((suma, entrada) => suma + entrada.participacion, 0);
  const dominantes = sobreviven
    .map((entrada) => ({ color: entrada.color, participacion: Number((entrada.participacion / total).toFixed(4)) }))
    .filter((entrada) => entrada.participacion >= PARTICIPACION_MINIMA_ELEMENTO)
    .sort((uno, otro) => otro.participacion - uno.participacion || (uno.color < otro.color ? -1 : 1));

  return { dominantes, sinClasificar: dentro.sinClasificar, pixelesMedidos: dentro.pixelesMedidos };
}
