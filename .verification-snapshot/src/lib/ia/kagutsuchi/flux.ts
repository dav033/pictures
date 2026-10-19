import type { ImageInput, Imagen, PeticionImagen } from "@/lib/ia/nucleo/tipos";
import { idsTelemetria, resultadoTelemetria, type ContextoTelemetriaIA } from "@/lib/ia/nucleo/telemetria-llamadas";
import { bytesDeBase64, registrarLlamadaIA } from "@sempertex/agente-core";
import { FLUX_GENERATION_PYTHON_ENABLED } from "@/lib/ia/nucleo/feature-flags";
import { isPythonAdapterError, llamarPythonFluxGenerate } from "@/lib/ia/nucleo/python-adapter";
import { auditarGeneracionImagen, type DescripcionImagen } from "@/lib/registro/servidor";
import { falResponseError, fetchFalAllowed, isAllowedFalImageUrl, isAllowedFalQueueUrl, parseFalResponse, parseQueueStatus, parseQueueSubmission, ProveedorImagenNoDisponibleError, readBoundedImage, sleep } from "./fal-cola";

export { ProveedorImagenNoDisponibleError };

const TEXT_ENDPOINT = "https://queue.fal.run/fal-ai/flux-2/lora";
const EDIT_ENDPOINT = "https://queue.fal.run/fal-ai/flux-2/edit";
const EDIT_ENDPOINT_WITH_ADAPTERS = "https://queue.fal.run/fal-ai/flux-2/lora/edit";
const MAX_EDIT_IMAGES = 4;
/** `promptVersion` de la telemetría cuando el `/edit` lleva la guía de estructura (ADR-0033). */
export const PROMPT_VERSION_GUIA = "guia-estructura.v1";
/**
 * `promptVersion` de la telemetría cuando el `/edit` lleva la guía de escena (`GUIA_ESCENA_V1`). v2: la nota dice
 * que las líneas finas y las formas planas son estructura real (marco de aro, poste, cintas, pesa).
 */
export const PROMPT_VERSION_GUIA_ESCENA = "guia-escena.v2";

export type SempertexFluxOptions = {
  seed?: number;
  /** flux-2 guidance scale from the creativity level (creatividad.ts); defaults to 3.5. */
  guidanceScale?: number;
  /** Lista explícita de adaptadores; vacía selecciona FLUX base sin trigger. */
  loras: FluxApplication[];
  /** Cancels provider I/O when the client disconnects or the route expires. */
  signal?: AbortSignal;
  telemetria?: ContextoTelemetriaIA;
  /**
   * Imágenes que quien llama ya eligió para `/edit`, en su orden: la guía de
   * estructura con su carta (ADR-0033) o las referencias seleccionadas para
   * `/edit`. No se vuelven a filtrar con
   * `referenciasParaFluxEdit`, que las descartaba sin foto del espacio ni
   * resultado previo. Ausente, el comportamiento es el de siempre: se filtran
   * los `inputs`.
   */
  imagenesEdit?: readonly ImagenEditFlux[];
};

/**
 * Imágenes que solo recibe el `/edit` del LoRA (ADR-0033): el mapa de color
 * plano de la estructura aprobada y su carta de color. No son `ImageInput`
 * porque nunca pasan por Gemini, por `buildInputs` ni por el prompt de escena.
 */
export type RolGuiaFlux = "structure_guide" | "color_chart" | "scene_guide";
export type ImagenGuiaFlux = Imagen & {
  id: string;
  role: RolGuiaFlux;
  /** Solo la guía de escena: si dibuja algo que no es globo (aro, poste, cintas). Decide qué nota la acompaña. */
  conEstructura?: boolean;
  /** Solo la guía de escena: cuántas piezas de globo dibuja el mapa (las colocadas). La nota dice ese número. */
  piezas?: number;
};
export type ImagenEditFlux = ImageInput | ImagenGuiaFlux;

function esImagenGuia(imagen: ImagenEditFlux): imagen is ImagenGuiaFlux {
  return imagen.role === "structure_guide" || imagen.role === "color_chart" || imagen.role === "scene_guide";
}

export type FluxApplication = {
  artifactId?: string;
  path: string;
  trigger: string;
  scale: number;
};

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

export function referenciasParaFluxEdit(inputs: readonly ImageInput[]): ImageInput[] {
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
export function imagenesEditExplicitas(imagenes: readonly ImagenEditFlux[]): ImagenEditFlux[] {
  return imagenes.slice(0, MAX_EDIT_IMAGES);
}

/** Como mucho un LoRA por generación; cero es el modelo base (modo `base`). */
function validarAplicaciones(loras: FluxApplication[]): void {
  if (loras.length > 1) throw new Error("FLUX_MULTI_UNSUPPORTED: solo se permite un LoRA por generación.");
}

/** Nombre del modelo para la telemetría: sin LoRA es el modelo base, aunque el endpoint de fal sea el mismo. */
export function modeloFluxParaTelemetria(loras: readonly FluxApplication[], conReferencias: boolean): string {
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
  render_3d_base: "3D layout render to convert into a photograph: keep its camera, framing and the position and count of every object.",
};

/**
 * Longitud máxima del prompt que llega a `/edit`. Es el presupuesto del caption
 * más largo (1000 caracteres) más el bloque fijo de
 * INPUT IMAGES con hasta cuatro entradas etiquetadas (menos de 700 caracteres).
 * Superarla significa que algo ajeno se coló en el prompt, no que el diseño sea
 * grande, así que la ruta falla cerrada antes de llamar al proveedor.
 */
export const FLUX_EDIT_PROMPT_MAX_LENGTH = 2500;

/**
 * Prompt final que recibe `/edit`: el caption compilado más una guía de frases
 * fijas en inglés, una por imagen de entrada y con su posición explícita. Puro y sin ids,
 * para poder pasarlo por el preflight antes de llamar al proveedor.
 */
export function buildFluxEditPrompt(prompt: string, references: readonly ImagenEditFlux[]): string {
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
  const baseIndex = references.findIndex((image) => image.role === "previous_generated_result" || image.role === "venue_base" || image.role === "render_3d_base");
  const baseInstruction = baseIndex < 0
    ? "No venue base; create venue from prompt."
    : references[baseIndex]!.role === "render_3d_base"
      ? `PRIMARY BASE @image${baseIndex + 1}: a 3D layout render, not a photo. Make it a real photograph with the exact same camera position, lens and framing and the same position and count of every object; only the materials and light become real.`
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
 * los descuenta del presupuesto del caption (`FLUX_PROMPT_MAX_LENGTH`), igual
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
function promptConGuia(prompt: string, references: readonly ImagenEditFlux[]): string {
  const [guia, ...resto] = references;
  if (guia?.role !== "structure_guide" || resto.length > 1 || resto.some((imagen) => imagen.role !== "color_chart")) {
    throw new Error("FLUX_GUIA_INVALIDA: la guía de estructura va primera y solo la acompaña su carta de color.");
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
 *
 * 2026-10-07 (la guía también para los planes sin foto, «¿O sea FLUX también debería recibir el gráfico?»): la nota
 * pide mantener EXACTAMENTE la forma, la posición, el tamaño y los colores de cada pieza, y dice que el fondo liso y
 * la franja de piso del mapa son solo marcadores: en su lugar va el entorno completo del evento que describe el
 * caption (`entorno-escena.ts`), llenando el encuadre alrededor de los globos. Sin esa frase, `/edit` conserva lo que
 * ve y la escena salía con una pared lisa: la guía no puede dejar la escena pobre.
 */
export const NOTA_GUIA_ESCENA = "The first input image (@image1) is a flat layout map of this balloon decoration, not a photo: keep exactly the shape, position, size and colors of every balloon piece in it; thin darker rims only mark where each balloon ends; thin lines and flat shapes are the real metal hoop frame and stand, ribbons or weight. Turn every disc into a real latex balloon with real light, shadows and depth. The map's plain background and floor strip are only placeholders: replace them with the complete event setting described above, filling the whole frame around the balloons. Never reproduce the flat map, circles drawn as a diagram, outlines, its background color or any marks.";

/**
 * La nota cuando la guía NO dibuja ninguna estructura que no sea globo (ni aro, ni poste, ni cintas). La de
 * siempre nombraba «the real metal hoop frame and stand» en todo plan, hubiera aro o no, y FLUX unía dos piezas
 * separadas con un aro metálico en un solo arco (CASE-005 de images-judge, 2026-10-05; auditoría de propiedades
 * huérfanas, frontera motor → FLUX). Sin estructura dibujada, lo que se dice en su lugar es que las piezas que el
 * mapa dibuja separadas siguen separadas. No es más larga que la de siempre: la reserva del presupuesto no cambia.
 */
export const NOTA_GUIA_ESCENA_SIN_ESTRUCTURA = "The first input image (@image1) is a flat layout map of this balloon decoration, not a photo: keep exactly the shape, position, size and colors of every balloon piece in it; thin darker rims only mark where each balloon ends; pieces drawn apart stay apart, with open space between them and no frame, pole or arch joining them. Turn every disc into a real latex balloon with real light, shadows and depth. The map's plain background and floor strip are only placeholders: replace them with the complete event setting described above, filling the whole frame around the balloons. Never reproduce the flat map, circles drawn as a diagram, outlines, its background color or any marks.";

const NUMEROS_GUIA = ["", "one", "two", "three", "four", "five", "six"] as const;

/**
 * Cuántas piezas muestra el mapa, dicho en positivo (FLUX no obedece negativos). 2026-10-07, guía sin foto, semiarco
 * + 2 columnas de fútbol: FLUX añadió una cuarta pieza (otra columna detrás de la mesa) con el caption diciendo
 * «the only balloons are the three pieces described»; la nota de la guía no decía que el mapa las mostraba TODAS.
 * Solo de 1 a 6 piezas; si no, vacía y la nota va como siempre.
 */
export function fraseConteoGuiaEscena(piezas: number | undefined): string {
  if (!piezas || !Number.isInteger(piezas) || piezas < 1 || piezas >= NUMEROS_GUIA.length) return "";
  return `The map shows every balloon piece in the scene: exactly ${NUMEROS_GUIA[piezas]} piece${piezas === 1 ? "" : "s"}, nothing else made of balloons. `;
}

/**
 * La nota que corresponde a la guía: con aro, poste o cintas dibujados, la que los nombra; sin ellos, la otra. Con
 * `piezas`, justo después de «not a photo» dice que el mapa muestra todas las piezas y cuántas son.
 */
export function notaGuiaEscena(conEstructura: boolean | undefined, piezas?: number): string {
  const nota = conEstructura === false ? NOTA_GUIA_ESCENA_SIN_ESTRUCTURA : NOTA_GUIA_ESCENA;
  const conteo = fraseConteoGuiaEscena(piezas);
  return conteo ? nota.replace("not a photo: keep", `not a photo. ${conteo}Keep`) : nota;
}

/** Lo más largo que la frase de cuántas piezas añade a la nota (de 1 a 6 piezas). */
const RESERVA_CONTEO_GUIA = Math.max(...NUMEROS_GUIA.map((_, piezas) => fraseConteoGuiaEscena(piezas).length));

/** Caracteres que la nota de la guía de escena ocupa en el prompt: se descuentan del presupuesto del caption. */
export function reservaNotaGuiaEscena(): number {
  return Math.max(NOTA_GUIA_ESCENA.length, NOTA_GUIA_ESCENA_SIN_ESTRUCTURA.length) + RESERVA_CONTEO_GUIA + 2;
}

/**
 * `[trigger, ]<caption>\n\n<nota de la guía de escena>`. Aquí el caption va PRIMERO y la nota después, al revés
 * que la guía de estructura: con varias piezas, lo que el modelo base lee primero tiene que ser la escena (qué
 * piezas, de qué colores y tamaños, en qué sitio), que es lo que el preflight y la coherencia de color
 * comprueban; la nota solo dice cómo leer el mapa. La guía de escena viaja SOLA: ninguna otra imagen (y nunca la
 * foto de referencia) puede acompañarla, y cualquier otra mezcla falla cerrada antes de llegar al proveedor.
 */
function promptConGuiaEscena(prompt: string, references: readonly ImagenEditFlux[]): string {
  if (references.length !== 1 || references[0]!.role !== "scene_guide") {
    throw new Error("FLUX_GUIA_INVALIDA: la guía de escena viaja sola, como única imagen de /edit.");
  }
  return `${prompt.trim()}\n\n${notaGuiaEscena(references[0]!.conEstructura, references[0]!.piezas)}`;
}

/** Bounded to the range the creativity levels use; anything else keeps the historical 3.5. */
export function guidanceScaleSeguro(valor: number | undefined): number {
  return typeof valor === "number" && Number.isFinite(valor) && valor >= 1.5 && valor <= 5 ? valor : 3.5;
}

/**
 * Maps a Python-path failure back to what the direct path would have thrown.
 * `flux_account_*` is the only domain code that needs to become a real
 * `ProveedorImagenNoDisponibleError` -- `traducir-error-servidor.ts` matches
 * that class by `instanceof`, not by message, so a generic Error here would
 * silently downgrade "cuenta de fal.ai rechazada" to ERROR_INTERNO. Every
 * other domain code becomes a plain Error, same as the direct path's own
 * `new Error("fal.ai ...")` throws -- those already fall through to
 * ERROR_INTERNO today, so reproducing that (rather than inventing a richer
 * classification) is what keeps behavior identical between both paths.
 */
export function errorDeAdaptadorFlux(error: unknown): Error {
  if (isPythonAdapterError(error)) {
    if (error.domainCode === "flux_account_saldo_agotado" || error.domainCode === "flux_account_acceso_denegado") {
      const causa = error.domainCode === "flux_account_saldo_agotado" ? "saldo_agotado" : "acceso_denegado";
      const status = error.providerStatus ?? (causa === "saldo_agotado" ? 402 : 403);
      return new ProveedorImagenNoDisponibleError(status, causa, error.providerDetail ?? "");
    }
    return new Error(`fal.ai (Python) rechazó la generación LoRA: ${error.domainCode ?? error.code}`);
  }
  return error instanceof Error ? error : new Error("fal.ai (Python) devolvió un error desconocido.");
}

/**
 * The submit -> poll -> download sequence `generarConSempertexFlux` used to
 * make directly against fal.ai's queue, now made by Python
 * (services/ai-api/app/kagutsuchi/flux.py). Every value here already
 * reflects TypeScript's own composition (buildFluxEditPrompt, imageSizeFor,
 * guidanceScaleSeguro) -- this function
 * only shapes that into the Python operation's request and reads back its
 * result; it decides nothing about the prompt or which references apply.
 */
async function generarConSempertexFluxPython(
  prompt: string,
  aspecto: PeticionImagen["aspecto"],
  references: readonly ImagenEditFlux[],
  options: SempertexFluxOptions,
  ids: { requestId: string; correlationId: string },
): Promise<{ imagen: Imagen; proveedorRequestId: string | undefined }> {
  const size = imageSizeFor(aspecto);
  try {
    const result = await llamarPythonFluxGenerate({
      mode: references.length ? "edit" : "text",
      prompt: buildFluxEditPrompt(prompt, references),
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
    throw errorDeAdaptadorFlux(error);
  }
}

/**
 * Genera la imagen con FLUX (fal directo o vía Python) y deja un evento `imagen` en la auditoría de la
 * conversación: prompt final, referencias como hash, parámetros, resultado como hash, ms o error.
 */
export async function generarConSempertexFlux(
  prompt: string,
  aspecto: PeticionImagen["aspecto"],
  inputs: ImageInput[] = [],
  options: SempertexFluxOptions,
): Promise<Imagen> {
  let descripcion: DescripcionImagen;
  try {
    const references = options.imagenesEdit ? imagenesEditExplicitas(options.imagenesEdit) : referenciasParaFluxEdit(inputs);
    const loras = Array.isArray(options.loras) ? options.loras : [];
    descripcion = {
      proveedor: FLUX_GENERATION_PYTHON_ENABLED ? "fal-via-python" : "fal",
      endpoint: references.length ? loras.length ? EDIT_ENDPOINT_WITH_ADAPTERS : EDIT_ENDPOINT : TEXT_ENDPOINT,
      modelo: modeloFluxParaTelemetria(loras, references.length > 0),
      prompt: buildFluxEditPrompt(prompt, references),
      referencias: references.map((image) => ({ base64: image.base64, mime: image.mime, rol: image.role })),
      parametros: {
        aspecto,
        imageSize: imageSizeFor(aspecto),
        guidanceScale: guidanceScaleSeguro(options.guidanceScale),
        numInferenceSteps: 28,
        ...(Number.isInteger(options.seed) ? { seed: options.seed } : {}),
        loras: lorasFor(loras),
        promptOriginal: prompt,
      },
    };
  } catch {
    descripcion = { proveedor: "fal", prompt };
  }
  return auditarGeneracionImagen(descripcion, () => generarConSempertexFluxSinAuditar(prompt, aspecto, inputs, options), (imagen) => ({ base64: imagen.base64, mime: imagen.mime }));
}

async function generarConSempertexFluxSinAuditar(
  prompt: string,
  aspecto: PeticionImagen["aspecto"],
  inputs: ImageInput[],
  options: SempertexFluxOptions,
): Promise<Imagen> {
  if (!Array.isArray(options.loras)) {
    throw new Error("FLUX_APPLICATION_REQUIRED: generarConSempertexFlux necesita las aplicaciones resueltas desde el registro (vacías solo en modo base); no existe combinación URL/trigger por defecto.");
  }
  validarAplicaciones(options.loras);
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("LoRA Sempertex no está conectado todavía: falta FAL_KEY en .env.local.");

  // Lo que eligió quien llama (guía o referencias de la etapa 1) no se vuelve a
  // filtrar: `referenciasParaFluxEdit` lo descartaba sin venue ni resultado previo.
  const references: readonly ImagenEditFlux[] = options.imagenesEdit ? imagenesEditExplicitas(options.imagenesEdit) : referenciasParaFluxEdit(inputs);
  const endpoint = references.length
    ? options.loras.length ? EDIT_ENDPOINT_WITH_ADAPTERS : EDIT_ENDPOINT
    : TEXT_ENDPOINT;
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
  if (FLUX_GENERATION_PYTHON_ENABLED) {
    const { imagen, proveedorRequestId: pythonRequestId } = await generarConSempertexFluxPython(prompt, aspecto, references, options, ids);
    proveedorRequestId = pythonRequestId;
    registrar("ok");
    return imagen;
  }
  const response = await fetchFalAllowed(endpoint, {
    method: "POST",
    headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: buildFluxEditPrompt(prompt, references),
      ...(options.loras.length ? { loras: lorasFor(options.loras) } : {}),
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

function lorasFor(loras: FluxApplication[]): Array<{ path: string; scale: number }> {
  return loras.map((lora) => ({ path: lora.path, scale: lora.scale }));
}

// ----------------------------------------------------------------------------------------------------------
// FLUX.1 [dev] imagen-a-imagen (solo el taller 3D): la captura es la imagen de partida y `strength` dice cuánto
// se aparta. FLUX.2 `/edit` no tiene ese control y reinterpreta la escena (inventaba árboles, mesas y cupcakes).
// ----------------------------------------------------------------------------------------------------------

const FIEL_I2I_ENDPOINT = "https://queue.fal.run/fal-ai/flux/dev/image-to-image";
const FIEL_CONTROL_ENDPOINT = "https://queue.fal.run/fal-ai/flux-general/image-to-image";
/** ControlNet Union de FLUX.1 [dev] (canny, depth… en un solo modelo), el que acepta `flux-general`. */
export const CONTROLNET_UNION_FLUX1 = "InstantX/FLUX.1-dev-Controlnet-Union";
/** Tarifas publicadas en fal (2026-10): US$ por megapíxel, redondeando hacia arriba cada imagen. */
export const PRECIO_MP_FLUX1_I2I = 0.03;
export const PRECIO_MP_FLUX1_CONTROL = 0.075;

export type ControlFluxFiel = { modo: "canny" | "depth"; base64: string; mime: string; escala: number; fin?: number };

export type OpcionesFluxFiel = {
  /** La imagen de partida (la captura del visor); la salida sale de su mismo tamaño. */
  imagen: { base64: string; mime: string; ancho: number; alto: number };
  /** 0 = la captura tal cual, 1 = rehacerla. */
  strength: number;
  seed?: number;
  guidanceScale?: number;
  pasos?: number;
  /** Con controles va por `flux-general` con el ControlNet Union; sin ellos, por `flux/dev/image-to-image`. */
  controles?: readonly ControlFluxFiel[];
  /** Solo con controles (`flux-general`, NAG): de qué alejarse («3d render, cgi…»). */
  negativo?: string;
  signal?: AbortSignal;
  telemetria?: ContextoTelemetriaIA;
};

/** Lo que cuesta una imagen de FLUX.1 de ese tamaño (megapíxeles redondeados hacia arriba). */
export function costeFluxFiel(ancho: number, alto: number, conControl: boolean): number {
  return Math.ceil((ancho * alto) / 1_000_000) * (conControl ? PRECIO_MP_FLUX1_CONTROL : PRECIO_MP_FLUX1_I2I);
}

function cuerpoFluxFiel(prompt: string, o: OpcionesFluxFiel): Record<string, unknown> {
  const base = {
    prompt,
    image_url: `data:${o.imagen.mime};base64,${o.imagen.base64}`,
    strength: Math.min(1, Math.max(0, o.strength)),
    guidance_scale: o.guidanceScale ?? 3.5,
    num_inference_steps: o.pasos ?? 28,
    ...(Number.isInteger(o.seed) ? { seed: o.seed } : {}),
    num_images: 1,
    enable_safety_checker: true,
    output_format: "png",
  };
  if (!o.controles?.length) return base;
  return {
    ...base,
    image_size: { width: o.imagen.ancho, height: o.imagen.alto },
    ...(o.negativo ? { negative_prompt: o.negativo } : {}),
    controlnet_unions: [{
      path: CONTROLNET_UNION_FLUX1,
      controls: o.controles.map((c) => ({ control_image_url: `data:${c.mime};base64,${c.base64}`, control_mode: c.modo, conditioning_scale: c.escala, end_percentage: c.fin ?? 0.8 })),
    }],
  };
}

/**
 * FLUX.1 [dev] imagen-a-imagen en fal (con ControlNet si hay `controles`), con el mismo registro que FLUX.2: evento
 * `imagen` en la auditoría (prompt, referencias como hash, parámetros, coste estimado) y telemetría de la llamada.
 */
export async function generarConFluxFiel(prompt: string, opciones: OpcionesFluxFiel): Promise<Imagen> {
  const conControl = Boolean(opciones.controles?.length);
  const endpoint = conControl ? FIEL_CONTROL_ENDPOINT : FIEL_I2I_ENDPOINT;
  const modelo = conControl ? "flux-1-dev/controlnet-union/i2i" : "flux-1-dev/i2i";
  const coste = costeFluxFiel(opciones.imagen.ancho, opciones.imagen.alto, conControl);
  const descripcion: DescripcionImagen = {
    proveedor: "fal",
    endpoint,
    modelo,
    prompt,
    referencias: [
      { base64: opciones.imagen.base64, mime: opciones.imagen.mime, rol: "captura_3d" },
      ...(opciones.controles ?? []).map((c) => ({ base64: c.base64, mime: c.mime, rol: `control_${c.modo}` })),
    ],
    parametros: {
      strength: opciones.strength, guidanceScale: opciones.guidanceScale ?? 3.5, numInferenceSteps: opciones.pasos ?? 28,
      ancho: opciones.imagen.ancho, alto: opciones.imagen.alto, ...(Number.isInteger(opciones.seed) ? { seed: opciones.seed } : {}),
      controles: (opciones.controles ?? []).map((c) => ({ modo: c.modo, escala: c.escala, fin: c.fin ?? 0.8 })),
      ...(opciones.negativo ? { negativo: opciones.negativo } : {}),
    },
    costeEstimadoUsd: coste,
  };
  return auditarGeneracionImagen(descripcion, () => generarConFluxFielSinAuditar(prompt, opciones, endpoint, modelo, coste), (imagen) => ({ base64: imagen.base64, mime: imagen.mime }));
}

async function generarConFluxFielSinAuditar(prompt: string, opciones: OpcionesFluxFiel, endpoint: string, modelo: string, coste: number): Promise<Imagen> {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("FLUX no está conectado todavía: falta FAL_KEY en .env.local.");
  const inicio = Date.now();
  const deadlineAt = inicio + 105_000;
  const signalFor = (budgetMs: number): AbortSignal => {
    const timeoutSignal = AbortSignal.timeout(Math.max(1, Math.min(budgetMs, deadlineAt - Date.now())));
    return opciones.signal ? AbortSignal.any([opciones.signal, timeoutSignal]) : timeoutSignal;
  };
  let proveedorRequestId: string | undefined;
  const ids = idsTelemetria(opciones.telemetria);
  const registrar = (resultado: "ok" | "error" | "timeout" | "cancelado") => registrarLlamadaIA({
    proveedor: "fal",
    flujo: "generador_imagen",
    capacidad: "imagen_generacion",
    modelo,
    superficie: opciones.telemetria?.superficie ?? "taller-3d",
    requestId: ids.requestId,
    correlationId: ids.correlationId,
    intento: opciones.telemetria?.intento ?? 1,
    proveedorRequestId,
    ms: Math.max(0, Date.now() - inicio),
    resultado,
    bytesImagenEntrada: bytesDeBase64(opciones.imagen.base64) + (opciones.controles ?? []).reduce((t, c) => t + bytesDeBase64(c.base64), 0),
    unidadesFacturadas: resultado === "ok" ? 1 : undefined,
    ...(resultado === "ok" ? { costeEstimado: coste, moneda: "USD" } : {}),
  });
  try {
    const response = await fetchFalAllowed(endpoint, {
      method: "POST",
      headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(cuerpoFluxFiel(prompt, opciones)),
      signal: signalFor(30_000),
    }, isAllowedFalQueueUrl);
    if (!response.ok) throw await falResponseError(response, "fal.ai rechazó la solicitud FLUX.1");
    const submission = parseQueueSubmission(await response.json());
    if (!submission || !isAllowedFalQueueUrl(submission.status_url) || !isAllowedFalQueueUrl(submission.response_url)) throw new Error("fal.ai no devolvió una solicitud FLUX.1 en cola válida.");
    proveedorRequestId = submission.request_id;
    let completed = false;
    while (Date.now() < deadlineAt) {
      const statusResponse = await fetchFalAllowed(submission.status_url, { headers: { Authorization: `Key ${key}` }, signal: signalFor(15_000) }, isAllowedFalQueueUrl);
      if (!statusResponse.ok) throw await falResponseError(statusResponse, "fal.ai no pudo consultar el estado FLUX.1");
      const status = parseQueueStatus(await statusResponse.json());
      if (!status) throw new Error("fal.ai devolvió un estado FLUX.1 inválido.");
      if (status.status === "COMPLETED") { completed = true; break; }
      if (status.status === "FAILED" || status.status === "CANCELLED") throw new Error(`fal.ai no pudo completar FLUX.1${status.error ? `: ${status.error.slice(0, 300)}` : ""}`);
      await sleep(1_500);
    }
    if (!completed) throw new Error("fal.ai tardó demasiado en completar FLUX.1.");
    const resultResponse = await fetchFalAllowed(submission.response_url, { headers: { Authorization: `Key ${key}` }, signal: signalFor(15_000) }, isAllowedFalQueueUrl);
    if (!resultResponse.ok) throw await falResponseError(resultResponse, "fal.ai no devolvió el resultado FLUX.1");
    const result = parseFalResponse(await resultResponse.json());
    const url = result?.images?.[0]?.url;
    if (!result || !url || !isAllowedFalImageUrl(url)) throw new Error("fal.ai no devolvió una imagen FLUX.1 válida.");
    const imageResponse = await fetchFalAllowed(url, { signal: signalFor(15_000) }, isAllowedFalImageUrl);
    if (!imageResponse.ok) throw new Error(`No se pudo descargar la imagen de FLUX.1 (${imageResponse.status}).`);
    const contentType = result.images?.[0]?.content_type ?? imageResponse.headers.get("content-type")?.split(";", 1)[0];
    if (!contentType || !new Set(["image/png", "image/jpeg", "image/webp"]).has(contentType.toLowerCase())) throw new Error("fal.ai devolvió un tipo de imagen no permitido.");
    const imagen = { base64: (await readBoundedImage(imageResponse)).toString("base64"), mime: contentType.toLowerCase() };
    registrar("ok");
    return imagen;
  } catch (error) {
    registrar(resultadoTelemetria(error));
    throw error;
  }
}

