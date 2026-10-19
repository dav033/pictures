import "server-only";
import { randomUUID } from "node:crypto";
import { unlinkSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const UPLOADS_DIR = path.join(process.cwd(), "public", "uploads");

const EXTENSION_POR_TIPO: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

const TAMANO_MAXIMO = 8 * 1024 * 1024;

/** Guarda un File subido en /public/uploads/<carpeta> y devuelve su ruta pública. */
export async function guardarImagen(file: File, carpeta: string): Promise<string> {
  const ext = EXTENSION_POR_TIPO[file.type];
  if (!ext) throw new Error("Formato de imagen no soportado. Usa PNG, JPG o WEBP.");
  if (file.size > TAMANO_MAXIMO) throw new Error("La imagen no puede pesar más de 8 MB.");

  const destino = path.join(UPLOADS_DIR, carpeta);
  await mkdir(destino, { recursive: true });
  const nombre = `${randomUUID()}.${ext}`;
  writeFileSync(path.join(destino, nombre), Buffer.from(await file.arrayBuffer()));
  return `/uploads/${carpeta}/${nombre}`;
}

/** Borra una imagen previamente guardada con guardarImagen. Silencioso si ya no existe. */
export function borrarImagen(rutaPublica: string | undefined | null): void {
  if (!rutaPublica?.startsWith("/uploads/")) return;
  try {
    unlinkSync(path.join(process.cwd(), "public", rutaPublica));
  } catch {
    // ya no existía, no pasa nada
  }
}

export function nuevoId(): string {
  return randomUUID();
}
