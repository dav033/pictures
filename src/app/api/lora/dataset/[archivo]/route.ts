import { readFile } from "node:fs/promises";
import path from "node:path";

const DATASET = path.join(process.cwd(), "data", "staging", "recaption-v004", "original");
// El servidor no tiene el dataset de staging (.dockerignore excluye data/), así
// que ahí las miniaturas salen de las fotos publicadas con el snapshot.
const SNAPSHOT = path.join(process.cwd(), "data", "snapshot", "imagenes");
const IMAGEN = /\.(jpe?g|png|webp)$/i;
const MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ archivo: string }> },
): Promise<Response> {
  const { archivo } = await params;

  // Solo permitir un nombre plano de imagen; nunca rutas relativas o archivos .txt.
  if (archivo !== path.basename(archivo) || !IMAGEN.test(archivo)) {
    return new Response("Archivo no permitido", { status: 400 });
  }

  try {
    const buffer = await readFile(path.join(DATASET, archivo)).catch(() => readFile(path.join(SNAPSHOT, archivo)));
    const extension = path.extname(archivo).slice(1).toLowerCase();
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": MIME[extension] ?? "application/octet-stream",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return new Response("Imagen no encontrada", { status: 404 });
  }
}
