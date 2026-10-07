import sharp from "sharp";

/**
 * La imagen que devuelve /api/generate, liviana para el viaje al navegador (las dos vistas).
 *
 * Producción, 2026-10-07 (guiada-20261007-071126-x7w4dx): FLUX entregó un PNG de 1536 × 1024 de 2,8 MB, que en base64
 * dentro del JSON pesó ~3,8 MB; el servidor respondió 200 en 11 s, pero en el móvil (Firefox Android, 5G) el fetch se
 * cortó con «NetworkError» y el cliente vio un error. El mismo dibujo en JPEG de calidad alta (90, mozjpeg, croma
 * 4:4:4 para que los bordes de los globos de color no se manchen) mide 200-400 KB sin diferencia visible: medido sobre
 * cinco imágenes reales de FLUX, 2,4-2,7 MB → 173-389 KB (scratchpad/imagen-espera/medir-compresion.cjs).
 *
 * Solo cambia el formato del viaje: misma resolución, mismos píxeles a la vista. Si sharp falla o el JPEG no sale
 * más chico, la imagen sigue tal cual llegó: aligerar nunca rompe una generación ya pagada.
 */
export const CALIDAD_JPEG_IMAGEN_GENERADA = 90;
/** Un JPEG que ya llega por debajo de esto no se vuelve a comprimir (se perdería calidad sin ganar nada). */
export const BYTES_JPEG_YA_LIVIANO = 700_000;

export type ImagenBase64 = { mime: string; base64: string };

export type ImagenAligerada = ImagenBase64 & {
  bytes: Buffer;
  bytesAntes: number;
  bytesDespues: number;
  ancho: number | null;
  alto: number | null;
  /** «comprimida»: salió en JPEG; si no, por qué se dejó como llegó. */
  resultado: "comprimida" | "ya_liviana" | "no_mejora" | "fallo";
  detalle?: string;
};

export async function aligerarImagenGenerada(imagen: ImagenBase64): Promise<ImagenAligerada> {
  const original = Buffer.from(imagen.base64, "base64");
  const sinCambio = (resultado: ImagenAligerada["resultado"], ancho: number | null = null, alto: number | null = null, detalle?: string): ImagenAligerada => ({
    mime: imagen.mime,
    base64: imagen.base64,
    bytes: original,
    bytesAntes: original.length,
    bytesDespues: original.length,
    ancho,
    alto,
    resultado,
    ...(detalle ? { detalle } : {}),
  });
  if (imagen.mime === "image/jpeg" && original.length <= BYTES_JPEG_YA_LIVIANO) return sinCambio("ya_liviana");
  try {
    const { data, info } = await sharp(original)
      // FLUX entrega RGB; si algún día llega con alfa, el fondo blanco evita el negro que pondría el JPEG.
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: CALIDAD_JPEG_IMAGEN_GENERADA, mozjpeg: true, chromaSubsampling: "4:4:4" })
      .toBuffer({ resolveWithObject: true });
    if (data.length >= original.length) return sinCambio("no_mejora", info.width, info.height);
    return {
      mime: "image/jpeg",
      base64: data.toString("base64"),
      bytes: data,
      bytesAntes: original.length,
      bytesDespues: data.length,
      ancho: info.width,
      alto: info.height,
      resultado: "comprimida",
    };
  } catch (error) {
    return sinCambio("fallo", null, null, error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200));
  }
}
