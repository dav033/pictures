import { ANCHOS_FUENTE_EM } from "./rotulos-fuente-anchos";

/**
 * **El texto de un rótulo**: cómo se limpia lo que llega de afuera (una persona, la IA de escena, la lectura de una foto) antes de
 * dibujarlo o de mandárselo a otro modelo, y cuánto ocupa con la letra de los rótulos (Great Vibes) sin necesitar un lienzo.
 *
 * Solo entra lo que la letra sabe dibujar: letras y números del latín (hasta Latin-1: «ñ», «é», «ü»), espacio y `.,'&!?-`. Todo lo
 * demás se descarta: los caracteres de control y de formato (el de U+202E invierte las letras; los de ancho cero no se ven), las
 * comillas y los paréntesis (el texto va entre comillas en lo que se le dice a otros modelos y no puede cerrarlas) y las letras
 * de otras escrituras (la letra no las tiene y caerían en una del sistema).
 */

export const MAX_TEXTO_ROTULO = 24;
export const MAX_LINEAS_ROTULO = 3;

const SEGMENTADOR = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter("es", { granularity: "grapheme" }) : null;
/** Los grafemas de un texto (lo que una persona cuenta como una letra; nunca parte un par suplente). */
const grafemas = (t: string): string[] => (SEGMENTADOR ? [...SEGMENTADOR.segment(t)].map((s) => s.segment) : [...t]);

const PUNTUACION = " .,'&!?-";
const esLetraONumero = (c: string) => /^[\p{L}\p{N}]$/u.test(c) && c.codePointAt(0)! <= 0xff;

/** El texto sin lo que la letra no dibuja, en NFC y con las comillas y rayas tipográficas como las simples. */
function soloLoDibujable(texto: string): string {
  const normal = texto.normalize("NFC").replace(/\r\n?/g, "\n").replace(/\t/g, " ").replace(/[‘’´`]/g, "'").replace(/[‐-―]/g, "-");
  return grafemas(normal.replace(/[\p{Cc}\p{Cf}]/gu, (c) => (c === "\n" ? c : ""))).filter((g) => g === "\n" || (g.length === 1 && (esLetraONumero(g) || PUNTUACION.includes(g)))).join("");
}

/**
 * El texto como se dibuja: sin lo que la letra no dibuja, con las líneas sin espacios de sobra (máximo `maxLineas`, 3 por
 * defecto; con 1 los saltos son espacios) y 24 letras en total (contando cada salto); vacío si no queda nada.
 */
export function limpiarTexto(texto: string, maxLineas = MAX_LINEAS_ROTULO): string {
  const limpio = soloLoDibujable(texto);
  const lineas = maxLineas <= 1 ? [limpio.replace(/\s+/g, " ").trim()] : limpio.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, maxLineas);
  return grafemas(lineas.join("\n")).slice(0, MAX_TEXTO_ROTULO).join("").trim();
}

export const lineasDeRotulo = (texto: string): string[] => texto.split("\n").filter(Boolean);

/** El texto en una sola línea (para decirlo: la lista de compra, la IA, el inventario en inglés). */
export const textoEnUnaLinea = (texto: string): string => texto.replace(/\s*\n\s*/g, " ");

// ----------------------------------------------------------------------------------------------------------
// Cuánto ocupa
// ----------------------------------------------------------------------------------------------------------

/**
 * Cuánto sobresale la tinta de lo que avanza la letra (por los rabos de las letras) y lo que mide de alto la tinta (en em): una
 * línea sin rabos hacia abajo (g, j, p, q, y, coma) mide ~0,95 y con ellos ~1,16, y cada línea de más suma 1,3. Medido con la letra
 * real dibujada como la dibuja el visor (`generar-anchos-fuente-rotulos.ts --medir`): la estimación queda a ±12 % de la tinta real.
 */
const SOBRESALE_TINTA = 1.04, ALTO_SIN_RABOS_EM = 0.95, ALTO_CON_RABOS_EM = 1.16, ALTO_LINEA_DE_MAS_EM = 1.3, ANCHO_DESCONOCIDO_EM = 0.4;

/** Lo que mide de alto la tinta de un texto de esas líneas, en em de la letra. */
export function altoEnEm(texto: string): number {
  const lineas = lineasDeRotulo(texto);
  const ultima = lineas.at(-1) ?? "";
  return ALTO_LINEA_DE_MAS_EM * Math.max(0, lineas.length - 1) + (/[gjpqy,ç]/i.test(ultima) ? ALTO_CON_RABOS_EM : ALTO_SIN_RABOS_EM);
}

/** La proporción (ancho/alto) de la tinta de un texto, con la letra de los rótulos; cerca del 5 % de la que sale al dibujarlo. */
export function aspectoEstimado(texto: string): number {
  const lineas = lineasDeRotulo(texto);
  if (!lineas.length) return 1;
  const ancho = Math.max(...lineas.map((l) => grafemas(l).reduce((s, c) => s + (ANCHOS_FUENTE_EM[c] ?? ANCHO_DESCONOCIDO_EM), 0))) * SOBRESALE_TINTA;
  return ancho / altoEnEm(texto);
}

/** Todas las formas de partir un texto de una línea en hasta 3 (cortando en los espacios): la propia línea, con un corte y con dos. */
export function partirEnLineas(texto: string): string[] {
  const palabras = texto.split(" ").filter(Boolean);
  const salida = [palabras.join(" ")];
  for (let i = 1; i < palabras.length; i++) {
    salida.push(`${palabras.slice(0, i).join(" ")}\n${palabras.slice(i).join(" ")}`);
    for (let j = i + 1; j < palabras.length; j++) salida.push(`${palabras.slice(0, i).join(" ")}\n${palabras.slice(i, j).join(" ")}\n${palabras.slice(j).join(" ")}`);
  }
  return salida;
}
