import type { FotoAdjuntaIA } from "./cuerpo-escena-ia";

/**
 * La foto que el usuario adjunta en la barra de la IA (botón, pegar o soltar): se valida, se reduce en el navegador a
 * JPEG de hasta 1536 px (una foto de teléfono pesa 5 a 12 MB; el servidor admite 6 MB) y se codifica en base64 para el
 * cuerpo del pedido. Solo corre en el navegador; `validarArchivoFoto` y `primerArchivoDeImagen` son puros.
 */

export const LADO_FOTO_CLIENTE = 1536;
/** Lo más que se acepta de entrada: se reduce antes de enviar. */
export const TOPE_ARCHIVO_ENTRADA = 25 * 1024 * 1024;
/** Lo más que pesa lo que se envía (el servidor rechaza más de 6 MB). */
export const TOPE_ENVIO_BYTES = 5.5 * 1024 * 1024;
export const MIMES_ENTRADA: readonly string[] = ["image/jpeg", "image/png", "image/webp"];

/** El motivo por el que el archivo no sirve como foto, o `null` si sirve. */
export function validarArchivoFoto(archivo: { type: string; size: number }): string | null {
  if (!MIMES_ENTRADA.includes(archivo.type)) return "La foto debe ser JPEG, PNG o WebP.";
  if (archivo.size === 0) return "La foto está vacía.";
  if (archivo.size > TOPE_ARCHIVO_ENTRADA) return "La foto pesa más de 25 MB.";
  return null;
}

/** El primer archivo de imagen de una lista de archivos (soltar) o de items del portapapeles (pegar). */
export function primerArchivoDeImagen(fuente: { length: number; [i: number]: { kind?: string; type: string; getAsFile?: () => File | null } | File | undefined } | null | undefined): File | null {
  if (!fuente) return null;
  for (let i = 0; i < fuente.length; i++) {
    const x = fuente[i];
    if (!x || !x.type.startsWith("image/")) continue;
    if (x instanceof File) return x;
    const archivo = x.getAsFile?.() ?? null;
    if (archivo) return archivo;
  }
  return null;
}

export type FotoLista = FotoAdjuntaIA & { vista: string; bytes: number };

async function aBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binario = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binario);
}

/** Reduce el archivo a JPEG de hasta `LADO_FOTO_CLIENTE` px (bajando la calidad si aún pesa de más) y lo codifica. Lanza con un mensaje en español. */
export async function fotoDeArchivo(archivo: File): Promise<FotoLista> {
  const motivo = validarArchivoFoto(archivo);
  if (motivo) throw new Error(motivo);
  let imagen: ImageBitmap;
  try {
    imagen = await createImageBitmap(archivo, { imageOrientation: "from-image" });
  } catch {
    throw new Error("No se pudo leer la foto: el archivo no es una imagen válida.");
  }
  const escala = Math.min(1, LADO_FOTO_CLIENTE / Math.max(imagen.width, imagen.height));
  const lienzo = document.createElement("canvas");
  lienzo.width = Math.max(1, Math.round(imagen.width * escala));
  lienzo.height = Math.max(1, Math.round(imagen.height * escala));
  const contexto = lienzo.getContext("2d");
  if (!contexto) throw new Error("Este navegador no puede preparar la foto.");
  // JPEG no tiene transparencia: el fondo de un PNG transparente pasa a blanco.
  contexto.fillStyle = "#ffffff";
  contexto.fillRect(0, 0, lienzo.width, lienzo.height);
  contexto.drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
  imagen.close();
  for (const calidad of [0.85, 0.7, 0.55]) {
    const blob = await new Promise<Blob | null>((resolver) => lienzo.toBlob(resolver, "image/jpeg", calidad));
    if (!blob) throw new Error("Este navegador no puede preparar la foto.");
    if (blob.size <= TOPE_ENVIO_BYTES) return { mime: "image/jpeg", base64: await aBase64(blob), vista: URL.createObjectURL(blob), bytes: blob.size };
  }
  throw new Error("La foto sigue pesando demasiado aun reducida. Prueba con otra.");
}
