import sharp from "sharp";
import type { MuestraPixeles } from "@/lib/plan/dominancia-color";

/**
 * Decodifica una imagen a píxeles RGB para que `medirDominanciaColor` pueda
 * clasificarlos. Este es el único punto que toca `sharp`: la medida en sí es
 * pura y vive en `src/lib/plan/dominancia-color.ts`.
 *
 * El redimensionado es parte del contrato de la medida, no una optimización:
 * `fit: "inside"` con `kernel: "nearest"` no inventa colores intermedios. Un
 * kernel interpolante (el `lanczos3` por defecto) mezcla el rojo de un globo
 * con el verde del césped y produce píxeles de un color que no está en la foto,
 * que es exactamente lo que esta medición existe para no hacer.
 */
const LADO_MAXIMO = 512;

export async function decodificarPixeles(imagen: Buffer): Promise<MuestraPixeles> {
  const { data, info } = await sharp(imagen)
    .resize({ width: LADO_MAXIMO, height: LADO_MAXIMO, fit: "inside", withoutEnlargement: true, kernel: "nearest" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { ancho: info.width, alto: info.height, rgb: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
}
