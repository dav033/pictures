import type { ImageInput, Imagen, PeticionImagen } from "./tipos";
import type { LoraSpecialization } from "@/lib/lora/schema";
import { bytesBase64, idsTelemetria, resultadoTelemetria, type ContextoTelemetriaIA } from "./telemetria-llamadas";
import { registrarLlamadaIA } from "@sempertex/agente-core";

const TEXT_ENDPOINT = "https://queue.fal.run/fal-ai/flux-2/lora";
const EDIT_ENDPOINT = "https://queue.fal.run/fal-ai/flux-2/lora/edit";
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
  /**
   * Obligatorio. Debe venir de `resolveLoraMode`/`resolveLoraSelection`
   * (`@/lib/lora/mode-resolver`) — nunca de una URL o trigger escritos a
   * mano. No existe combinación por defecto: sin esto, la llamada falla
   * antes de tocar la red. Ver PLAN-COMPOSICION-RICA-V001.md §1.1 y §9.2.
   */
  loras: LoraApplication[];
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
  request_id?: string;
  response_url?: string;
  status_url?: string;
};
type FalQueueStatus = {
  status?: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "CANCELLED";
  error?: string;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function falResponseError(response: Response, fallback: string): Promise<Error> {
  let detail = "";
  try {
    const body = await response.json() as { detail?: unknown; error?: unknown };
    if (typeof body.error === "string") detail = body.error;
    else if (typeof body.detail === "string") detail = body.detail;
    else if (Array.isArray(body.detail)) detail = body.detail.map((item) => typeof item === "string" ? item : JSON.stringify(item)).join(" ");
  } catch {
    // Un proxy puede devolver HTML en lugar de JSON.
  }
  return new Error(`${fallback} (${response.status})${detail ? `: ${detail.slice(0, 300)}` : ""}`);
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
 * para la fase de condicionamiento por layout del HANDOFF —renderizar las cajas
 * del SceneSpec y pasarlas como referencia—, no para producción: si se
 * enciende, hay que volver a correr el panel de 6 seeds antes de confiar en él.
 */
function prepararReferencias(inputs: ImageInput[]): ImageInput[] {
  if (process.env.SEMPERTEX_LORA_EDIT !== "true") return [];
  return [...inputs]
    .sort((a, b) => a.priority - b.priority)
    .slice(0, MAX_EDIT_IMAGES);
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

export async function generarConSempertexLora(
  prompt: string,
  aspecto: PeticionImagen["aspecto"],
  inputs: ImageInput[] = [],
  options: SempertexLoraOptions,
): Promise<Imagen> {
  if (!options.loras?.length) {
    throw new Error("LORA_APPLICATION_REQUIRED: generarConSempertexLora necesita al menos un ResolvedLoraApplication resuelto desde el registro; no existe combinación URL/trigger por defecto.");
  }
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("LoRA Sempertex no está conectado todavía: falta FAL_KEY en .env.local.");

  const references = prepararReferencias(inputs);
  const endpoint = references.length ? EDIT_ENDPOINT : TEXT_ENDPOINT;

  const inicio = Date.now();
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
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: ensureLoraTriggers(promptConReferencias(prompt, references), options.loras),
      loras: lorasFor(options.loras),
      guidance_scale: 3.5,
      num_inference_steps: 28,
      image_size: imageSizeFor(aspecto),
      ...(Number.isInteger(options.seed) ? { seed: options.seed } : {}),
      ...(references.length ? { image_urls: references.map((image) => `data:${image.mime};base64,${image.base64}`) } : {}),
      num_images: 1,
      enable_prompt_expansion: false,
      enable_safety_checker: true,
      output_format: "png",
    }),
    signal: AbortSignal.timeout(110_000),
  });

  if (!response.ok) throw await falResponseError(response, "fal.ai rechazó la solicitud LoRA");
  const submission = await response.json() as FalQueueSubmission;
  if (!submission.request_id || !submission.status_url || !submission.response_url) {
    throw new Error("fal.ai no devolvió una solicitud LoRA en cola válida.");
  }
  proveedorRequestId = submission.request_id;

  const deadline = Date.now() + 110_000;
  let completed = false;
  while (Date.now() < deadline) {
    const statusResponse = await fetch(submission.status_url, {
      headers: { Authorization: `Key ${key}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!statusResponse.ok) throw await falResponseError(statusResponse, "fal.ai no pudo consultar el estado LoRA");
    const status = await statusResponse.json() as FalQueueStatus;
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

  const resultResponse = await fetch(submission.response_url, {
    headers: { Authorization: `Key ${key}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!resultResponse.ok) throw await falResponseError(resultResponse, "fal.ai no devolvió el resultado LoRA");
  const result = await resultResponse.json() as FalResponse;
  const url = result.images?.[0]?.url;
  if (!url || !/^https?:\/\//.test(url)) throw new Error("fal.ai no devolvió una imagen LoRA válida.");

  const imageResponse = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!imageResponse.ok) throw new Error(`No se pudo descargar la imagen generada por fal.ai (${imageResponse.status}).`);
  const imagen = {
    base64: Buffer.from(await imageResponse.arrayBuffer()).toString("base64"),
    mime: result.images?.[0]?.content_type ?? imageResponse.headers.get("content-type") ?? "image/png",
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
  const trimmed = prompt.trim();
  const triggers = [...new Set(loras.map((lora) => lora.trigger.trim()).filter(Boolean))];
  const withoutTriggers = trimmed.replace(LEADING_TRIGGER_RUN, "").trim();
  return `${triggers.join(", ")}, ${withoutTriggers}`;
}
