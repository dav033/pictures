import sharp from "sharp";
import { LADO_MAXIMO_FOTO } from "./buscar-foto";

/** La foto como JPEG de hasta `lado` px por lado (respeta la orientación EXIF; el fondo transparente pasa a blanco). Lanza si no es una imagen legible. */
export async function normalizarFotoA(bytes: Uint8Array, lado: number): Promise<Uint8Array> {
  const salida = await sharp(bytes, { failOn: "error" })
    .rotate()
    .resize(lado, lado, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 85 })
    .toBuffer();
  return new Uint8Array(salida);
}

/** La foto de «Buscar por foto» como JPEG de hasta `LADO_MAXIMO_FOTO` px por lado. Lanza si no es una imagen legible. */
export const normalizarFoto = (bytes: Uint8Array): Promise<Uint8Array> => normalizarFotoA(bytes, LADO_MAXIMO_FOTO);
