/**
 * Los pasos de las ideas de la biblioteca dichos al cliente: sin códigos de tamaño («R-12» → «de 12 pulgadas») ni
 * nombres internos de la mezcla de color («Sigue el patrón espiral…»). Solo presentación: no toca materiales,
 * cantidades ni la cotización, que siguen leyendo sus propios datos.
 */

/** Cómo se colocan los colores, según la mezcla que la biblioteca anotó para la foto. */
const MEZCLA_CLIENTE: Readonly<Record<string, string>> = {
  espiral: "Coloca los colores en espiral, como en la foto.",
  aleatorio: "Mezcla los colores sin un orden fijo, como en la foto.",
  bloques: "Agrupa cada color en su propia zona, como en la foto.",
  anillos: "Coloca los colores por anillos, uno sobre otro, como en la foto.",
  organico: "Reparte los colores de forma natural, como en la foto.",
};

function sinTildes(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("es");
}

export function pasoParaCliente(texto: string): string {
  return texto
    .replace(/Sigue el patr[oó]n\s+([\p{L}]+)\s+y alterna los colores seg[uú]n la foto\./giu, (_, modo: string) => MEZCLA_CLIENTE[sinTildes(modo)] ?? "Alterna los colores como en la foto.")
    // «globos R-12» → «globos de 12 pulgadas»; un código suelto («los R-5») → «los de 5 pulgadas».
    .replace(/\b(globos?)\s+(?:de\s+)?R-?(\d{1,2})\b/gi, "$1 de $2 pulgadas")
    .replace(/\bR-(\d{1,2})\b/g, "de $1 pulgadas");
}

export function pasosParaCliente<T extends { texto: string }>(pasos: readonly T[]): T[] {
  return pasos.map((paso) => ({ ...paso, texto: pasoParaCliente(paso.texto) }));
}
