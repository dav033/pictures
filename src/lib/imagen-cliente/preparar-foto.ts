import type { Imagen } from "@/lib/ia/nucleo/tipos";

/**
 * Cómo se prepara en el navegador una foto antes de mandarla al servidor. Vive aquí, y no dentro de una vista, para
 * que la clásica (`src/app/page.tsx`) y la guiada (`VistaGuiada.tsx`) manden a `/api/references/analyze` la MISMA
 * imagen de la misma foto y la lectura sea la misma (pedido 1 y 3 del dueño, 2026-10-06). Hasta entonces la clásica
 * la reescalaba a 1800 px en JPEG 0,9 con la rotación EXIF aplicada y la guiada mandaba el archivo crudo: otra
 * resolución, otra compresión y, en una foto de celular girada por EXIF, otra orientación para el medidor de píxeles.
 * Solo navegador (canvas, createImageBitmap, FileReader).
 */

const TAMANO_MAX_ARCHIVO = 20 * 1024 * 1024; // 20MB crudos — generoso para fotos de celular, evita colgar canvas con archivos absurdos.

/** Lado mayor y calidad JPEG de una foto de referencia (inspiración) en las dos vistas. */
export const LADO_MAXIMO_REFERENCIA = 1800;
export const CALIDAD_REFERENCIA = 0.9;

/**
 * Convierte un archivo subido a un `Imagen` liviano para mandar por JSON:
 * respeta la rotación EXIF de fotos de celular, reescala al máximo indicado
 * y siempre normaliza a JPEG (tamaño predecible sin importar el formato de
 * origen). Lanza con mensaje legible si el archivo no es una imagen válida.
 */
export async function redimensionarImagen(
  file: File,
  maxDim: number,
  calidad: number,
): Promise<Imagen & { ancho: number; alto: number }> {
  // Fotos de iPhone salen en HEIC/HEIF por defecto — ni Chrome ni Firefox en
  // Windows/Android lo decodifican de forma confiable vía createImageBitmap
  // (a veces ni siquiera lanza error, solo produce un bitmap vacío/negro en
  // silencio). El MIME también puede llegar vacío en vez de "image/heic" si
  // el sistema no tiene el codec registrado, así que se revisa también la
  // extensión del archivo para dar un mensaje útil en vez de un fallo mudo.
  const esHeic = /\.(heic|heif)$/i.test(file.name) || /^image\/hei[cf]/i.test(file.type);
  if (esHeic) {
    throw new Error(
      `"${file.name}" está en formato HEIC/HEIF (típico de iPhone) y no se puede leer en este navegador. Expórtala como JPEG o PNG antes de subirla.`,
    );
  }
  if (!file.type.startsWith("image/")) {
    throw new Error(`"${file.name}" no es una imagen.`);
  }
  if (file.size > TAMANO_MAX_ARCHIVO) {
    throw new Error(`"${file.name}" pesa demasiado (máximo 20MB).`);
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(`No se pudo leer "${file.name}" — ¿es una imagen válida?`);
  }
  if (bitmap.width === 0 || bitmap.height === 0) {
    bitmap.close();
    throw new Error(`"${file.name}" se leyó vacía o corrupta — prueba exportarla de nuevo como JPEG o PNG.`);
  }

  try {
    const escala = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const ancho = Math.round(bitmap.width * escala);
    const alto = Math.round(bitmap.height * escala);

    const canvas = document.createElement("canvas");
    canvas.width = ancho;
    canvas.height = alto;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Este navegador no pudo procesar la imagen. Prueba con otro navegador.");
    ctx.drawImage(bitmap, 0, 0, ancho, alto);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("No se pudo procesar la imagen."))),
        "image/jpeg",
        calidad,
      );
    });

    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
      reader.onerror = () => reject(new Error("No se pudo leer la imagen procesada."));
      reader.readAsDataURL(blob);
    });

    return { base64, mime: "image/jpeg", ancho, alto, originalAncho: bitmap.width, originalAlto: bitmap.height };
  } finally {
    bitmap.close();
  }
}

/** Una foto de referencia (inspiración) lista para `/api/references/analyze`, igual en la clásica y en la guiada. */
export function prepararFotoReferencia(file: File): Promise<Imagen & { ancho: number; alto: number }> {
  return redimensionarImagen(file, LADO_MAXIMO_REFERENCIA, CALIDAD_REFERENCIA);
}
