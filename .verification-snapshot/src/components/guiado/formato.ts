import { referenciaDelTitulo } from "@/lib/plan/referencia-sempertex";
import { tonoDelTitulo } from "@/lib/plan/tonos-color";
import { TONOS_V2 } from "@/lib/rag/taxonomy/v2";

/**
 * Cómo se dicen al cliente los globos, los colores y las medidas en la vista guiada. Solo presentación: las
 * cantidades llegan resueltas por Python y aquí nunca se calcula consumo ni precio.
 */

const NUMERO = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 });

export function conMayuscula(texto: string): string {
  return texto.charAt(0).toLocaleUpperCase("es") + texto.slice(1);
}

/** Colores que el catálogo nombra en inglés o con nombre comercial, dichos como los diría el cliente. */
const COLOR_CLIENTE: Readonly<Record<string, string>> = {
  rosewood: "palo de rosa",
  "rose gold": "dorado rosa",
  gold: "dorado",
  silver: "plateado",
  cafe: "café",
};

/** Colores que son sustantivos y no cambian en plural: «globos naranja», «globos lila». */
const INVARIABLES = new Set([
  "beige", "nude", "champagne", "champaña", "café", "cafe", "durazno", "vino", "oro", "plata", "perla", "coral",
  "marfil", "crema", "menta", "lila", "lavanda", "rosa", "fucsia", "naranja", "turquesa", "violeta", "mostaza",
  "salmón", "salmon", "burdeos", "gris",
]);

/** «negro» → «negros», «azul» → «azules», «naranja» → «naranja», «dorado rosa» → «dorado rosa». */
export function colorEnPlural(color: string): string {
  const limpio = color.trim();
  if (!limpio) return limpio;
  const minuscula = limpio.toLocaleLowerCase("es");
  if (/\s/.test(minuscula) || INVARIABLES.has(minuscula)) return limpio;
  if (minuscula.endsWith("a")) return limpio;
  if (/[eoéó]$/.test(minuscula)) return `${limpio}s`;
  if (/[s]$/.test(minuscula)) return limpio;
  if (/[lrnd]$/.test(minuscula)) return `${limpio}es`;
  return limpio;
}

/** Pulgadas de un texto de tamaño: «R-12», «12"», «12 pulgadas», «12». */
export function pulgadasDe(texto: string | undefined): string | null {
  if (!texto) return null;
  const codigo = /\bR-?(\d{1,2})\b/i.exec(texto)?.[1];
  if (codigo) return codigo;
  const conUnidad = /(\d{1,2}(?:[.,]\d)?)\s*(?:"|”|''|pulg)/i.exec(texto)?.[1];
  if (conUnidad) return conUnidad.replace(".", ",");
  const solo = /^\s*(\d{1,2})\s*$/.exec(texto)?.[1];
  return solo ?? null;
}

/** «64 globos negros de 12"»; con una unidad, «1 globo negro de 12"». */
export function textoGlobos(cantidad: number, color: string, tamano: string): string {
  const pulgadas = pulgadasDe(tamano);
  const nombreColor = colorCliente(color);
  const uno = cantidad === 1;
  return `${NUMERO.format(cantidad)} ${uno ? "globo" : "globos"}${nombreColor ? ` ${uno ? nombreColor : colorEnPlural(nombreColor)}` : ""}${pulgadas ? ` de ${pulgadas}"` : ""}`;
}

/** Nombre de color tal como lo dice el cliente, en minúscula: «Rosewood» → «palo de rosa». */
export function colorCliente(color: string | undefined | null): string {
  const limpio = (color ?? "").trim().toLocaleLowerCase("es");
  return COLOR_CLIENTE[limpio] ?? limpio;
}

type LineaNombrable = { nombre?: string; tamano?: string; color?: string };

/**
 * Color en palabras de cliente que la biblioteca real anota al final de cada material, tras el código de tamaño
 * (R-12 redondo, T260 para modelar, LOL6 eslabón, C-12 corazón, 18 IN metalizado):
 * «B2b Globo Latex Redondo Fashion Palo De Rosa — R-12 / PAQUETE X 50 · R-12 · rosado» → «rosado».
 */
const ETIQUETA_COLOR = /·\s*(?:R-?\d{1,2}|T\d{3}|LOL\s?\d{1,2}|C-?\d{1,2}|\d{1,2}\s*IN)\s*·\s*([^·]+?)\s*$/i;

/**
 * El color que dice el PRODUCTO de una nota, con el nombre de la lámina Sempertex (la misma fuente que `color-sempertex`
 * usa para la tarjeta, la tabla y los chips): «Fashion Azul Caribe» → «azul caribe», «Fashion Azul Celeste» y «Pastel
 * Mate Azul» → «celeste». Null si no nombra un tono de la lámina o si es un impreso (su etiqueta dice lo impreso).
 *
 * Por qué (probador, 2026-10-07): la etiqueta de la nota es lo que vio el análisis de la foto, no el globo que se compra.
 * El «Fashion Azul Caribe» de la columna arcoíris tiene la etiqueta «azul celeste» y la cotización decía «celeste»
 * mientras la tarjeta y la tabla decían «Azul caribe».
 */
function colorDelProducto(producto: string, etiqueta: string): string | null {
  if (/«|\bcon\b/i.test(etiqueta) || /\b(?:infinity|impres\w*|estampad\w*)\b/i.test(producto)) return null;
  const tono = tonoDelTitulo(producto);
  if (tono) return TONOS_V2[tono].nombre.toLocaleLowerCase("es");
  return referenciaDelTitulo(producto, null)?.nombre.toLocaleLowerCase("es") ?? null;
}

/** La etiqueta de color de la biblioteca, en minúscula salvo lo impreso entre comillas: «vino con «Feliz día Mamá»». */
function etiquetaCliente(etiqueta: string): string {
  const limpia = etiqueta.trim();
  return COLOR_CLIENTE[limpia.toLocaleLowerCase("es")]
    ?? limpia.split(/(«[^»]*»)/).map((parte) => parte.startsWith("«") ? parte : parte.toLocaleLowerCase("es")).join("");
}

/** Globos que no son redondos y el cliente nombra por su forma: «para modelar», «de eslabón», «de corazón», «metalizado». */
export type FormaGlobo = "modelar" | "eslabon" | "corazon" | "metalizado";

function formaGlobo(original: string, producto: string): FormaGlobo | null {
  if (/\btubito\b/i.test(producto)) return "modelar";
  if (/link-o-loon/i.test(producto)) return "eslabon";
  if (/\bcoraz[oó]n\b/i.test(producto) || /\bCORAZ[OÓ]N\s+\d/i.test(original)) return "corazon";
  if (/\bmetalizado\b/i.test(producto)) return "metalizado";
  return null;
}

/** Pulgadas que el código del catálogo dice para los globos no redondos: «LOL 6», «CORAZON 12», «18 IN». El 260 de un globo para modelar no son pulgadas. */
function pulgadasDeForma(original: string, forma: FormaGlobo | null): string | null {
  if (forma === "eslabon") return /\bLOL\s?(\d{1,2})\b/i.exec(original)?.[1] ?? null;
  if (forma === "corazon") return /\bCORAZ[OÓ]N\s+(\d{1,2})\b/i.exec(original)?.[1] ?? /\bC-(\d{1,2})\b/.exec(original)?.[1] ?? null;
  if (forma === "metalizado") return /\b(\d{1,2})\s*IN\b/.exec(original)?.[1] ?? null;
  return null;
}

/** Partes de una línea de catálogo: si es un globo, su color, sus pulgadas y su forma; si no, el producto sin ruido. */
export function partesLinea(linea: LineaNombrable): { esGlobo: boolean; color: string; pulgadas: string | null; producto: string; forma: FormaGlobo | null } {
  const original = (linea.nombre ?? "").trim();
  const sinPaquete = original
    .replace(/^\s*b2b\s+/i, "")
    .replace(/\s*[—–]\s.*$/, "")
    .replace(/\s*\/?\s*paquete\b.*$/i, "")
    .trim();
  const forma = formaGlobo(original, sinPaquete);
  const pulgadas = forma === "modelar" ? null : pulgadasDeForma(original, forma) ?? pulgadasDe(original) ?? pulgadasDe(linea.tamano);
  const esGlobo = !original || /\bglobos?\b/i.test(original) || /\bR-?\d{1,2}\b/i.test(original);
  if (!esGlobo) return { esGlobo, color: "", pulgadas, producto: sinPaquete || original, forma: null };
  // La etiqueta de la biblioteca es lo que vio la foto; manda el producto que se compra (`colorDelProducto`) y la
  // etiqueta queda para lo que la lámina no nombra (impresos, «transparente con confeti»).
  const etiqueta = ETIQUETA_COLOR.exec(original)?.[1];
  if (etiqueta) return { esGlobo, color: colorDelProducto(sinPaquete, etiqueta) ?? etiquetaCliente(etiqueta), pulgadas, producto: "", forma };
  const resto = sinPaquete
    .replace(/\bx\s*\d+\b.*$/i, "")
    .replace(/\bR-?\d{1,2}\b/gi, " ")
    .replace(/\d{1,2}(?:[.,]\d)?\s*(?:"|”|''|pulgadas?|pulg\.?)/gi, " ")
    .replace(/\b(?:globos?|l[aá]tex|latex|redondos?|fashion|unidades?|und|tubitos?|metalizados?|coraz[oó]n)\b/gi, " ")
    .replace(/link-o-loon®?/gi, " ")
    .replace(/[,;].*$/, "")
    .replace(/\s+/g, " ")
    .trim()
    // «Globo de látex 12"» sin color deja solo «de»: antes salía «Globo de de 12"».
    .replace(/^de(?:\s+|$)/i, "")
    // Idempotente: un nombre ya limpio («Globo blanco de 12"») deja «blanco de» al quitarle el tamaño.
    .replace(/\s+de$/i, "")
    .trim();
  return { esGlobo, color: colorCliente(resto || linea.color), pulgadas, producto: "", forma };
}

/** «para modelar» va después del color («Globos naranja para modelar»); las demás formas, antes («Globos de corazón rojo»). */
function conForma(base: string, color: string, forma: FormaGlobo | null, plural: boolean): string {
  const delante = forma === "eslabon" ? " de eslabón" : forma === "corazon" ? " de corazón" : forma === "metalizado" ? (plural ? " metalizados" : " metalizado") : "";
  return `${base}${delante}${color ? ` ${color}` : ""}${forma === "modelar" ? " para modelar" : ""}`;
}

/**
 * «B2b Globo Latex Redondo Fashion Blanco — R-12 / PAQUETE X 12» → «Globo blanco de 12"». Quita la marca B2b,
 * «Latex», «Redondo», «Fashion» y el paquete, y dice el tamaño en pulgadas. Un producto que no es globo queda con
 * su nombre, sin el paquete.
 */
export function nombreLineaCliente(linea: LineaNombrable): string {
  const partes = partesLinea(linea);
  if (!partes.esGlobo) return partes.producto || "Material";
  return `${conForma("Globo", partes.color, partes.forma, false)}${partes.pulgadas ? ` de ${partes.pulgadas}"` : ""}`;
}

/** Igual que nombreLineaCliente, en plural: «Globos blancos de 12"», «Globos naranja para modelar». */
export function nombreGlobosCliente(linea: LineaNombrable): string {
  const partes = partesLinea(linea);
  if (!partes.esGlobo) return partes.producto || "Material";
  return `${conForma("Globos", partes.color ? colorEnPlural(partes.color) : "", partes.forma, true)}${partes.pulgadas ? ` de ${partes.pulgadas}"` : ""}`;
}

/** Acabado de un globo del catálogo dicho al cliente («Reflex» → «cromado»); «Fashion» es el liso de siempre. */
export function acabadoCliente(texto: string | undefined): string | null {
  const limpio = texto ?? "";
  if (/\breflex\b/i.test(limpio)) return "cromado";
  if (/\bsat[ií]n\b/i.test(limpio)) return "satinado";
  if (/\bmetal\b/i.test(limpio)) return "metalizado";
  if (/\bfashion\b/i.test(limpio)) return "liso";
  return null;
}

/** «Globo dorado de 12"» con «cromado» → «Globo dorado cromado de 12"». */
export function conAcabado(nombre: string, acabado: string): string {
  const tamano = / de \d{1,2}(?:,\d)?"$/.exec(nombre);
  return tamano ? `${nombre.slice(0, tamano.index)} ${acabado}${tamano[0]}` : `${nombre} ${acabado}`;
}

/** «2,4 m de ancho por 2 m de alto», «3 m de largo» o null si el plan no trae medidas. */
export function medidasEnPalabras(medidas: { ancho_m?: number; alto_m?: number; largo_m?: number } | undefined): string | null {
  if (!medidas) return null;
  const partes = [
    medidas.ancho_m ? `${NUMERO.format(medidas.ancho_m)} m de ancho` : null,
    medidas.alto_m ? `${NUMERO.format(medidas.alto_m)} m de alto` : null,
    medidas.largo_m ? `${NUMERO.format(medidas.largo_m)} m de largo` : null,
  ].filter((parte): parte is string => parte !== null);
  return partes.length ? partes.join(" por ") : null;
}

/** Iniciales para un avatar: «Globos Fiesta Medellín» → «GF». */
export function iniciales(nombre: string): string {
  const palabras = nombre.replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter((palabra) => palabra.length > 2 || /^\p{Lu}/u.test(palabra));
  return (palabras.slice(0, 2).map((palabra) => palabra.charAt(0).toLocaleUpperCase("es")).join("") || nombre.charAt(0).toLocaleUpperCase("es") || "?");
}

/** Compara textos sin mayúsculas ni tildes. */
export function claveTexto(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("es").replace(/\s+/g, " ").trim();
}

/**
 * La descripción de un ajuste («con Silk Dorado», «sin la columna derecha») dicha como frase completa para «Último
 * ajuste: …» y «Listo: …»: «añadí Silk Dorado», «quité la columna derecha» (probador 124, hallazgo 10). Las demás
 * («más rosado en el semiarco», «Reflex Plata en lugar de dorado») ya se leen bien y quedan igual. Solo presentación: lo
 * guardado en el plan (y lo que lee el chat) no cambia.
 */
export function fraseAjuste(descripcion: string): string {
  const limpia = descripcion.trim();
  if (/^con\s/i.test(limpia)) return `añadí ${limpia.slice(4).trimStart()}`;
  if (/^sin\s/i.test(limpia)) return `quité ${limpia.slice(4).trimStart()}`;
  return limpia;
}
