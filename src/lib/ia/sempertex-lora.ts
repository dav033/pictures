import type { ImageInput, Imagen, PeticionImagen } from "./tipos";

const TEXT_ENDPOINT = "https://queue.fal.run/fal-ai/flux-2/lora";
const EDIT_ENDPOINT = "https://queue.fal.run/fal-ai/flux-2/lora/edit";
const DEFAULT_LORA = "https://v3b.fal.media/files/b/0aa65403/J8b2xDhu6DhqE7Zm0D_cB_pytorch_lora_weights.safetensors";
const MAX_EDIT_IMAGES = 4;

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

function loraScale(): number {
  const parsed = Number(process.env.SEMPERTEX_LORA_SCALE ?? "0.8");
  return Number.isFinite(parsed) ? Math.min(1.5, Math.max(0, parsed)) : 0.8;
}

function prepararReferencias(inputs: ImageInput[]): ImageInput[] {
  return [...inputs]
    .sort((a, b) => a.priority - b.priority)
    .slice(0, MAX_EDIT_IMAGES);
}

function promptConReferencias(prompt: string, references: ImageInput[]): string {
  if (!references.length) return prompt;
  const guide = references.map((image, index) =>
    `IMAGE ${index + 1} (${image.role}, ${image.id}): ${image.descripcion.slice(0, 180)}. USE ONLY: ${image.allowed_use.slice(0, 180)}`,
  );
  return `${prompt}\n\nINPUT IMAGE GUIDE\n${guide.join("\n")}\nRebuild one cohesive photorealistic event scene. Never output a collage, product board, isolated cutouts, or separate samples.`;
}

export async function generarConSempertexLora(
  prompt: string,
  aspecto: PeticionImagen["aspecto"],
  inputs: ImageInput[] = [],
): Promise<Imagen> {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("LoRA Sempertex no está conectado todavía: falta FAL_KEY en .env.local.");

  const references = prepararReferencias(inputs);
  const endpoint = references.length ? EDIT_ENDPOINT : TEXT_ENDPOINT;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: `eventdecor_style_v1, ${promptConReferencias(prompt, references)}`,
      loras: [{ path: process.env.SEMPERTEX_LORA_URL ?? DEFAULT_LORA, scale: loraScale() }],
      guidance_scale: 3.5,
      num_inference_steps: 28,
      image_size: imageSizeFor(aspecto),
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
  return {
    base64: Buffer.from(await imageResponse.arrayBuffer()).toString("base64"),
    mime: result.images?.[0]?.content_type ?? imageResponse.headers.get("content-type") ?? "image/png",
  };
}
