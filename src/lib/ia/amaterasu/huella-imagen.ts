import sharp from "sharp";

/**
 * Huella perceptual de una foto: la imagen decodificada (con la orientación EXIF aplicada) reducida a una miniatura
 * fija de `LADO_HUELLA` × `LADO_HUELLA` píxeles RGB. Dos copias de la MISMA foto dan casi la misma miniatura aunque
 * sus bytes no se parezcan en nada: la clásica manda el archivo de la galería intacto y la guiada lo vuelve a
 * codificar (`prepararFotoReferencia`: lado mayor 1800 px, JPEG 0,9), así que el sha256 de los bytes nunca coincidía
 * entre las dos vistas (comparador clásica-guiada, 2026-10-06).
 *
 * Medido sobre las 10 fotos de la galería (2026-10-07): volver a codificar en JPEG 0,9 o 0,6, pasarla a PNG o
 * reducirla a 900 px la deja a menos de 2,5 de distancia media por canal (0-255); un 5 % más de brillo la pone a
 * 6-10 y recortarle un 10 % a 12-29; dos fotos distintas de la galería quedan a 36 o más. `UMBRAL_HUELLA` está en
 * medio: reconoce la misma foto recodificada o reducida y nunca confunde dos fotos distintas.
 *
 * Solo servidor (sharp).
 */
export const LADO_HUELLA = 16;
/** Distancia media por canal (0-255) por debajo de la cual dos huellas son la misma foto. */
export const UMBRAL_HUELLA = 4;
/** Diferencia relativa de proporción (ancho/alto) que se tolera: un recorte ya no es la misma foto. */
export const TOLERANCIA_PROPORCION = 0.02;

export type HuellaImagen = {
  /** `LADO_HUELLA² × 3` bytes RGB en base64. */
  huella: string;
  /** Ancho entre alto de la foto como se ve (orientación EXIF aplicada). */
  proporcion: number;
};

export async function huellaImagen(imagen: Buffer): Promise<HuellaImagen> {
  const { data, info } = await sharp(imagen)
    .rotate()
    .resize(LADO_HUELLA, LADO_HUELLA, { fit: "fill", kernel: "cubic" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== LADO_HUELLA || info.height !== LADO_HUELLA || info.channels !== 3) throw new Error("Huella con un tamaño inesperado.");
  const { width, height, orientation } = await sharp(imagen).metadata();
  if (!width || !height) throw new Error("Imagen sin dimensiones.");
  const proporcion = orientation !== undefined && orientation >= 5 ? height / width : width / height;
  return { huella: Buffer.from(data).toString("base64"), proporcion };
}

/** Distancia media por canal (0-255) entre dos huellas; Infinity si no son comparables. */
export function distanciaHuellas(una: string, otra: string): number {
  const a = Buffer.from(una, "base64");
  const b = Buffer.from(otra, "base64");
  if (a.length === 0 || a.length !== b.length) return Number.POSITIVE_INFINITY;
  let suma = 0;
  for (let indice = 0; indice < a.length; indice += 1) suma += Math.abs(a[indice]! - b[indice]!);
  return suma / a.length;
}

/** Si dos huellas son la misma foto: miniaturas a menos de `UMBRAL_HUELLA` y la misma proporción. */
export function mismaFoto(una: HuellaImagen, otra: HuellaImagen): { igual: boolean; distancia: number } {
  const distancia = distanciaHuellas(una.huella, otra.huella);
  const proporcion = Math.abs(una.proporcion - otra.proporcion) / Math.max(una.proporcion, otra.proporcion);
  return { igual: distancia < UMBRAL_HUELLA && proporcion <= TOLERANCIA_PROPORCION, distancia };
}
