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
 *
 * `rotate()` sin argumentos aplica la orientación EXIF, y tampoco es opcional:
 * las cajas (`reference_bbox`) son relativas a la foto COMO SE VE, y sharp
 * decodifica los píxeles como están GUARDADOS. Con una foto de teléfono
 * (orientación 6) el fotograma sale 240×160 donde la vista derecha es 160×240,
 * así que la misma caja cae sobre otra región: medido sobre el fixture de
 * `eval/fixtures/exif`, el 40 % superior da 66 % de gris sin girar y 16 %
 * girado. La UI endereza en el navegador antes de subir, así que esto no se
 * veía desde la web; sí desde el bench, la evaluación y cualquier llamador que
 * no sea la UI. Es el mismo `.rotate()` que ya hacen `snapshot-imagenes.ts` y
 * los scripts de evaluación. (Se perdió con el revert `ee5db0f` del
 * 2026-10-02, que deshizo entero `994175d`, y se restauró el 2026-10-05.)
 */
const LADO_MAXIMO = 512;

export async function decodificarPixeles(imagen: Buffer): Promise<MuestraPixeles> {
  const { data, info } = await sharp(imagen)
    .rotate()
    .resize({ width: LADO_MAXIMO, height: LADO_MAXIMO, fit: "inside", withoutEnlargement: true, kernel: "nearest" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { ancho: info.width, alto: info.height, rgb: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
}
