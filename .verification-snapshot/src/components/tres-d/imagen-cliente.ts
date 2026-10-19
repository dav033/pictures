/** Lado mayor (px) al que se reduce la foto antes de subirla a «Buscar por foto» (el servidor vuelve a acotarla). */
export const LADO_FOTO_PX = 1024;
/** Una foto de teléfono pesa 3-10 MB; más de esto no es una foto razonable y no se abre. */
const TOPE_ABRIR_BYTES = 40 * 1024 * 1024;

/** Si el archivo es una imagen que el navegador y el servidor aceptan. */
export const esFotoValida = (f: Blob): boolean => ["image/jpeg", "image/png", "image/webp"].includes(f.type);

/** La foto como JPEG de hasta `LADO_FOTO_PX` px (respeta la orientación EXIF), con fondo blanco bajo la transparencia. */
export async function reducirFoto(archivo: Blob): Promise<Blob> {
  if (!esFotoValida(archivo)) throw new Error("La foto debe ser JPEG, PNG o WebP.");
  if (archivo.size > TOPE_ABRIR_BYTES) throw new Error("La foto es demasiado grande.");
  const imagen = await createImageBitmap(archivo, { imageOrientation: "from-image" });
  try {
    const escala = Math.min(1, LADO_FOTO_PX / Math.max(imagen.width, imagen.height));
    const ancho = Math.max(1, Math.round(imagen.width * escala));
    const alto = Math.max(1, Math.round(imagen.height * escala));
    const lienzo = document.createElement("canvas");
    lienzo.width = ancho;
    lienzo.height = alto;
    const pincel = lienzo.getContext("2d");
    if (!pincel) throw new Error("No se pudo preparar la foto.");
    pincel.fillStyle = "#ffffff";
    pincel.fillRect(0, 0, ancho, alto);
    pincel.drawImage(imagen, 0, 0, ancho, alto);
    const salida = await new Promise<Blob | null>((r) => lienzo.toBlob(r, "image/jpeg", 0.85));
    if (!salida) throw new Error("No se pudo preparar la foto.");
    return salida;
  } finally {
    imagen.close();
  }
}
