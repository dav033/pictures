import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { isAuthenticatedRequest } from "@/lib/auth/request";

const ORDER_DATASET_DIR = path.join(
  process.cwd(),
  "data",
  "staging",
  "recaption-v004",
  "original",
);
const WEB_DATASET_DIR = path.join(
  process.cwd(),
  "data",
  "staging",
  "lora-v006-orders-web-v001",
  "original",
);
const ORDERS_DIR = "C:\\Users\\davidt\\Downloads\\ordenes-decoracion";
const IMAGE = /\.(jpe?g|png|webp)$/i;
const MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

async function resolveOrderImage(archivo: string): Promise<{ buffer: Buffer; extension: string } | null> {
  const match = archivo.match(/^(\d+)-(\d+)\.(jpe?g|png|webp)$/i);
  if (!match) return null;
  const [, orderNumber, photoIndex] = match;
  const orderDir = path.join(ORDERS_DIR, orderNumber);
  try {
    const sourceName = (await readdir(orderDir)).find((name) => new RegExp(`^foto-${photoIndex}\\.(jpe?g|png|webp)$`, "i").test(name));
    if (!sourceName) return null;
    return { buffer: await readFile(path.join(orderDir, sourceName)), extension: path.extname(sourceName).slice(1).toLowerCase() };
  } catch {
    return null;
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ archivo: string }> },
): Promise<Response> {
  if (!isAuthenticatedRequest(request)) return new Response("SesiÃ³n requerida", { status: 401 });

  const { archivo } = await params;
  if (archivo !== path.basename(archivo) || !IMAGE.test(archivo)) {
    return new Response("Archivo no permitido", { status: 400 });
  }

  try {
    const resolvedOrderImage = await resolveOrderImage(archivo);
    const datasetDir = archivo.startsWith("web-") ? WEB_DATASET_DIR : ORDER_DATASET_DIR;
    const source = resolvedOrderImage ?? { buffer: await readFile(path.join(datasetDir, archivo)), extension: path.extname(archivo).slice(1).toLowerCase() };
    return new Response(new Uint8Array(source.buffer), {
      headers: {
        "Content-Type": MIME[source.extension] ?? "application/octet-stream",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return new Response("Imagen no encontrada", { status: 404 });
  }
}


