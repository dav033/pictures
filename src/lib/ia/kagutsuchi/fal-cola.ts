import { crearFetchAuditado } from "@/lib/registro/servidor";

/**
 * El transporte común de las llamadas a la cola de fal (FLUX.2, FLUX.1 [dev], Kontext): lista de hosts permitidos (también para las
 * redirecciones), `fetch` auditado, lectura acotada de la imagen y traducción de los rechazos de la cuenta. Sin lógica de modelo:
 * cada modelo arma su cuerpo, su espera y su telemetría en su módulo.
 */
const FAL_QUEUE_HOSTS = new Set(["queue.fal.run", "rest.alpha.fal.ai"]);
const MAX_FAL_IMAGE_BYTES = 16_000_000;

type FalImage = { url?: string; content_type?: string };
type FalResponse = { images?: FalImage[] };
type FalQueueSubmission = {
  request_id: string;
  response_url: string;
  status_url: string;
};
type FalQueueStatus = {
  status?: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "CANCELLED";
  error?: string;
};

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * fal.ai refused the account, not the request: 402/403 without balance ("User is
 * locked. Reason: Exhausted balance") or 401/403 with an invalid key. Retrying
 * cannot fix it, so the UI maps it to a non-retryable message
 * (`VISTA_PREVIA_NO_DISPONIBLE`) while the approved proposal stays saved.
 */
export class ProveedorImagenNoDisponibleError extends Error {
  readonly causa: "saldo_agotado" | "acceso_denegado";
  readonly status: number;

  constructor(status: number, causa: "saldo_agotado" | "acceso_denegado", detalle: string) {
    super(`IMAGEN_PROVEEDOR_NO_DISPONIBLE: fal.ai rechazó la cuenta (${status}, ${causa})${detalle ? `: ${detalle}` : ""}`);
    this.name = "ProveedorImagenNoDisponibleError";
    this.causa = causa;
    this.status = status;
  }
}

const ESTADOS_CUENTA_RECHAZADA = new Set([401, 402, 403]);
const SIN_SALDO = /balance|billing|locked|top up|payment|credit|quota exceeded/i;

export async function falResponseError(response: Response, fallback: string): Promise<Error> {
  let detail = "";
  try {
    const body = await response.json() as unknown;
    if (body && typeof body === "object") {
      const payload = body as { detail?: unknown; error?: unknown };
      if (typeof payload.error === "string") detail = payload.error;
      else if (typeof payload.detail === "string") detail = payload.detail;
      else if (Array.isArray(payload.detail)) detail = payload.detail.map((item) => typeof item === "string" ? item : JSON.stringify(item)).join(" ");
    }
  } catch {
    // Un proxy puede devolver HTML en lugar de JSON.
  }
  if (ESTADOS_CUENTA_RECHAZADA.has(response.status)) {
    const causa = response.status === 402 || SIN_SALDO.test(detail) ? "saldo_agotado" : "acceso_denegado";
    return new ProveedorImagenNoDisponibleError(response.status, causa, detail.slice(0, 300));
  }
  return new Error(`${fallback} (${response.status})${detail ? `: ${detail.slice(0, 300)}` : ""}`);
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function parseQueueSubmission(value: unknown): FalQueueSubmission | null {
  const record = recordValue(value);
  const requestId = stringField(record?.request_id);
  const statusUrl = stringField(record?.status_url);
  const responseUrl = stringField(record?.response_url);
  return requestId && statusUrl && responseUrl
    ? { request_id: requestId, status_url: statusUrl, response_url: responseUrl }
    : null;
}

export function parseQueueStatus(value: unknown): FalQueueStatus | null {
  const record = recordValue(value);
  const status = record?.status;
  if (status !== "IN_QUEUE" && status !== "IN_PROGRESS" && status !== "COMPLETED" && status !== "FAILED" && status !== "CANCELLED") return null;
  return { status, error: typeof record?.error === "string" ? record.error : undefined };
}

export function parseFalResponse(value: unknown): FalResponse | null {
  const record = recordValue(value);
  if (!Array.isArray(record?.images)) return null;
  const images = record.images.map((image): FalImage | null => {
    const item = recordValue(image);
    const url = stringField(item?.url);
    if (!url) return null;
    return { url, content_type: typeof item?.content_type === "string" ? item.content_type : undefined };
  });
  return images.every((image): image is FalImage => image !== null) ? { images } : null;
}

export function isAllowedFalQueueUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port && FAL_QUEUE_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

export function isAllowedFalImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port && (url.hostname === "fal.media" || url.hostname.endsWith(".fal.media"));
  } catch {
    return false;
  }
}

/**
 * `fetch` auditado hacia fal (src/lib/registro): envío a la cola (prompt, parámetros, referencias como hash),
 * resultado (URL de la imagen) y descarga, con estado y ms. Los sondeos de estado de la cola no se auditan
 * (serían decenas de líneas iguales por imagen). Llama al `fetch` global del momento (las pruebas lo sustituyen).
 */
const fetchFalAuditado = crearFetchAuditado((entrada, init) => fetch(entrada, init), {
  tipo: "http",
  proveedor: "fal",
  omitir: (url, metodo) => metodo === "GET" && /\/status\/?$/.test(url.split("?")[0] ?? ""),
});

export async function fetchFalAllowed(
  url: string,
  init: RequestInit,
  isAllowedUrl: (value: string) => boolean,
): Promise<Response> {
  let currentUrl = url;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetchFalAuditado(currentUrl, { ...init, redirect: "manual" });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("location");
    if (!location) throw new Error("fal.ai devolvió un redirect sin destino.");
    const nextUrl = new URL(location, currentUrl).toString();
    if (!isAllowedUrl(nextUrl)) throw new Error("fal.ai devolvió un redirect a un host no permitido.");
    currentUrl = nextUrl;
  }
  throw new Error("fal.ai excedió el máximo de redirects permitidos.");
}

export async function readBoundedImage(response: Response): Promise<Buffer> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_FAL_IMAGE_BYTES) {
    throw new Error("fal.ai devolvió una imagen demasiado grande.");
  }
  if (!response.body) throw new Error("fal.ai devolvió una respuesta de imagen sin cuerpo.");

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_FAL_IMAGE_BYTES) {
        await reader.cancel();
        throw new Error("fal.ai devolvió una imagen demasiado grande.");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

const TIPOS_IMAGEN_PERMITIDOS = new Set(["image/png", "image/jpeg", "image/webp"]);

/**
 * Lo que sigue a una solicitud COMPLETED: el resultado, la validación de su URL, la descarga acotada y el tipo de la imagen.
 * `signalFor` entrega la señal de cada paso (el llamador decide cuánto le queda).
 */
export async function traerImagenDeFal(
  responseUrl: string,
  clave: string,
  signalFor: (presupuestoMs: number) => AbortSignal,
  etiqueta: string,
): Promise<{ base64: string; mime: string }> {
  const resultResponse = await fetchFalAllowed(responseUrl, { headers: { Authorization: `Key ${clave}` }, signal: signalFor(15_000) }, isAllowedFalQueueUrl);
  if (!resultResponse.ok) throw await falResponseError(resultResponse, `fal.ai no devolvió el resultado ${etiqueta}`);
  const result = parseFalResponse(await resultResponse.json());
  const url = result?.images?.[0]?.url;
  if (!result || !url || !isAllowedFalImageUrl(url)) throw new Error(`fal.ai no devolvió una imagen ${etiqueta} válida.`);
  const imageResponse = await fetchFalAllowed(url, { signal: signalFor(15_000) }, isAllowedFalImageUrl);
  if (!imageResponse.ok) throw new Error(`No se pudo descargar la imagen de ${etiqueta} (${imageResponse.status}).`);
  const contentType = result.images?.[0]?.content_type ?? imageResponse.headers.get("content-type")?.split(";", 1)[0];
  if (!contentType || !TIPOS_IMAGEN_PERMITIDOS.has(contentType.toLowerCase())) throw new Error("fal.ai devolvió un tipo de imagen no permitido.");
  return { base64: (await readBoundedImage(imageResponse)).toString("base64"), mime: contentType.toLowerCase() };
}
