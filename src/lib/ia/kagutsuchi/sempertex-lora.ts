import type { ImageInput, Imagen, PeticionImagen } from "@/lib/ia/nucleo/tipos";
import { idsTelemetria, resultadoTelemetria, type ContextoTelemetriaIA } from "@/lib/ia/nucleo/telemetria-llamadas";
import { bytesDeBase64, registrarLlamadaIA } from "@sempertex/agente-core";
import { LORA_GENERATION_PYTHON_ENABLED } from "@/lib/ia/nucleo/feature-flags";
import { isPythonAdapterError, llamarPythonLoraGenerate } from "@/lib/ia/nucleo/python-adapter";

const TEXT_ENDPOINT = "https://queue.fal.run/fal-ai/flux-2/lora";
const EDIT_ENDPOINT = "https://queue.fal.run/fal-ai/flux-2/lora/edit";
const FAL_QUEUE_HOSTS = new Set(["queue.fal.run", "rest.alpha.fal.ai"]);
const MAX_FAL_IMAGE_BYTES = 16_000_000;
const MAX_EDIT_IMAGES = 4;
/** `promptVersion` de la telemetría cuando el `/edit` lleva la guía de estructura (ADR-0033). */
export const PROMPT_VERSION_GUIA = "guia-estructura.v1";
/**
 * `promptVersion` de la telemetría cuando el `/edit` lleva la guía de escena (`GUIA_ESCENA_V1`). v2: la nota dice
 * que las líneas finas y las formas planas son estructura real (marco de aro, poste, cintas, pesa).
 */
export const PROMPT_VERSION_GUIA_ESCENA = "guia-escena.v2";

export type SempertexLoraOptions = {
  seed?: number;
  /** flux-2 guidance scale from the creativity level (creatividad.ts); defaults to 3.5. */
  guidanceScale?: number;
  /** Lista explícita de adaptadores; vacía selecciona FLUX base sin trigger. */
  loras: LoraApplication[];
  /** Cancels provider I/O when the client disconnects or the route expires. */
  signal?: AbortSignal;
  telemetria?: ContextoTelemetriaIA;
  /**
   * Imágenes que quien llama ya eligió para `/edit`, en su orden: la guía de
   * estructura con su carta (ADR-0033) o las referencias seleccionadas para
   * `/edit`. No se vuelven a filtrar con
   * `referenciasParaLoraEdit`, que las descartaba sin foto del espacio ni
   * resultado previo. Ausente, el comportamiento es el de siempre: se filtran
   * los `inputs`.
   */
  imagenesEdit?: readonly ImagenEditLora[];
};

/**
 * Imágenes que solo recibe el `/edit` del LoRA (ADR-0033): el mapa de color
 * plano de la estructura aprobada y su carta de color. No son `ImageInput`
 * porque nunca pasan por Gemini, por `buildInputs` ni por el prompt de escena.
 */
export type RolGuiaLora = "structure_guide" | "color_chart" | "scene_guide";
export type ImagenGuiaLora = Imagen & {
  id: string;
  role: RolGuiaLora;
  /** Solo la guía de escena: si dibuja algo que no es globo (aro, poste, cintas). Decide qué nota la acompaña. */
  conEstructura?: boolean;
};
export type ImagenEditLora = ImageInput | ImagenGuiaLora;

function esImagenGuia(imagen: ImagenEditLora): imagen is ImagenGuiaLora {
  return imagen.role === "structure_guide" || imagen.role === "color_chart" || imagen.role === "scene_guide";
}

export type LoraApplication = {
  artifactId?: string;
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

/** Tamaño de salida de fal para cada aspecto; la guía de estructura (ADR-0033) usa el mismo encuadre. */
export const imageSizeFor = (aspecto: PeticionImagen["aspecto"]) => {
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
 * Con foto del espacio, `/api/generate` no entrega píxeles al LoRA: este crea
 * la decoración aislada con `TEXT_ENDPOINT` y Gemini la compone después sobre
 * el venue. Un ajuste de una imagen previa usa `/edit` con esa imagen como base.
 *
 * Una foto de referencia NUNCA entra como píxel. `/edit` conserva la imagen que
 * recibe, así que con la referencia como base devolvía la misma foto con otros
 * tonos en vez de una propuesta (2026-09-24; lo había activado ef9b77b). La
 * referencia ya llega resumida en el blueprint, el plan y el caption. Fotos de
 * producto tampoco cambian el endpoint.
 * La excepción es explícita y no pasa por aquí: con `GUIA_ESTRUCTURA_V1`, la
 * ruta manda por `imagenesEdit` el mapa de color plano de la estructura
 * aprobada y su carta (ADR-0033). No es una foto que copiar, y la nota del
 * prompt lo dice.
 */
const ROLES_QUE_ACTIVAN_EDIT = new Set<ImageInput["role"]>(["venue_base", "previous_generated_result"]);

export function referenciasParaLoraEdit(inputs: readonly ImageInput[]): ImageInput[] {
  if (!inputs.some((input) => ROLES_QUE_ACTIVAN_EDIT.has(input.role))) return [];
  const previous = [...inputs]
    .filter((input) => input.role === "previous_generated_result")
    .sort((a, b) => a.priority - b.priority)[0];
  if (previous) {
    const venue = [...inputs]
      .filter((input) => input.role === "venue_base")
      .sort((a, b) => a.priority - b.priority)[0];
    // El resultado previo ya contiene escena y decoración; el venue solo suma
    // contexto arquitectónico y nunca desplaza esa imagen base.
    return venue ? [previous, venue] : [previous];
  }
  const hayVenue = inputs.some((input) => input.role === "venue_base");
  // FLUX.2 /edit puede copiar el fondo de cualquier imagen enviada. Con un
  // venue real, solo la foto del cliente entra como píxel; referencia,
  // productos y sus fondos ya quedaron resumidos en blueprint, plan y caption.
  if (hayVenue) {
    return [...inputs]
      .filter((input) => input.role === "venue_base")
      .sort((a, b) => a.priority - b.priority)
      .slice(0, MAX_EDIT_IMAGES);
  }
  // Sin venue, solo la imagen previa es base: la referencia se copiaría entera.
  return [...inputs]
    .filter((input) => input.role === "previous_generated_result")
    .sort((a, b) => a.priority - b.priority)
    .slice(0, MAX_EDIT_IMAGES);
}

/**
 * Las imágenes que quien llama eligió de antemano (`imagenesEdit`), acotadas
 * al máximo de `/edit`. No hay filtro por rol: la elección ya la hizo quien
 * llama.
 */
export function imagenesEditExplicitas(imagenes: readonly ImagenEditLora[]): ImagenEditLora[] {
  return imagenes.slice(0, MAX_EDIT_IMAGES);
}

/** Como mucho un LoRA por generación; cero es el modelo base (modo `base`). */
function validarAplicaciones(loras: LoraApplication[]): void {
  if (loras.length > 1) throw new Error("LORA_MULTI_UNSUPPORTED: solo se permite un LoRA por generación.");
}

/** Nombre del modelo para la telemetría: sin LoRA es el modelo base, aunque el endpoint de fal sea el mismo. */
export function modeloFluxParaTelemetria(loras: readonly LoraApplication[], conReferencias: boolean): string {
  const familia = loras.length ? "flux-2/lora" : "flux-2/base";
  return conReferencias ? `${familia}/edit` : familia;
}

/**
 * Qué hacer con cada imagen de entrada, en inglés y en frases fijas.
 *
 * Antes la guía se armaba con `IMAGE n (role, id): <descripcion>. USE ONLY:
 * <allowed_use>.` recortado a 180 caracteres: metía los ids internos
 * (`CATALOG_01`, `VENUE_01`), el nombre comercial del producto con su
 * "PAQUETE X N" y texto en español en un prompt que el preflight nunca veía
 * —corre sobre el caption, no sobre lo que se manda a fal—, y el recorte
 * llegaba a invertir la instrucción ("…never package" sin "surplus").
 *
 * Las frases no llevan ids ni descripciones y están dimensionadas para caber
 * sin recorte.
 */
const FRASE_POR_ROL: Readonly<Record<ImageInput["role"], string>> = {
  venue_base: "venue base: preserve architecture, wall, ground, camera, crop and light; decorate only inside it.",
  composition_reference: "composition only: use framing, density and layout; never copy its venue, background, objects or colors.",
  element_reference: "composition only: use framing, density and layout; never copy its venue, background, objects or colors.",
  style_reference: "style only: use mood and lighting; never copy venue, objects or colors.",
  palette_reference: "palette only: use ambient palette; never copy venue, objects or products.",
  catalog_product_reference: "product identity only: use color, finish, material and size; never arrangement, packaging or background.",
  previous_generated_result: "previous result: preserve current scene and venue; apply only requested change.",
};

/**
 * Longitud máxima del prompt que llega a `/edit`. Es el presupuesto del caption
 * más largo (1000 caracteres) más el bloque fijo de
 * INPUT IMAGES con hasta cuatro entradas etiquetadas (menos de 700 caracteres).
 * Superarla significa que algo ajeno se coló en el prompt, no que el diseño sea
 * grande, así que la ruta falla cerrada antes de llamar al proveedor.
 */
export const LORA_EDIT_PROMPT_MAX_LENGTH = 2500;

/**
 * Prompt final que recibe `/edit`: el caption compilado más una guía de frases
 * fijas en inglés, una por imagen de entrada y con su posición explícita. Puro y sin ids,
 * para poder pasarlo por el preflight antes de llamar al proveedor.
 */
export function buildLoraEditPrompt(prompt: string, references: readonly ImagenEditLora[]): string {
  if (!references.length) return prompt;
  if (references.some((imagen) => imagen.role === "scene_guide")) return promptConGuiaEscena(prompt, references);
  if (references.some(esImagenGuia)) return promptConGuia(prompt, references);
  const revision = references.some((image) => image.role === "previous_generated_result");
  const frases = references.filter((image): image is ImageInput => !esImagenGuia(image)).map((image, index) => {
    const frase = revision && image.role === "venue_base"
      ? "venue context only: use architecture, camera, crop and light; preserve the current result's composition and decoration."
      : FRASE_POR_ROL[image.role];
    return `Input image ${index + 1} (@image${index + 1}): ${frase}`;
  });
  const baseIndex = references.findIndex((image) => image.role === "previous_generated_result" || image.role === "venue_base");
  const baseInstruction = baseIndex < 0
    ? "No venue base; create venue from prompt."
    : references[baseIndex]!.role === "previous_generated_result"
      ? `PRIMARY BASE @image${baseIndex + 1}: preserve current scene and venue; apply only requested change.${references.some((image) => image.role === "venue_base") ? " The venue image is context only and never replaces this base." : ""}`
      : `PRIMARY VENUE @image${baseIndex + 1}: preserve this venue; never use another input background.`;
  return `${prompt}\n\nINPUT IMAGES\n${baseInstruction}\n${frases.join("\n")}\nOne cohesive photorealistic scene; no collage, board, cutouts or samples.`;
}

/**
 * Lo que se le dice a `/edit` de la guía de estructura (ADR-0033). Es la nota
 * del modo "plano" de `clasificador-decoraciones` (`enfoques.ts`,
 * `GUIA_POR_MODO.plano`), acortada al registro de los captions (de ~330 a ~240
 * caracteres, sin quitar ninguna de sus tres ideas): `/edit` conserva la imagen
 * que recibe, así que hay que decir que la entrada NO es una foto, que cada
 * mancha es un globo y que se rehace con luz y sombra reales, o devuelve el
 * dibujo retocado.
 */
export const NOTA_GUIA_ESTRUCTURA = "The first input image (@image1) is a flat color map of this balloon structure, not a photo: each disc is one balloon. Rebuild it as a real photograph with exactly that outline, layout and colors, real latex balloons, real light and shadows.";

/**
 * La nota de la carta de color (origen: `NOTA_CARTA`, ~390 caracteres, aquí
 * ~100): es una referencia de color, no un objeto de la escena, y sus franjas
 * no se pintan.
 */
export function notaCartaColor(posicion: number): string {
  return `The last input image (@image${posicion}) is only a color chart: match the balloon colors to it, never draw its stripes.`;
}

/**
 * Caracteres que las notas de la guía ocupan en el prompt del LoRA. La ruta
 * los descuenta del presupuesto del caption (`LORA_PROMPT_MAX_LENGTH`), igual
 * que la instrucción de presentación del híbrido: el compilador compacta el
 * caption con sus pasos de siempre y el prompt entero sigue en el registro del
 * LoRA.
 */
export function reservaNotasGuia(conCarta: boolean): number {
  return NOTA_GUIA_ESTRUCTURA.length + 2 + (conCarta ? notaCartaColor(2).length + 2 : 0);
}

/**
 * `<nota de la guía>\n\n<caption>[\n\n<nota de la carta>]`: la nota va delante
 * porque es la que evita el dibujo retocado. La
 * guía es la primera imagen y solo la sigue su carta; cualquier otra mezcla
 * falla cerrada antes de llegar al proveedor.
 */
function promptConGuia(prompt: string, references: readonly ImagenEditLora[]): string {
  const [guia, ...resto] = references;
  if (guia?.role !== "structure_guide" || resto.length > 1 || resto.some((imagen) => imagen.role !== "color_chart")) {
    throw new Error("LORA_GUIA_INVALIDA: la guía de estructura va primera y solo la acompaña su carta de color.");
  }
  const texto = prompt.trim();
  const carta = resto.length ? `\n\n${notaCartaColor(references.length)}` : "";
  return `${NOTA_GUIA_ESTRUCTURA}\n\n${texto}${carta}`;
}

/**
 * Lo que se le dice a `/edit` de la guía de escena (`GUIA_ESCENA_V1`): la imagen de entrada es el mapa plano de
 * TODA la decoración, con cada pieza dibujada por el motor donde la foto de referencia tiene la suya. Las tres
 * ideas de la nota de la guía de estructura siguen (no es una foto, se sigue su forma y su color, se rehace con
 * globos y luz reales) y se añade lo que ahora importa: la posición y el tamaño relativo de cada pieza, que el
 * borde fino de cada disco solo marca dónde acaba el globo, que las líneas finas y las formas planas que no son
 * discos son estructura real (el marco metálico de un aro y su poste, las cintas y la pesa de un bouquet: los
 * `trazos` y `rellenos` de `plan-guia-escena-result.v1`), y que nada del mapa (su fondo, sus círculos como dibujo,
 * sus bordes, marcas) pase a la foto. En inglés plano y sin ids. Una frase más larga sobre la estructura no cupo:
 * la nota se descuenta del presupuesto del caption y el caso de prueba se quedaba sin guía.
 */
export const NOTA_GUIA_ESCENA = "The first input image (@image1) is a flat layout map of this balloon decoration, not a photo: follow its shapes, positions, relative sizes and colors; thin darker rims only mark where each balloon ends; thin lines and flat shapes are the real metal hoop frame and stand, ribbons or weight. Produce a real photograph of real latex balloons with real light, shadows and depth; never reproduce the flat map, circles drawn as a diagram, outlines, its background color or any marks.";

/**
 * La nota cuando la guía NO dibuja ninguna estructura que no sea globo (ni aro, ni poste, ni cintas). La de
 * siempre nombraba «the real metal hoop frame and stand» en todo plan, hubiera aro o no, y FLUX unía dos piezas
 * separadas con un aro metálico en un solo arco (CASE-005 de images-judge, 2026-10-05; auditoría de propiedades
 * huérfanas, frontera motor → FLUX). Sin estructura dibujada, lo que se dice en su lugar es que las piezas que el
 * mapa dibuja separadas siguen separadas. No es más larga que la de siempre: la reserva del presupuesto no cambia.
 */
export const NOTA_GUIA_ESCENA_SIN_ESTRUCTURA = "The first input image (@image1) is a flat layout map of this balloon decoration, not a photo: follow its shapes, positions, relative sizes and colors; thin darker rims only mark where each balloon ends; pieces drawn apart stay apart, with open space between them and no frame, pole or arch joining them. Produce a real photograph of real latex balloons with real light, shadows and depth; never reproduce the flat map, circles drawn as a diagram, outlines, its background color or any marks.";

/** La nota que corresponde a la guía: con aro, poste o cintas dibujados, la que los nombra; sin ellos, la otra. */
export function notaGuiaEscena(conEstructura: boolean | undefined): string {
  return conEstructura === false ? NOTA_GUIA_ESCENA_SIN_ESTRUCTURA : NOTA_GUIA_ESCENA;
}

/** Caracteres que la nota de la guía de escena ocupa en el prompt: se descuentan del presupuesto del caption. */
export function reservaNotaGuiaEscena(): number {
  return Math.max(NOTA_GUIA_ESCENA.length, NOTA_GUIA_ESCENA_SIN_ESTRUCTURA.length) + 2;
}

/**
 * `[trigger, ]<caption>\n\n<nota de la guía de escena>`. Aquí el caption va PRIMERO y la nota después, al revés
 * que la guía de estructura: con varias piezas, lo que el modelo base lee primero tiene que ser la escena (qué
 * piezas, de qué colores y tamaños, en qué sitio), que es lo que el preflight y la coherencia de color
 * comprueban; la nota solo dice cómo leer el mapa. La guía de escena viaja SOLA: ninguna otra imagen (y nunca la
 * foto de referencia) puede acompañarla, y cualquier otra mezcla falla cerrada antes de llegar al proveedor.
 */
function promptConGuiaEscena(prompt: string, references: readonly ImagenEditLora[]): string {
  if (references.length !== 1 || references[0]!.role !== "scene_guide") {
    throw new Error("LORA_GUIA_INVALIDA: la guía de escena viaja sola, como única imagen de /edit.");
  }
  return `${prompt.trim()}\n\n${notaGuiaEscena(references[0]!.conEstructura)}`;
}

/** Bounded to the range the creativity levels use; anything else keeps the historical 3.5. */
export function guidanceScaleSeguro(valor: number | undefined): number {
  return typeof valor === "number" && Number.isFinite(valor) && valor >= 1.5 && valor <= 5 ? valor : 3.5;
}

/**
 * Maps a Python-path failure back to what the direct path would have thrown.
 * `lora_account_*` is the only domain code that needs to become a real
 * `ProveedorImagenNoDisponibleError` -- `traducir-error-servidor.ts` matches
 * that class by `instanceof`, not by message, so a generic Error here would
 * silently downgrade "cuenta de fal.ai rechazada" to ERROR_INTERNO. Every
 * other domain code becomes a plain Error, same as the direct path's own
 * `new Error("fal.ai ...")` throws -- those already fall through to
 * ERROR_INTERNO today, so reproducing that (rather than inventing a richer
 * classification) is what keeps behavior identical between both paths.
 */
export function errorDeAdaptadorLora(error: unknown): Error {
  if (isPythonAdapterError(error)) {
    if (error.domainCode === "lora_account_saldo_agotado" || error.domainCode === "lora_account_acceso_denegado") {
      const causa = error.domainCode === "lora_account_saldo_agotado" ? "saldo_agotado" : "acceso_denegado";
      const status = error.providerStatus ?? (causa === "saldo_agotado" ? 402 : 403);
      return new ProveedorImagenNoDisponibleError(status, causa, error.providerDetail ?? "");
    }
    return new Error(`fal.ai (Python) rechazó la generación LoRA: ${error.domainCode ?? error.code}`);
  }
  return error instanceof Error ? error : new Error("fal.ai (Python) devolvió un error desconocido.");
}

/**
 * The submit -> poll -> download sequence `generarConSempertexLora` used to
 * make directly against fal.ai's queue, now made by Python
 * (services/ai-api/app/kagutsuchi/lora.py). Every value here already
 * reflects TypeScript's own composition (buildLoraEditPrompt, imageSizeFor,
 * guidanceScaleSeguro) -- this function
 * only shapes that into the Python operation's request and reads back its
 * result; it decides nothing about the prompt or which references apply.
 */
async function generarConSempertexLoraPython(
  prompt: string,
  aspecto: PeticionImagen["aspecto"],
  references: readonly ImagenEditLora[],
  options: SempertexLoraOptions,
  ids: { requestId: string; correlationId: string },
): Promise<{ imagen: Imagen; proveedorRequestId: string | undefined }> {
  const size = imageSizeFor(aspecto);
  try {
    const result = await llamarPythonLoraGenerate({
      mode: references.length ? "edit" : "text",
      prompt: buildLoraEditPrompt(prompt, references),
      loras: lorasFor(options.loras),
      guidanceScale: guidanceScaleSeguro(options.guidanceScale),
      numInferenceSteps: 28,
      imageWidth: size.width,
      imageHeight: size.height,
      ...(Number.isInteger(options.seed) ? { seed: options.seed } : {}),
      imageDataUrls: references.map((image) => `data:${image.mime};base64,${image.base64}`),
      requestId: ids.requestId,
      correlationId: ids.correlationId,
      deadlineMs: 110_000,
      parentSignal: options.signal,
    });
    return {
      imagen: { base64: result.imageBase64, mime: result.mime },
      proveedorRequestId: result.providerRequestId ?? undefined,
    };
  } catch (error) {
    throw errorDeAdaptadorLora(error);
  }
}

export async function generarConSempertexLora(
  prompt: string,
  aspecto: PeticionImagen["aspecto"],
  inputs: ImageInput[] = [],
  options: SempertexLoraOptions,
): Promise<Imagen> {
  if (!Array.isArray(options.loras)) {
    throw new Error("LORA_APPLICATION_REQUIRED: generarConSempertexLora necesita las aplicaciones resueltas desde el registro (vacías solo en modo base); no existe combinación URL/trigger por defecto.");
  }
  validarAplicaciones(options.loras);
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("LoRA Sempertex no está conectado todavía: falta FAL_KEY en .env.local.");

  // Lo que eligió quien llama (guía o referencias de la etapa 1) no se vuelve a
  // filtrar: `referenciasParaLoraEdit` lo descartaba sin venue ni resultado previo.
  const references: readonly ImagenEditLora[] = options.imagenesEdit ? imagenesEditExplicitas(options.imagenesEdit) : referenciasParaLoraEdit(inputs);
  const endpoint = references.length ? EDIT_ENDPOINT : TEXT_ENDPOINT;
  const conGuia = references.some((image) => image.role === "structure_guide");
  const conGuiaEscena = references.some((image) => image.role === "scene_guide");

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
    modelo: modeloFluxParaTelemetria(options.loras, references.length > 0),
    superficie: options.telemetria?.superficie ?? "/api/generate",
    requestId: ids.requestId,
    correlationId: ids.correlationId,
    intento: options.telemetria?.intento ?? 1,
    proveedorRequestId,
    ms: Math.max(0, Date.now() - inicio),
    resultado,
    bytesImagenEntrada: references.reduce((total, image) => total + bytesDeBase64(image.base64), 0),
    unidadesFacturadas: resultado === "ok" ? 1 : undefined,
    // Distingue en la telemetría las llamadas con guía de estructura (ADR-0033); sin ella, el evento de siempre.
    ...(conGuiaEscena ? { promptVersion: PROMPT_VERSION_GUIA_ESCENA } : conGuia ? { promptVersion: PROMPT_VERSION_GUIA } : {}),
  });

  try {
  if (LORA_GENERATION_PYTHON_ENABLED) {
    const { imagen, proveedorRequestId: pythonRequestId } = await generarConSempertexLoraPython(prompt, aspecto, references, options, ids);
    proveedorRequestId = pythonRequestId;
    registrar("ok");
    return imagen;
  }
  const response = await fetchFalAllowed(endpoint, {
    method: "POST",
    headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: buildLoraEditPrompt(prompt, references),
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
