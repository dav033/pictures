import { z } from "zod";
import manifiestoCrudo from "../../../public/referencias-ejemplo/manifiesto.json";

/**
 * Fotos de referencia de ejemplo del estado inicial (iteración 4). Los
 * archivos viven en `public/referencias-ejemplo/` y el manifiesto versionado
 * guarda título, evento, fuente y licencia de cada una. Se valida al importar
 * para que un manifiesto mal editado falle en los tests y no en el navegador.
 */
export const RUTA_REFERENCIAS_EJEMPLO = "/referencias-ejemplo";

const FotoEjemploSchema = z.object({
  id: z.string().regex(/^ejemplo-\d{2}$/),
  titulo: z.string().min(1).max(60),
  evento: z.string().min(1).max(40),
  archivo: z.string().regex(/^[a-z0-9-]+\.jpg$/),
  miniatura: z.string().regex(/^[a-z0-9-]+\.jpg$/),
  ancho: z.number().int().positive().max(1200),
  alto: z.number().int().positive().max(1200),
  pexels_id: z.number().int().positive(),
  url_fuente: z.string().url().startsWith("https://www.pexels.com/photo/"),
  licencia: z.literal("Pexels License"),
  url_licencia: z.string().url(),
}).strict();

export const ManifiestoReferenciasEjemploSchema = z.object({
  schema_version: z.literal("referencias-ejemplo.v1"),
  actualizado: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  credito: z.string().min(1),
  fotos: z.array(FotoEjemploSchema).length(10),
}).strict();

export type FotoEjemplo = z.infer<typeof FotoEjemploSchema>;
export type ManifiestoReferenciasEjemplo = z.infer<typeof ManifiestoReferenciasEjemploSchema>;

export const MANIFIESTO_REFERENCIAS_EJEMPLO: ManifiestoReferenciasEjemplo = ManifiestoReferenciasEjemploSchema.parse(manifiestoCrudo);

export function urlFotoEjemplo(foto: FotoEjemplo): string {
  return `${RUTA_REFERENCIAS_EJEMPLO}/${foto.archivo}`;
}

export function urlMiniaturaEjemplo(foto: FotoEjemplo): string {
  return `${RUTA_REFERENCIAS_EJEMPLO}/${foto.miniatura}`;
}

/**
 * Descarga la foto del mismo origen y la devuelve como `File`, para que pase
 * por exactamente el mismo redimensionado que una foto subida por el cliente.
 */
export async function archivoDeFotoEjemplo(foto: FotoEjemplo, signal?: AbortSignal): Promise<File> {
  const respuesta = await fetch(urlFotoEjemplo(foto), { signal });
  if (!respuesta.ok) throw new Error(`No se pudo cargar la foto de ejemplo "${foto.titulo}".`);
  const blob = await respuesta.blob();
  return new File([blob], foto.archivo, { type: blob.type || "image/jpeg" });
}

/**
 * La foto de ejemplo tal cual está en `public/`, sin recomprimir: ya viene a
 * 1200 px, y con los mismos bytes en todos los navegadores el servidor
 * reconoce la foto y responde con su análisis revisado (`analisis-ejemplos`).
 */
export async function imagenDeFotoEjemplo(foto: FotoEjemplo, signal?: AbortSignal): Promise<{ base64: string; mime: string; ancho: number; alto: number; originalAncho: number; originalAlto: number }> {
  const archivo = await archivoDeFotoEjemplo(foto, signal);
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result));
    lector.onerror = () => reject(new Error(`No se pudo leer la foto de ejemplo "${foto.titulo}".`));
    lector.readAsDataURL(archivo);
  });
  return { base64: dataUrl.slice(dataUrl.indexOf(",") + 1), mime: "image/jpeg", ancho: foto.ancho, alto: foto.alto, originalAncho: foto.ancho, originalAlto: foto.alto };
}
