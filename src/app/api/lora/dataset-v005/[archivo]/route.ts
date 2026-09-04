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
const V007_ANNOTATIONS_DIR = path.join(process.cwd(), "data", "staging", "lora-v007", "anotaciones");
// En el servidor no existen ni las carpetas de staging ni la de órdenes, así que
// las fotos salen de las que se publicaron con el snapshot.
const SNAPSHOT_DIR = path.join(process.cwd(), "data", "snapshot", "imagenes");
const ORDERS_DIR = "C:\\Users\\davidt\\Downloads\\ordenes-decoracion";
const IMAGE = /\.(jpe?g|png|webp)$/i;
const WEB_IMAGE = /^web-\d+\.(jpe?g|png|webp)$/i;
const MAX_REMOTE_IMAGE_BYTES = 12 * 1024 * 1024;
const REMOTE_IMAGE_TIMEOUT_MS = 12_000;
const REMOTE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

type V007WebAnnotation = { source?: { source_url?: unknown } };

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

function allowedRemoteImageUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    const host = url.hostname.toLocaleLowerCase();
    const allowedHost = host === "sempertex.com" || host.endsWith(".sempertex.com") || host === "cdn.shopify.com";
    return url.protocol === "https:" && allowedHost ? url : null;
  } catch {
    return null;
  }
}

async function webSourceUrl(archivo: string): Promise<URL | null> {
  if (!WEB_IMAGE.test(archivo)) return null;
  const annotationPath = path.join(V007_ANNOTATIONS_DIR, `${archivo.replace(/\.[^.]+$/, "")}.json`);
  try {
    const annotation = JSON.parse(await readFile(annotationPath, "utf8")) as V007WebAnnotation;
    return typeof annotation.source?.source_url === "string" ? allowedRemoteImageUrl(annotation.source.source_url) : null;
  } catch {
    return null;
  }
}

async function readBoundedImage(response: Response): Promise<Buffer> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REMOTE_IMAGE_BYTES) throw new Error("Imagen remota demasiado grande");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Imagen remota sin contenido");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_REMOTE_IMAGE_BYTES) {
      await reader.cancel();
      throw new Error("Imagen remota demasiado grande");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function fetchAnnotatedWebImage(initialUrl: URL): Promise<{ buffer: Buffer; contentType: string }> {
  let url = initialUrl;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(REMOTE_IMAGE_TIMEOUT_MS) });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      const nextUrl = location ? allowedRemoteImageUrl(new URL(location, url).toString()) : null;
      if (!nextUrl) throw new Error("Redirección remota no permitida");
      url = nextUrl;
      continue;
    }
    if (!response.ok) throw new Error("Imagen remota no disponible");
    const contentType = response.headers.get("content-type")?.split(";", 1)[0].toLocaleLowerCase() ?? "";
    if (!REMOTE_IMAGE_TYPES.has(contentType)) throw new Error("Tipo de imagen remota no permitido");
    return { buffer: await readBoundedImage(response), contentType };
  }
  throw new Error("Demasiadas redirecciones remotas");
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
    const extension = path.extname(archivo).slice(1).toLowerCase();
    const source =
      resolvedOrderImage ?? {
        buffer: await readFile(path.join(datasetDir, archivo)).catch(() => readFile(path.join(SNAPSHOT_DIR, archivo))),
        extension,
      };
    return new Response(new Uint8Array(source.buffer), {
      headers: {
        "Content-Type": MIME[source.extension] ?? "application/octet-stream",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    const annotatedUrl = await webSourceUrl(archivo);
    if (annotatedUrl) {
      try {
        const source = await fetchAnnotatedWebImage(annotatedUrl);
        return new Response(new Uint8Array(source.buffer), {
          headers: { "Content-Type": source.contentType, "Cache-Control": "private, max-age=3600" },
        });
      } catch {
        // Fall through to a non-descriptive 404 so remote URL details never leave the server.
      }
    }
    return new Response("Imagen no encontrada", { status: 404 });
  }
}

