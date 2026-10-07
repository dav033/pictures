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

/** Partes de una línea de catálogo: si es un globo, su color y sus pulgadas; si no, el producto sin ruido. */
export function partesLinea(linea: LineaNombrable): { esGlobo: boolean; color: string; pulgadas: string | null; producto: string } {
  const original = (linea.nombre ?? "").trim();
  const sinPaquete = original
    .replace(/^\s*b2b\s+/i, "")
    .replace(/\s*[—–]\s.*$/, "")
    .replace(/\s*\/?\s*paquete\b.*$/i, "")
    .trim();
  const pulgadas = pulgadasDe(original) ?? pulgadasDe(linea.tamano);
  const esGlobo = !original || /\bglobos?\b/i.test(original) || /\bR-?\d{1,2}\b/i.test(original);
  if (!esGlobo) return { esGlobo, color: "", pulgadas, producto: sinPaquete || original };
  const resto = sinPaquete
    .replace(/\bx\s*\d+\b.*$/i, "")
    .replace(/\bR-?\d{1,2}\b/gi, " ")
    .replace(/\d{1,2}(?:[.,]\d)?\s*(?:"|”|''|pulgadas?|pulg\.?)/gi, " ")
    .replace(/\b(?:globos?|l[aá]tex|latex|redondos?|fashion|unidades?|und)\b/gi, " ")
    .replace(/[,;].*$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^de\s+/i, "")
    // Idempotente: un nombre ya limpio («Globo blanco de 12"») deja «blanco de» al quitarle el tamaño.
    .replace(/\s+de$/i, "")
    .trim();
  return { esGlobo, color: colorCliente(resto || linea.color), pulgadas, producto: "" };
}

/**
 * «B2b Globo Latex Redondo Fashion Blanco — R-12 / PAQUETE X 12» → «Globo blanco de 12"». Quita la marca B2b,
 * «Latex», «Redondo», «Fashion» y el paquete, y dice el tamaño en pulgadas. Un producto que no es globo queda con
 * su nombre, sin el paquete.
 */
export function nombreLineaCliente(linea: LineaNombrable): string {
  const partes = partesLinea(linea);
  if (!partes.esGlobo) return partes.producto || "Material";
  return `Globo${partes.color ? ` ${partes.color}` : ""}${partes.pulgadas ? ` de ${partes.pulgadas}"` : ""}`;
}

/** Igual que nombreLineaCliente, en plural: «Globos blancos de 12"». */
export function nombreGlobosCliente(linea: LineaNombrable): string {
  const partes = partesLinea(linea);
  if (!partes.esGlobo) return partes.producto || "Material";
  return `Globos${partes.color ? ` ${colorEnPlural(partes.color)}` : ""}${partes.pulgadas ? ` de ${partes.pulgadas}"` : ""}`;
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
