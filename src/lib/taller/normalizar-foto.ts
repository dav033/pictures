import sharp from "sharp";
import { LADO_MAXIMO_FOTO } from "./buscar-foto";

/** La foto de «Buscar por foto» como JPEG de hasta `LADO_MAXIMO_FOTO` px por lado (respeta la orientación EXIF; el fondo transparente pasa a blanco). Lanza si no es una imagen legible. */
export async function normalizarFoto(bytes: Uint8Array): Promise<Uint8Array> {
  const salida = await sharp(bytes, { failOn: "error" })
    .rotate()
    .resize(LADO_MAXIMO_FOTO, LADO_MAXIMO_FOTO, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 85 })
    .toBuffer();
  return new Uint8Array(salida);
}
