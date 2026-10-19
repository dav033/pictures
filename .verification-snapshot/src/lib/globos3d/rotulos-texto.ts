import { ANCHOS_FUENTE_EM } from "./rotulos-fuente-anchos";

/**
 * **El texto de un rótulo**: cómo se limpia lo que llega de afuera (una persona, la IA de escena, la lectura de una foto) antes de
 * dibujarlo o de mandárselo a otro modelo, y cuánto ocupa con la letra de los rótulos (Great Vibes) sin necesitar un lienzo.
 *
 * Solo entra lo que la letra sabe dibujar: letras y números del latín (hasta Latin-1: «ñ», «é», «ü»), espacio y `.,'&!?-¡¿`. Antes
 * se normaliza (NFKC: «ﬁ» pasa a «fi», «…» a «...», cualquier espacio Unicode a un espacio) y lo que separa palabras sin ser una letra
 * (`/ _ | ( ) :`…) pasa a espacio («Isa/Leo» es «Isa Leo»). Una letra latina que la letra no trae pasa a su base («Ł» a «L», «ő» a «o»).
 * Lo demás se descarta: los caracteres de control y de formato (el de U+202E invierte las letras; los de ancho cero no se ven), las
 * comillas (el texto va entre comillas en lo que se le dice a otros modelos y no puede cerrarlas), los emojis y las letras de otras
 * escrituras (la letra no las tiene y caerían en una del sistema). `analizarTexto` dice qué se descartó y qué se cambió, para avisarlo.
 */

export const MAX_TEXTO_ROTULO = 24;
export const MAX_LINEAS_ROTULO = 3;

const SEGMENTADOR = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter("es", { granularity: "grapheme" }) : null;
/** Los grafemas de un texto (lo que una persona cuenta como una letra; nunca parte un par suplente). */
const grafemas = (t: string): string[] => (SEGMENTADOR ? [...SEGMENTADOR.segment(t)].map((s) => s.segment) : [...t]);

const PUNTUACION = " .,'&!?-\u00a1\u00bf";
const SEPARADORES = /[/\\|_:;()[\]{}<>+*=~^#@%$]/g;
/** Letras latinas que la letra no trae y no se descomponen en una base más una marca. */
const BASE_LATINA: Readonly<Record<string, string>> = { "\u0141": "L", "\u0142": "l", "\u0110": "D", "\u0111": "d", "\u0126": "H", "\u0127": "h", "\u0131": "i", "\u0166": "T", "\u0167": "t", "\u0152": "OE", "\u0153": "oe", "\u1e9e": "SS" };
const esLetraONumero = (c: string) => /^[\p{L}\p{N}]$/u.test(c) && c.codePointAt(0)! <= 0xff;
const esDibujable = (g: string) => g.length === 1 && (esLetraONumero(g) || PUNTUACION.includes(g));

/** La letra del texto que la fuente sí trae y se le parece: su base sin marcas («ő» a «o») o la de la tabla; undefined si no hay. */
function sustituto(g: string): string | undefined {
  const base = BASE_LATINA[g] ?? g.normalize("NFD").replace(/\p{M}/gu, "");
  return base !== g && [...base].every(esDibujable) ? base : undefined;
}

export type AnalisisTexto = {
  /** El texto como se dibuja. */
  texto: string;
  /** Lo que se descartó (visible: «🎉», «"»; sin repetir). */
  descartados: string[];
  /** Lo que se cambió por su letra parecida («Ł→L»). */
  sustituidos: string[];
  /** Había caracteres invisibles (control, formato, ancho cero) y se quitaron. */
  invisibles: boolean;
  /** Pasaba de 24 letras y se cortó. */
  cortado: boolean;
  /** Traía más líneas de las que caben (`maxLineas`) y se quitaron las últimas. */
  sobranLineas: boolean;
};

/**
 * El texto como se dibuja y qué se hizo para llegar ahí: líneas sin espacios de sobra (máximo `maxLineas`, 3 por defecto; con 1 los
 * saltos son espacios) y 24 letras en total (contando cada salto); vacío si no queda nada.
 */
export function analizarTexto(texto: string, maxLineas = MAX_LINEAS_ROTULO): AnalisisTexto {
  // Una fracción («½») se vuelve «1⁄2» al normalizar y el trazo cambia por un espacio: «1 2». Se avisa como cambio.
  const sustituidos = new Set<string>([...texto.matchAll(/[\u00bc-\u00be\u2150-\u215f\u2189]/gu)].map(([f]) => `${f}\u2192${f.normalize("NFKC").replace("\u2044", " ")}`));
  const preparado = texto.normalize("NFKC").replace(/\u2044/g, " ").replace(/\r\n?/g, "\n").replace(/[\p{Zs}\t]/gu, " ").replace(/[\u2018\u2019\u00b4`]/g, "'").replace(/[\u2010-\u2015\u2212]/g, "-").replace(SEPARADORES, " ");
  const descartados = new Set<string>();
  let invisibles = false;
  const conservado = grafemas(preparado).map((g) => {
    if (g === "\n" || esDibujable(g)) return g;
    if (/^[\p{Cc}\p{Cf}]+$/u.test(g)) { invisibles = true; return ""; }
    const otra = sustituto(g);
    if (otra) { sustituidos.add(`${g}\u2192${otra}`); return otra; }
    descartados.add(g);
    return "";
  }).join("");
  const todas = maxLineas <= 1 ? [conservado.replace(/\s+/g, " ").trim()] : conservado.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const lineas = todas.slice(0, Math.max(1, maxLineas));
  const todo = grafemas(lineas.join("\n"));
  return { texto: todo.slice(0, MAX_TEXTO_ROTULO).join("").trim(), descartados: [...descartados], sustituidos: [...sustituidos], invisibles, cortado: todo.length > MAX_TEXTO_ROTULO, sobranLineas: todas.length > lineas.length };
}

/** El texto como se dibuja (ver `analizarTexto`). */
export const limpiarTexto = (texto: string, maxLineas = MAX_LINEAS_ROTULO): string => analizarTexto(texto, maxLineas).texto;

/**
 * Lo que hay que decirle a quien escribió el texto si no se dibuja tal cual (qué se quitó, qué se cambió, si se cortó), o null si
 * quedó igual. El texto original va entre comillas como dato (JSON): nunca como parte de la frase.
 */
export function avisoDeTexto(original: string, maxLineas = MAX_LINEAS_ROTULO): string | null {
  /** Entre comillas y con los caracteres de control y de formato escritos como \uXXXX: ni el aviso se puede dar vuelta ni esconder nada. */
  const citar = (t: string) => JSON.stringify(t).replace(/[\p{Cc}\p{Cf}]/gu, (c) => `\\u${c.codePointAt(0)!.toString(16).padStart(4, "0")}`);
  const a = analizarTexto(original, maxLineas);
  const partes = [
    ...(a.descartados.length ? [`quité lo que la letra no dibuja (${a.descartados.map(citar).join(", ")})`] : []),
    ...(a.invisibles ? ["quité caracteres invisibles"] : []),
    ...(a.sustituidos.length ? [`cambié ${a.sustituidos.join(", ")} (la letra no trae esa)`] : []),
    ...(a.sobranLineas ? [`pasa de ${maxLineas} líneas`] : []),
    ...(a.cortado ? [`pasa de ${MAX_TEXTO_ROTULO} letras`] : []),
  ];
  return partes.length ? `El texto ${citar(original.slice(0, 60))}: ${partes.join("; ")}; quedó ${citar(a.texto)}.` : null;
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
