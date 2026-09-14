import type { ImageInput, Imagen, PeticionImagen } from "./tipos";
import type { LoraSpecialization } from "@/lib/lora/schema";
import { bytesBase64, idsTelemetria, resultadoTelemetria, type ContextoTelemetriaIA } from "./telemetria-llamadas";
import { registrarLlamadaIA } from "@sempertex/agente-core";

const TEXT_ENDPOINT = "https://queue.fal.run/fal-ai/flux-2/lora";
const EDIT_ENDPOINT = "https://queue.fal.run/fal-ai/flux-2/lora/edit";
const FAL_QUEUE_HOSTS = new Set(["queue.fal.run", "rest.alpha.fal.ai"]);
const MAX_FAL_IMAGE_BYTES = 16_000_000;
/**
 * Trigger neutro usado SOLO para preflight/telemetría cuando todavía no hay
 * una aplicación LoRA resuelta (por ejemplo, al reportar qué trigger se
 * esperaría). Nunca se usa para armar un payload real: `lorasFor` exige
 * `ResolvedLoraApplication[]` explícito y falla si no lo recibe.
 */
export const DEFAULT_SEMPERTEX_LORA_TRIGGER = "eventdecor_style_v3" as const;
const MAX_EDIT_IMAGES = 4;

export type SempertexLoraOptions = {
  seed?: number;
  /** flux-2 guidance scale from the creativity level (creatividad.ts); defaults to 3.5. */
  guidanceScale?: number;
  /**
   * Obligatorio. Debe venir de `resolveLoraMode`/`resolveLoraSelection`
   * (`@/lib/lora/mode-resolver`) — nunca de una URL o trigger escritos a
   * mano. No existe combinación por defecto: sin esto, la llamada falla
   * antes de tocar la red. Ver PLAN-COMPOSICION-RICA-V001.md §1.1 y §9.2.
   */
  loras: LoraApplication[];
  /** Cancels provider I/O when the client disconnects or the route expires. */
  signal?: AbortSignal;
  telemetria?: ContextoTelemetriaIA;
};

export type LoraApplication = {
  artifactId?: string;
  specialization?: LoraSpecialization;
  path: string;
  trigger: string;
  scale: number;
};

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function falResponseError(response: Response, fallback: string): Promise<Error> {
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
  return new Error(`${fallback} (${response.status})${detail ? `: ${detail.slice(0, 300)}` : ""}`);
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function parseQueueSubmission(value: unknown): FalQueueSubmission | null {
  const record = recordValue(value);
  const requestId = stringField(record?.request_id);
  const statusUrl = stringField(record?.status_url);
  const responseUrl = stringField(record?.response_url);
  return requestId && statusUrl && responseUrl
    ? { request_id: requestId, status_url: statusUrl, response_url: responseUrl }
    : null;
}

function parseQueueStatus(value: unknown): FalQueueStatus | null {
  const record = recordValue(value);
  const status = record?.status;
  if (status !== "IN_QUEUE" && status !== "IN_PROGRESS" && status !== "COMPLETED" && status !== "FAILED" && status !== "CANCELLED") return null;
  return { status, error: typeof record?.error === "string" ? record.error : undefined };
}

function parseFalResponse(value: unknown): FalResponse | null {
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

function isAllowedFalQueueUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port && FAL_QUEUE_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function isAllowedFalImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port && (url.hostname === "fal.media" || url.hostname.endsWith(".fal.media"));
  } catch {
    return false;
  }
}

async function fetchFalAllowed(
  url: string,
  init: RequestInit,
  isAllowedUrl: (value: string) => boolean,
): Promise<Response> {
  let currentUrl = url;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(currentUrl, { ...init, redirect: "manual" });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("location");
    if (!location) throw new Error("fal.ai devolvió un redirect sin destino.");
    const nextUrl = new URL(location, currentUrl).toString();
    if (!isAllowedUrl(nextUrl)) throw new Error("fal.ai devolvió un redirect a un host no permitido.");
    currentUrl = nextUrl;
  }
  throw new Error("fal.ai excedió el máximo de redirects permitidos.");
}

async function readBoundedImage(response: Response): Promise<Buffer> {
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

const imageSizeFor = (aspecto: PeticionImagen["aspecto"]) => {
  switch (aspecto) {
    case "1:1": return { width: 1024, height: 1024 };
    case "2:3": return { width: 1024, height: 1536 };
    case "16:9": return { width: 1536, height: 864 };
    default: return { width: 1536, height: 1024 };
  }
};

/**
 * Por defecto el LoRA NO recibe imágenes: siempre texto a imagen.
 *
 * El LoRA se entrenó con 154 captions de escena, sin ninguna imagen de
 * condicionamiento, y toda su validación (6/6 a escala 0,8 y 1,0) se hizo por
 * `TEXT_ENDPOINT`. Pasarle referencias lo cambiaba de endpoint a `/edit`, un
 * régimen distinto que nunca se midió, y además inflaba el prompt de 406 a 1567
 * caracteres con un bloque de instrucciones (`INPUT IMAGE GUIDE`) en un registro
 * que el LoRA jamás vio — sus captions son descripción de escena, mediana 54
 * palabras, mientras el prompt con guía ronda las 250.
 *
 * La identidad de producto no se pierde: color, acabado y tamaño ya viajan como
 * texto en el caption compilado.
 *
 * `SEMPERTEX_LORA_EDIT=true` reactiva el condicionamiento por imagen. Existe
 * para el condicionamiento experimental por layout —renderizar las cajas
 * del SceneSpec y pasarlas como referencia—, no para producción: si se
 * enciende, hay que volver a correr el panel de 6 seeds antes de confiar en él.
 */
function prepararReferencias(inputs: ImageInput[]): ImageInput[] {
  if (process.env.SEMPERTEX_LORA_EDIT !== "true") return [];
  return [...inputs]
    .sort((a, b) => a.priority - b.priority)
    .slice(0, MAX_EDIT_IMAGES);
}

function validarUnaAplicacion(loras: LoraApplication[]): void {
  if (loras.length !== 1) throw new Error("LORA_MULTI_UNSUPPORTED: solo se permite un LoRA por generación.");
}

/**
 * Recorta a `maximo` sin partir palabras y sin dejar puntuación colgando.
 *
 * El corte crudo a 180 caracteres producía frases truncadas a mitad de palabra
 * ("never package su") y puntos dobles cuando la descripción ya terminaba en
 * punto ("del cliente.. USE ONLY:").
 */
function recortarLimpio(texto: string, maximo: number): string {
  const limpio = texto.trim().replace(/[.,;:\s]+$/, "");
  if (limpio.length <= maximo) return limpio;
  const cortado = limpio.slice(0, maximo);
  const ultimoEspacio = cortado.lastIndexOf(" ");
  return (ultimoEspacio > maximo * 0.6 ? cortado.slice(0, ultimoEspacio) : cortado).replace(/[.,;:\s]+$/, "");
}

function promptConReferencias(prompt: string, references: ImageInput[]): string {
  if (!references.length) return prompt;
  const guide = references.map((image, index) =>
    `IMAGE ${index + 1} (${image.role}, ${image.id}): ${recortarLimpio(image.descripcion, 180)}. USE ONLY: ${recortarLimpio(image.allowed_use, 180)}.`,
  );
  return `${prompt}\n\nINPUT IMAGE GUIDE\n${guide.join("\n")}\nRebuild one cohesive photorealistic event scene. Never output a collage, product board, isolated cutouts, or separate samples.`;
}

/** Bounded to the range the creativity levels use; anything else keeps the historical 3.5. */
export function guidanceScaleSeguro(valor: number | undefined): number {
  return typeof valor === "number" && Number.isFinite(valor) && valor >= 1.5 && valor <= 5 ? valor : 3.5;
}

export async function generarConSempertexLora(
  prompt: string,
  aspecto: PeticionImagen["aspecto"],
  inputs: ImageInput[] = [],
  options: SempertexLoraOptions,
): Promise<Imagen> {
  if (!options.loras?.length) {
    throw new Error("LORA_APPLICATION_REQUIRED: generarConSempertexLora necesita al menos un ResolvedLoraApplication resuelto desde el registro; no existe combinación URL/trigger por defecto.");
  }
  validarUnaAplicacion(options.loras);
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("LoRA Sempertex no está conectado todavía: falta FAL_KEY en .env.local.");

  const references = prepararReferencias(inputs);
  const endpoint = references.length ? EDIT_ENDPOINT : TEXT_ENDPOINT;

  const inicio = Date.now();
  const deadlineAt = inicio + 105_000;
  const signalFor = (budgetMs: number): AbortSignal => {
    const remainingMs = Math.max(1, Math.min(budgetMs, deadlineAt - Date.now()));
    const timeoutSignal = AbortSignal.timeout(remainingMs);
    return options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
  };
  let proveedorRequestId: string | undefined;
  const ids = idsTelemetria(options.telemetria);
  const registrar = (resultado: "ok" | "error" | "timeout" | "cancelado") => registrarLlamadaIA({
    proveedor: "fal",
    flujo: "generador_imagen",
    capacidad: "imagen_generacion",
    modelo: references.length ? "flux-2/lora/edit" : "flux-2/lora",
    superficie: options.telemetria?.superficie ?? "/api/generate",
    requestId: ids.requestId,
    correlationId: ids.correlationId,
    intento: options.telemetria?.intento ?? 1,
    proveedorRequestId,
    ms: Math.max(0, Date.now() - inicio),
    resultado,
    bytesImagenEntrada: references.reduce((total, image) => total + bytesBase64(image.base64), 0),
    unidadesFacturadas: resultado === "ok" ? 1 : undefined,
  });

  try {
  const response = await fetchFalAllowed(endpoint, {
    method: "POST",
    headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: ensureLoraTriggers(promptConReferencias(prompt, references), options.loras),
      loras: lorasFor(options.loras),
      guidance_scale: guidanceScaleSeguro(options.guidanceScale),
      num_inference_steps: 28,
      image_size: imageSizeFor(aspecto),
      ...(Number.isInteger(options.seed) ? { seed: options.seed } : {}),
      ...(references.length ? { image_urls: references.map((image) => `data:${image.mime};base64,${image.base64}`) } : {}),
      num_images: 1,
      enable_prompt_expansion: false,
      enable_safety_checker: true,
      output_format: "png",
    }),
    signal: signalFor(30_000),
  }, isAllowedFalQueueUrl);

  if (!response.ok) throw await falResponseError(response, "fal.ai rechazó la solicitud LoRA");
  const submission = parseQueueSubmission(await response.json());
  if (!submission || !isAllowedFalQueueUrl(submission.status_url) || !isAllowedFalQueueUrl(submission.response_url)) {
    throw new Error("fal.ai no devolvió una solicitud LoRA en cola válida.");
  }
  proveedorRequestId = submission.request_id;

  let completed = false;
  while (Date.now() < deadlineAt) {
    const statusResponse = await fetchFalAllowed(submission.status_url, {
      headers: { Authorization: `Key ${key}` },
      signal: signalFor(15_000),
    }, isAllowedFalQueueUrl);
    if (!statusResponse.ok) throw await falResponseError(statusResponse, "fal.ai no pudo consultar el estado LoRA");
    const status = parseQueueStatus(await statusResponse.json());
    if (!status) throw new Error("fal.ai devolvió un estado LoRA inválido.");
    if (status.status === "COMPLETED") {
      completed = true;
      break;
    }
    if (status.status === "FAILED" || status.status === "CANCELLED") {
      const detail = typeof status.error === "string" ? `: ${status.error.slice(0, 300)}` : "";
      throw new Error(`fal.ai no pudo completar la generación LoRA${detail}`);
    }
    await sleep(1_500);
  }
  if (!completed) throw new Error("fal.ai tardó demasiado en completar la generación LoRA.");

  const resultResponse = await fetchFalAllowed(submission.response_url, {
    headers: { Authorization: `Key ${key}` },
    signal: signalFor(15_000),
  }, isAllowedFalQueueUrl);
  if (!resultResponse.ok) throw await falResponseError(resultResponse, "fal.ai no devolvió el resultado LoRA");
  const result = parseFalResponse(await resultResponse.json());
  const url = result?.images?.[0]?.url;
  if (!result || !url || !isAllowedFalImageUrl(url)) throw new Error("fal.ai no devolvió una imagen LoRA válida.");

  const imageResponse = await fetchFalAllowed(url, { signal: signalFor(15_000) }, isAllowedFalImageUrl);
   if (!imageResponse.ok) throw new Error(`No se pudo descargar la imagen generada por fal.ai (${imageResponse.status}).`);
   const contentType = result.images?.[0]?.content_type ?? imageResponse.headers.get("content-type")?.split(";", 1)[0];
   if (!contentType || !new Set(["image/png", "image/jpeg", "image/webp"]).has(contentType.toLowerCase())) {
     throw new Error("fal.ai devolvió un tipo de imagen no permitido.");
   }
   const imageBytes = await readBoundedImage(imageResponse);
   const imagen = {
     base64: imageBytes.toString("base64"),
     mime: contentType.toLowerCase(),
   };
  registrar("ok");
  return imagen;
  } catch (error) {
    registrar(resultadoTelemetria(error));
    throw error;
  }
}

function lorasFor(loras: LoraApplication[]): Array<{ path: string; scale: number }> {
  return loras.map((lora) => ({ path: lora.path, scale: lora.scale }));
}

/**
 * Cualquier trigger de este proyecto sigue el patrón `eventdecor_<nombre>_v<N>`
 * (`eventdecor_style_v2`, `eventdecor_style_v3`, `eventdecor_structure_v1`, …).
 * En vez de mantener una lista hardcodeada de triggers "conocidos" para
 * quitar, se quita cualquier corrida de triggers que ya venga como preámbulo
 * del prompt — así no hay que tocar esta función cada vez que se registra un
 * nuevo trigger en el registro LoRA.
 */
const LEADING_TRIGGER_RUN = /^(?:eventdecor_[a-z0-9]+_v\d+\s*,\s*)+/i;

/**
 * Antepone los triggers de las aplicaciones LoRA resueltas y quita el
 * preámbulo de triggers que ya viniera en el texto (evita duplicarlo si el
 * compilador lo dejó suelto). `loras` es obligatorio: sin una aplicación
 * resuelta no hay trigger válido que anteponer.
 */
export function ensureLoraTriggers(prompt: string, loras: LoraApplication[]): string {
  if (!loras?.length) {
    throw new Error("LORA_APPLICATION_REQUIRED: ensureLoraTriggers necesita al menos un ResolvedLoraApplication resuelto desde el registro.");
  }
  validarUnaAplicacion(loras);
  const trimmed = prompt.trim();
  const triggers = [...new Set(loras.map((lora) => lora.trigger.trim()).filter(Boolean))];
  const withoutTriggers = trimmed.replace(LEADING_TRIGGER_RUN, "").trim();
  return `${triggers.join(", ")}, ${withoutTriggers}`;
}
