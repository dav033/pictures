/**
 * Qué foto acepta el adjunto de la guiada (`elegirFoto` de VistaGuiada): la subida a mano y la de ejemplo
 * (`FotosEjemploGuiada`) pasan por esta misma regla. Puro: sin DOM.
 */
export const TIPOS_FOTO: ReadonlySet<string> = new Set(["image/jpeg", "image/png", "image/webp"]);
export const MAX_BYTES_FOTO = 6_000_000;

export function fotoSubidaValida(archivo: { type: string; size: number }): boolean {
  return TIPOS_FOTO.has(archivo.type) && archivo.size <= MAX_BYTES_FOTO;
}
