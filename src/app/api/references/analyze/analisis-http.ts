import type { AnalisisV2Resultado } from "@/lib/ia/amaterasu/analizar-referencias-v2";
import { ErrorIA, type Imagen, type ImagenEtiquetada, type ProveedorId } from "@/lib/ia/nucleo/tipos";
import { traducirErrorServidor } from "@/lib/errores-ui/traducir-error-servidor";
import type { UiErrorV1 } from "@/lib/ia/contracts/ui-error-v1";

/**
 * Transport rules of `/api/references/analyze`, kept out of `route.ts` (Next
 * only allows HTTP handlers and route config as exports there) so they can be
 * tested without a server or a provider.
 */

/**
 * Body size the proxy actually delivers. `src/proxy.ts` matches this route, and
 * Next buffers a proxied body only up to `experimental.proxyClientMaxBodySize`
 * (default 10 MB); a larger body arrives truncated and used to fail as
 * malformed JSON ("Recarga la página"). Must equal the value in next.config.ts
 * (checked by scripts/test-reference-analyze-route.ts).
 */
export const LIMITE_CUERPO_ANALISIS_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGENES_REFERENCIA = 3;
/** JSON envelope, ids and dimensions around the base64 payload. */
const HOLGURA_JSON_BYTES = 64 * 1024;
/** Base64 characters are single bytes in the JSON body. */
export const MAX_BASE64_TOTAL = LIMITE_CUERPO_ANALISIS_BYTES - HOLGURA_JSON_BYTES;

const MIMES_ADMITIDOS = new Set(["image/png", "image/jpeg", "image/webp"]);
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export type Body = { images: Imagen[]; proveedor?: string; sinCache: boolean };

function fallo(codigo: string, detalle: string): Error {
  return new Error(`${codigo}: ${detalle}`);
}

/** Rejects a body the proxy may have truncated before it is parsed as JSON. */
export async function leerCuerpo(request: Request): Promise<unknown> {
  const declarado = Number(request.headers.get("content-length"));
  if (Number.isFinite(declarado) && declarado > LIMITE_CUERPO_ANALISIS_BYTES) {
    throw fallo("REFERENCE_IMAGE_TOO_LARGE", "Reference payload is too large.");
  }
  const texto = await request.text();
  // Without content-length (chunked) a truncated body is exactly the limit long.
  if (Buffer.byteLength(texto) >= LIMITE_CUERPO_ANALISIS_BYTES) {
    throw fallo("REFERENCE_IMAGE_TOO_LARGE", "Reference payload is too large.");
  }
  return JSON.parse(texto) as unknown;
}

function numeroOpcional(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

type FormatoDetectado = "image/png" | "image/jpeg" | "image/webp" | "no_admitido" | undefined;

/** Image format from its magic bytes, independent of the declared mime. */
export function detectarFormato(bytes: Buffer): FormatoDetectado {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 12 && bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(bytes.toString("latin1", 0, 6))) return "no_admitido";
  if (bytes.length >= 12 && bytes.toString("latin1", 4, 8) === "ftyp") return "no_admitido"; // HEIC/HEIF/AVIF
  if (bytes.length >= 2 && bytes.toString("latin1", 0, 2) === "BM") return "no_admitido";
  return undefined;
}

/**
 * Structural end-of-file check. A truncated upload keeps a valid header but
 * loses its end marker; the provider then "sees" only part of the photo (the
 * audit got a 200 with only string lights and "Listo").
 */
export function imagenTruncada(bytes: Buffer, formato: "image/png" | "image/jpeg" | "image/webp"): boolean {
  if (formato === "image/jpeg") {
    const cola = bytes.subarray(Math.max(0, bytes.length - 1024));
    for (let i = cola.length - 2; i >= 0; i -= 1) if (cola[i] === 0xff && cola[i + 1] === 0xd9) return false;
    return true;
  }
  if (formato === "image/png") return !bytes.subarray(Math.max(0, bytes.length - 64)).includes(Buffer.from("IEND", "latin1"));
  return bytes.length < 12 || bytes.readUInt32LE(4) + 8 > bytes.length;
}

/** Validates the untrusted body; returns images with the mime their bytes prove. */
export function validarCuerpo(raw: unknown): Body {
  const body = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const images = Array.isArray(body.images) ? body.images : [];
  if (images.length === 0) throw fallo("REFERENCE_NO_IMAGES", "Attach between one and three reference images.");
  if (images.length > MAX_IMAGENES_REFERENCIA) throw fallo("REFERENCE_TOO_MANY_IMAGES", "Attach between one and three reference images.");
  let total = 0;
  const validas = images.map((item, index): Imagen => {
    const image = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
    const base64 = typeof image.base64 === "string" ? image.base64.trim() : "";
    if (!base64) throw fallo("REFERENCE_IMAGE_EMPTY", `Reference image ${index + 1} is empty.`);
    if (typeof image.mime !== "string" || !MIMES_ADMITIDOS.has(image.mime)) throw fallo("REFERENCE_IMAGE_TYPE", "Only PNG, JPEG, and WebP reference images are supported.");
    total += base64.length;
    if (total > MAX_BASE64_TOTAL) throw fallo("REFERENCE_IMAGE_TOO_LARGE", "Reference payload is too large.");
    if (!BASE64.test(base64)) throw fallo("REFERENCE_IMAGE_UNREADABLE", `Reference image ${index + 1} is not valid base64.`);
    const bytes = Buffer.from(base64, "base64");
    const formato = detectarFormato(bytes);
    if (formato === "no_admitido") throw fallo("REFERENCE_IMAGE_TYPE", "Only PNG, JPEG, and WebP reference images are supported.");
    if (!formato) throw fallo("REFERENCE_IMAGE_UNREADABLE", `Reference image ${index + 1} is not a PNG, JPEG or WebP file.`);
    if (imagenTruncada(bytes, formato)) throw fallo("REFERENCE_IMAGE_UNREADABLE", `Reference image ${index + 1} is truncated.`);
    const ancho = numeroOpcional(image.ancho);
    const alto = numeroOpcional(image.alto);
    if (ancho !== undefined && (ancho < 128 || ancho > 12_000)) throw fallo("REFERENCE_IMAGE_DIMENSIONS", "Reference width is outside the supported range.");
    if (alto !== undefined && (alto < 128 || alto > 12_000)) throw fallo("REFERENCE_IMAGE_DIMENSIONS", "Reference height is outside the supported range.");
    return {
      base64,
      // A renamed file (PNG sent as image/jpeg) is still a valid photo; the
      // provider needs the real format.
      mime: formato,
      ...(ancho !== undefined ? { ancho } : {}),
      ...(alto !== undefined ? { alto } : {}),
      ...(numeroOpcional(image.originalAncho) !== undefined ? { originalAncho: numeroOpcional(image.originalAncho) } : {}),
      ...(numeroOpcional(image.originalAlto) !== undefined ? { originalAlto: numeroOpcional(image.originalAlto) } : {}),
    };
  });
  return {
    images: validas,
    proveedor: typeof body.proveedor === "string" ? body.proveedor : undefined,
    sinCache: body.sin_cache === true,
  };
}

export function referenciasEtiquetadas(images: Imagen[]): ImagenEtiquetada[] {
  return images.map((image, index) => ({
    ...image,
    id: `REF_${String(index + 1).padStart(2, "0")}`,
    descripcion: "Reference image pending forensic analysis.",
  }));
}

export function cuerpoExito(result: AnalisisV2Resultado, references: ImagenEtiquetada[], requestId: string, proveedor: ProveedorId): Record<string, unknown> {
  return {
    request_id: requestId,
    blueprint: result.blueprint,
    tieneEstructurasDeGlobos: result.tieneEstructurasDeGlobos,
    tieneElementos: result.tieneElementos,
    metadata: {
      ...result.metadata,
      image_dimensions: references.map((image) => ({ image_id: image.id, original: { width: image.originalAncho ?? null, height: image.originalAlto ?? null }, processed: { width: image.ancho ?? null, height: image.alto ?? null } })),
    },
    proveedor,
  };
}

function statusDe(error: unknown, uiError: UiErrorV1): number {
  if (uiError.detalles_dev.codigo_origen === "REFERENCE_IMAGE_TOO_LARGE") return 413;
  if (error instanceof ErrorIA) {
    if (uiError.code === "ADJUNTO_INVALIDO") return 422;
    if (error.causa === "sin_llave") return 503;
    if (error.causa === "cuota") return 429;
    if (error.causa === "filtrado") return 422;
    if (error.causa === "timeout") return 504;
    return 502;
  }
  return uiError.code === "ERROR_INTERNO" ? 500 : 400;
}

/**
 * Error response. The provider's raw text (Gemini's JSON error, quota
 * details) never reaches the browser in production: it goes to the server
 * log with the request id, and `detalles_dev` keeps only the stable origin.
 * Outside production the raw text stays in `detalles_dev` for the dev panel.
 */
export function respuestaError(error: unknown, requestId: string, produccion = process.env.NODE_ENV === "production"): { status: number; body: Record<string, unknown>; uiError: UiErrorV1 } {
  const traducido = traducirErrorServidor(error, requestId);
  const esProveedor = error instanceof ErrorIA;
  const uiError: UiErrorV1 = esProveedor && produccion
    ? { ...traducido, detalles_dev: { ...traducido.detalles_dev, mensaje: `Provider error (${error.causa}); see server logs for request ${requestId}.` } }
    : traducido;
  if (esProveedor) {
    console.warn("[references/analyze] provider error", JSON.stringify({ request_id: requestId, causa: error.causa, proveedor: error.proveedor, mensaje: error.message.slice(0, 500) }));
  }
  const body: Record<string, unknown> = { error: uiError.mensaje_usuario, request_id: requestId, ui_error: uiError };
  if (esProveedor) Object.assign(body, { causa: error.causa, proveedor: error.proveedor });
  return { status: statusDe(error, uiError), body, uiError };
}
