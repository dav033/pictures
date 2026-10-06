import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { buildImagePrompt, placementDescription, promptElementName, tieneContratoDeColor, type PromptImageInput } from "@/lib/ia/uzume/build-image-prompt";
import { frasesDeEstructuras } from "@/lib/ia/uzume/mezcla-color-escena";
import { mezclaRealConArmado } from "@/lib/ia/uzume/armado-en-prompt";
import { getGeminiClient } from "@/lib/gemini";
import { BASE_PROMPT_MAX_LENGTH, GROUPING_ONLY_CONTEXT, LORA_CAPTION_COMPILER_VERSION, LORA_JSON_PROMPT_MAX_LENGTH, LORA_PROMPT_MAX_LENGTH, translateLoraColor } from "@/lib/ia/kagutsuchi/lora-caption-compiler";
import { includesJsonPrompt, includesTextPrompt, resolveLoraPromptFormat } from "@/lib/ia/kagutsuchi/lora-prompt-format";
import { parseLoraSeed, resolveLoraSeed } from "@/lib/ia/kagutsuchi/lora-seed";
import { applySceneryVisibility, elementosMaterializados, sceneryFromReference, type SceneryItem } from "@/lib/ia/referencia/reference-structure";
import { nivelCreatividadParaGenerar, perfilCreatividad } from "@/lib/ia/escena/creatividad";
import { aliasesDeProducto, compileProductPrompt, LORA_PRODUCT_RUNTIME_VERSION, sizeConfirmationsFromMaterialLines } from "@/lib/ia/kagutsuchi/lora-product-runtime";
import { PRODUCT_VOCABULARY } from "@/lib/lora/product-vocabulary-data";
import { findLoraPromptLanguageLeaks, findLoraPromptProductLeaks, preflightLoraPrompt } from "@/lib/ia/kagutsuchi/lora-prompt-preflight";
import { bloqueMezclaTamanos, bloqueMezclaPorEstructura } from "@/lib/ia/escena/tamano-fisico";
import { descripcionProductoParaImagen } from "@/lib/ia/uzume/producto-para-imagen";
import { type Cotizacion } from "@/lib/cotizacion/motor";
import { featureEnabled, IMAGE_DEBUG, REFERENCE_ANALYSIS_PYTHON_ENABLED } from "@/lib/ia/nucleo/feature-flags";
import { aspectoDeLaReferencia } from "@/lib/ia/nucleo/aspecto";
import { resolveAspectTransform } from "@/lib/ia/uzume/aspect-transform";
import { analizarVenue, type VenueAnalysis } from "@/lib/ia/amaterasu/analizar-venue";
import { crearChatTurnoPython } from "@/lib/ia/amaterasu/chat-python";
import { targetBoxesFor } from "@/lib/ia/uzume/venue-placement";
import { chatDe, imagenDe, resolverProveedor } from "@/lib/ia/nucleo/registro";
import { buildApprovedSceneSpec, SceneSpecSchema, sceneSpecHash, type SceneSpec } from "@/lib/ia/escena/scene-spec";
import { registrarPlanAudit } from "@/lib/rag/observability/log";
import { buildLoraEditPrompt, DEFAULT_SEMPERTEX_LORA_TRIGGER, ensureLoraTriggers, generarConSempertexLora, loraEditApagado, LORA_EDIT_PROMPT_MAX_LENGTH, referenciasParaLoraEdit, reservaNotasGuia, type ImagenEditLora, type ImagenGuiaLora } from "@/lib/ia/kagutsuchi/sempertex-lora";
import { costeEntradasUsdEstimado, elegirCaptionConGuia, estructuraParaGuia, generacionAdmiteGuia } from "@/lib/ia/kagutsuchi/guia-estructura";
import { prepararGuiaEstructura } from "@/lib/ia/kagutsuchi/rasterizar-guia";
import { generacionAdmiteGuiaEscena, planConReferencia } from "@/lib/ia/kagutsuchi/guia-escena";
import { guiaEscenaParaGeneracion } from "@/lib/ia/kagutsuchi/preparar-guia-escena";
import { bloqueoPorGeneracionSinReferencia, CODIGO_GENERACION_SIN_REFERENCIA, leerPoliticaDePresentacion, nivelAmbienteConPolitica, nivelCreatividadConPolitica } from "@/lib/presentacion/modo-presentacion";
import { LoraModeSlugSchema, LoraSelectionSchema } from "@/lib/lora/schema";
import { resolveLoraMode, resolveLoraModeDatasetAllowlist, resolveLoraSelection, type ResolvedLoraApplication } from "@/lib/lora/mode-resolver";

/**
 * Guardián en el punto de uso: nunca se llama a `generarConSempertexLora` con
 * `loras` sin resolver. Es cinturón y tirantes sobre la resolución de más
 * arriba — si algo cambia esa lógica y deja de garantizar la resolución, esto
 * falla antes de tocar la red en vez de caer en un fallback anónimo. Una
 * lista vacía sí es válida: la resolvió el modo `base` (FLUX.2 sin LoRA).
 */
function requireResolvedLoras(loras: ResolvedLoraApplication[] | undefined): ResolvedLoraApplication[] {
  if (!loras) throw new Error("LORA_MODE_REQUIRED: no se pudo resolver un modo LoRA registrado para esta generación.");
  return loras;
}
import { buildVisualContext, completarEscenaConPlan } from "@/lib/ia/escena/visual-context";
import { candadosDeComposicion, conArmadoGuirnaldaEnCaption, hardLockComposicionGemini, inputsParaComposicionGemini, LORA_PRESENTATION_INSTRUCTION, piezasDeLosArmados, promptPresentacionLora } from "@/lib/ia/uzume/lora-gemini-composition";
import { ambienteDeFiesta, AVISO_ESCENOGRAFIA_NO_COTIZADA, nivelAmbienteDe, requiereAvisoNoCotizado } from "@/lib/ia/uzume/ambiente-fiesta";
import { referenciasParaEtapa1Hibrida } from "@/lib/ia/uzume/referencias-etapa1";
import { ErrorIA, type ImageInput, type Imagen, type ImagenEtiquetada, type PeticionImagen, type ProveedorId } from "@/lib/ia/nucleo/tipos";
import { ReferenceBlueprintV2Schema, unidadesMaterialDeElemento, type ReferenceBlueprintV2 } from "@/lib/ia/referencia/reference-blueprint";
import { resolverProductosParaGeneracion } from "@/lib/rag/generate-products";
import { productosPorIdConFuente } from "@/lib/products";
import { isPythonAdapterError, llamarPythonPlanGuiaEscena, pythonErrorBody } from "@/lib/ia/nucleo/python-adapter";
import {
  classifyNonCommercialProducts,
  NonCommercialSourceRejectedError,
  type CommercialUsageIntent,
  type NonCommercialProductClassification,
} from "@/lib/generacion/provenance";
import type { Brief, Producto } from "@/lib/types";
import { getRagPool } from "@/lib/rag/db";
import { advertenciasPuertaFisica } from "@/lib/plan/mezclas";
import { PlanBackendNoDisponibleError, resolverPlan, type ResolucionPlan } from "@/lib/plan/resolver-backend";
import { PythonPlanMappingError } from "@/lib/plan/python-mapper";
import { AllowlistProductoVarianteError } from "@/lib/plan/allowlist-producto-variante";
import { construirUiErrorV1 } from "@/lib/ia/contracts/ui-error-v1";
import { registrarFalloUi, traducirErrorServidor } from "@/lib/errores-ui/traducir-error-servidor";
import { PlanDecoracionSchema } from "@/lib/plan/tipos";
import { planBlueprint } from "@/lib/plan/blueprint";
import { cajasDeEstructuras } from "@/lib/plan/ubicaciones";
import { verificarCoherenciaPrompt, verificarColoresCaptionLora, type EscenaParaCoherencia } from "@/lib/plan/coherencia";
import { abrirContextoPlan, aprobacionSinHuellaEnPruebas, verificarTokenAprobacion } from "@/lib/plan/aprobacion";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import {
  designQuantityForProduct,
  formatMaterialEstimateLog,
  validateMaterialEstimate,
  type DesignMaterialEstimate,
} from "@/lib/materiales/estimacion";

export const maxDuration = 120;

type Body = {
  productIds?: string[];
  ragVariantIds?: string[];
  productQuantities?: Record<string, number>;
  /** Piezas que el cliente agregó a mano en el chat (no existen en el
   * catálogo real): llegan con sus datos completos, no un id a resolver, así
   * que se suman directo a `productos` sin pasar por `productosPorId`. */
  manualProducts?: Producto[];
  brief?: Brief;
  solicitudUsuario?: string;
  proveedor?: string;
  usarLora?: boolean;
  loraSelection?: unknown;
  loraMode?: unknown;
  fotoEspacio?: Imagen;
  imagenesReferencia?: Imagen[];
  aspecto?: PeticionImagen["aspecto"];
  blueprint?: unknown;
  /**
   * Interruptor del cliente sobre la escenografía de la foto: `[{ element_id,
   * visible }]`. Solo enciende o apaga lo que el servidor ya eligió — un id
   * desconocido no añade nada a la escena, y nada de esto toca la cotización,
   * los materiales ni `plan_hash`.
   */
  escenografia?: unknown;
  sceneSpec?: unknown;
  sceneSpecHash?: string;
  protectedRegions?: Array<{ region_id: string; bbox: { x: number; y: number; width: number; height: number } }>;
  editableRegions?: Array<{ region_id: string; bbox: { x: number; y: number; width: number; height: number } }>;
  previousGeneratedImage?: Imagen;
  /** Id de la interacción anterior de Gemini — solo tiene efecto junto con
   * `previousGeneratedImage` (misma revisión); una generación nueva de cero
   * no debe heredar contexto de una conversación anterior. */
  previousInteractionId?: string;
  revisionInstruction?: string;
  /** Interruptor de ambientación (fase 6.B). `nivelAmbienteDe` valida el valor. */
  ambiente?: unknown;
  instruccion?: string;
  plan?: PlanResuelto;
  planHash?: string;
  /**
   * "texto" | "json" | "ambos": LoRA prompt format; "ambos" makes two provider
   * calls. Omitted = by the selected LoRA trigger (resolveLoraPromptFormat).
   */
  promptFormat?: unknown;
  /**
   * Optional integer 0..2^32-1 (lora-seed.ts), for calibrating with the same
   * seed. LoRA path only: it is passed to fal and the effective seed (a random
   * one fixed up front when omitted) is returned as `seed`. The Gemini image
   * path has no seed control: a valid seed is ignored there and no `seed` is
   * returned; an invalid one is still a 400.
   */
  seed?: unknown;
  /** Creativity 0-5 (creatividad.ts): LoRA styling cues and guidance scale, Gemini art direction and allowed styling. The level signed in an approved plan wins. Invalid or absent = default. */
  creatividad?: unknown;
};

const EscenografiaVisibilidadSchema = z
  .array(z.object({ element_id: z.string().trim().min(1).max(80), visible: z.boolean() }).strict())
  .max(24);

/**
 * Interruptor del cliente sobre la escenografía de su foto. Es dato del
 * navegador, así que solo puede APAGAR o volver a encender un elemento que el
 * servidor ya seleccionó del análisis: nunca añade un objeto a la escena,
 * nunca nombra un producto y nunca llega a la cotización ni a `plan_hash`.
 */
function visibilidadEscenografia(raw: unknown): ReadonlyMap<string, boolean> | undefined {
  if (raw === undefined) return undefined;
  const parsed = EscenografiaVisibilidadSchema.safeParse(raw);
  if (!parsed.success) throw new Error("ESCENOGRAFIA_INVALIDA: la escenografía debe ser una lista de { element_id, visible }.");
  return new Map(parsed.data.map((item) => [item.element_id, item.visible] as const));
}

function hashPrompt(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex");
}

/** Estructura oficial declarada por id de estructura del plan, para nombrar el prompt de imagen con el mismo vocabulario que el catálogo. */
/**
 * La petición del cliente que el chat registró en el plan aprobado, acotada.
 * Viene del navegador (fuera del plan_hash) y solo ambienta la escena.
 */
function solicitudDelPlan(plan: { original_request?: unknown } | undefined): string | undefined {
  const leida = SolicitudDelPlanSchema.safeParse(plan?.original_request);
  return leida.success ? leida.data : undefined;
}
const SolicitudDelPlanSchema = z.string().trim().min(1).max(2000);

function officialStructuresDePlan(plan: Pick<PlanResuelto, "plan"> | undefined): ReadonlyMap<string, string> | undefined {
  if (!plan) return undefined;
  return new Map(plan.plan.estructuras.flatMap((estructura) => estructura.estructura_oficial ? [[estructura.estructura_id, estructura.estructura_oficial] as const] : []));
}

function statusDe(causa: ErrorIA["causa"]): number {
  if (causa === "sin_llave") return 503;
  if (causa === "cuota") return 429;
  if (causa === "filtrado") return 422;
  if (causa === "timeout") return 504;
  return 502;
}

const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_INPUT_IMAGE_BASE64_CHARS = 28_000_000;
const MAX_INPUT_IMAGES_BASE64_CHARS = 60_000_000;
const MAX_CATALOG_IMAGE_BYTES = 8_000_000;
const MAX_GENERATE_PAYLOAD_BYTES = 80_000_000;

function validarImagenEntrada(value: unknown, label: string): asserts value is Imagen {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} no es una imagen válida.`);
  }
  const image = value as Partial<Imagen>;
  if (typeof image.base64 !== "string" || image.base64.length === 0 || image.base64.length > MAX_INPUT_IMAGE_BASE64_CHARS) {
    throw new Error(`${label} supera el tamaño máximo permitido.`);
  }
  if (typeof image.mime !== "string" || !IMAGE_MIME_TYPES.has(image.mime)) {
    throw new Error(`${label} debe ser PNG, JPEG o WebP.`);
  }
  for (const [name, dimension] of [["ancho", image.ancho], ["alto", image.alto]] as const) {
    if (dimension !== undefined && (!Number.isInteger(dimension) || dimension < 128 || dimension > 12_000)) {
      throw new Error(`${label}: ${name} está fuera del rango permitido.`);
    }
  }
}

function validarImagenesEntrada(body: Body): void {
  const candidates: Array<[unknown, string]> = [];
  if (body.fotoEspacio !== undefined) candidates.push([body.fotoEspacio, "fotoEspacio"]);
  if (body.previousGeneratedImage !== undefined) candidates.push([body.previousGeneratedImage, "previousGeneratedImage"]);
  if (body.imagenesReferencia !== undefined) {
    if (!Array.isArray(body.imagenesReferencia)) throw new Error("imagenesReferencia debe ser una lista.");
    body.imagenesReferencia.forEach((image, index) => candidates.push([image, `imagenesReferencia[${index}]`]));
  }

  let total = 0;
  for (const [value, label] of candidates) {
    validarImagenEntrada(value, label);
    total += value.base64.length;
  }
  if (total > MAX_INPUT_IMAGES_BASE64_CHARS) throw new Error("El conjunto de imágenes supera el tamaño máximo permitido.");
}

function mimePrincipal(value: string | null): string | null {
  const mime = value?.split(";", 1)[0]?.trim().toLowerCase() ?? null;
  return mime && IMAGE_MIME_TYPES.has(mime) ? mime : null;
}

function hostImagenPermitido(hostname: string): boolean {
  return hostname === "cdn.shopify.com"
    || hostname.endsWith(".shopify.com")
    || hostname.endsWith(".myshopify.com");
}

function urlImagenPermitida(url: URL): boolean {
  return url.protocol === "https:" && !url.username && !url.password && !url.port && hostImagenPermitido(url.hostname);
}

async function fetchImagenSinRedireccionAbierta(urlInicial: URL): Promise<Response | null> {
  const signal = AbortSignal.timeout(15_000);
  let url = urlInicial;
  for (let salto = 0; salto <= 3; salto += 1) {
    const response = await fetch(url, { redirect: "manual", signal });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location || salto === 3) return null;
    url = new URL(location, url);
    if (!urlImagenPermitida(url)) return null;
  }
  return null;
}

async function leerRespuestaLimitada(response: Response, maxBytes: number): Promise<Buffer | null> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) return null;
  const reader = response.body?.getReader();
  if (!reader) return null;

  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    total += chunk.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(Buffer.from(chunk.value));
  }
  return Buffer.concat(chunks, total);
}

async function cargarFoto(foto: string): Promise<Imagen | null> {
  try {
    if (/^https?:\/\//i.test(foto)) {
      const url = new URL(foto);
      if (!urlImagenPermitida(url)) return null;
      const response = await fetchImagenSinRedireccionAbierta(url);
      if (!response) return null;
      if (!response.ok) return null;
      const mime = mimePrincipal(response.headers.get("content-type"));
      if (!mime) return null;
      const bytes = await leerRespuestaLimitada(response, MAX_CATALOG_IMAGE_BYTES);
      return bytes ? { base64: bytes.toString("base64"), mime } : null;
    }
    const publicRoot = path.resolve(process.cwd(), "public");
    const relativePath = foto.replace(/^[/\\]+/, "").replace(/\\/g, "/");
    const fullPath = path.resolve(publicRoot, relativePath);
    const relative = path.relative(publicRoot, fullPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
    const bytes = await readFile(fullPath);
    if (bytes.byteLength > MAX_CATALOG_IMAGE_BYTES) return null;
    const ext = path.extname(fullPath).toLowerCase();
    const mime = ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : null;
    return mime ? { base64: bytes.toString("base64"), mime } : null;
  } catch {
    return null;
  }
}

/**
 * Fotos de catálogo de los productos, y cuántas no se pudieron cargar. Una foto
 * que falla (host no permitido, HTTP, MIME, tamaño) dejaba la generación sin ella
 * en silencio mientras el prompt pedía comparar cada producto con su foto
 * (auditoría 2026-10-04, G10): ahora se registra y se cuenta como faltante.
 */
async function cargarFotosProducto(productos: Producto[], materialEstimate?: DesignMaterialEstimate): Promise<{ imagenes: Array<ImagenEtiquetada & { productoId: string }>; faltantes: number }> {
  const results = await Promise.all(productos.filter((product) => product.foto).map(async (product, index) => {
    const image = await cargarFoto(product.foto!);
    if (!image) {
      // Sin la URL: el id de variante basta para encontrarla.
      console.warn("[generate] foto de catálogo no cargada", { variant_id: product.id });
      return null;
    }
    // Sin paquetes cotizados ni sufijo de variante: la foto va pegada a esta
    // descripción, así que la capacidad de compra se leía como cantidad visual.
    return { ...image, id: `CATALOG_${String(index + 1).padStart(2, "0")}`, productoId: product.id, descripcion: descripcionProductoParaImagen(product, materialEstimate ? designQuantityForProduct(materialEstimate, product.id) : undefined) };
  }));
  const imagenes = results.filter((item): item is ImagenEtiquetada & { productoId: string } => item !== null);
  return { imagenes, faltantes: results.length - imagenes.length };
}

/**
 * Kit/decoración ya prediseñada (ej. "Kit Guirnalda Fiesta Deluxe", "E-Decor
 * Amor Y Amistad") — tiene su propio look completo, a diferencia de un globo
 * suelto que sí es materia prima para combinar libremente. Verificado en
 * vivo (2026-08-21): mezclar 3 kits distintos en un mismo arco fusionó sus
 * identidades — colores/formas de cada kit dejaron de ser reconocibles.
 */
const TIPOS_KIT_PREDISENADO = new Set(["E-DECORS", "FIESTAS PREDISEÑADAS"]);

function esKitPrediseñado(product: Producto): boolean {
  return Boolean(product.tipoProducto && TIPOS_KIT_PREDISENADO.has(product.tipoProducto.toUpperCase()));
}

/** Resuelve si un elemento del blueprint corresponde a un kit prediseñado,
 * buscando su producto real por `catalog_product_id` o, si es un material
 * compuesto, por la primera línea de `bill_of_materials`. */
function elementoEsKit(element: ReferenceBlueprintV2["elements"][number], productos: Producto[]): boolean {
  const id = element.model_decision?.catalog_product_id ?? element.model_decision?.bill_of_materials?.[0]?.catalog_product_id;
  if (!id) return false;
  const producto = productos.find((p) => p.id === id);
  return producto ? esKitPrediseñado(producto) : false;
}

function addCreativeCatalogRelationships(blueprint: ReferenceBlueprintV2, productos: Producto[]): ReferenceBlueprintV2 {
  const elements = blueprint.elements;
  const active = elements.filter((element) => element.approved && element.include_policy !== "exclude");
  const backdrop = active.find((element) => ["backdrop", "curtain", "drape", "panel"].includes(element.category));
  const lighting = active.find((element) => element.category === "lighting");
  // Un kit prediseñado nunca sirve de ancla de fusión ni se fusiona con otra
  // — verificado en vivo: mezclar kits en un mismo arco borró su identidad.
  const balloonStructure = active.find((element) => element.category === "balloon_structure" && !elementoEsKit(element, productos));
  if (!backdrop && !lighting && !balloonStructure) return blueprint;

  const add = (
    relations: ReferenceBlueprintV2["elements"][number]["relationships"],
    relation: ReferenceBlueprintV2["elements"][number]["relationships"][number],
  ) => relations.some((item) => item.type === relation.type && item.target_element_id === relation.target_element_id)
    ? relations
    : [...relations, relation];

  return ReferenceBlueprintV2Schema.parse({
    ...blueprint,
    elements: elements.map((element) => {
      let relationships = element.relationships;
      const esKit = elementoEsKit(element, productos);
      if (backdrop && balloonStructure && element.element_id === backdrop.element_id) {
        relationships = add(relationships, { type: "behind", target_element_id: balloonStructure.element_id });
      }
      if (lighting && backdrop && element.element_id === lighting.element_id) {
        relationships = add(relationships, { type: "behind", target_element_id: backdrop.element_id });
      }
      if (!esKit && balloonStructure && element.element_id !== balloonStructure.element_id && element.category === "balloon_structure") {
        relationships = add(relationships, { type: "overlaps", target_element_id: balloonStructure.element_id });
      }
      if (!esKit && balloonStructure && element.element_id !== balloonStructure.element_id && ["other", "signage", "floral", "plinth"].includes(element.category)) {
        relationships = add(relationships, { type: "aligned_with", target_element_id: balloonStructure.element_id });
      }
      return { ...element, relationships: relationships.slice(0, 12) };
    }),
  });
}

function applyAutomaticDecisions(blueprint: ReferenceBlueprintV2, validProductIds: Set<string>): ReferenceBlueprintV2 {
  return ReferenceBlueprintV2Schema.parse({
    ...blueprint,
    elements: blueprint.elements.map((element) => {
      const decision = element.model_decision;
      const catalogProductId = decision?.catalog_product_id && validProductIds.has(decision.catalog_product_id) ? decision.catalog_product_id : undefined;
      // Cada línea del bill_of_materials también debe existir en lo que el
      // cliente realmente pidió cotizar — si el navegador no llegó a
      // solicitar alguno de esos ids (ej. una versión vieja del panel de
      // revisión que no los aplanaba), se descarta esa línea en vez de
      // dejarla apuntar a un producto nunca cargado.
      const billOfMaterials = decision?.bill_of_materials?.filter((line) => validProductIds.has(line.catalog_product_id));
      const include = Boolean(decision?.action === "include" && (catalogProductId || billOfMaterials?.length));
      return {
        ...element,
        approved: include,
        include_policy: include ? "include" as const : "exclude" as const,
        source_type: catalogProductId || billOfMaterials?.length ? "catalog_backed" as const : "reference_only" as const,
        model_decision: decision
          ? { ...decision, catalog_product_id: catalogProductId, match_type: catalogProductId ? decision.match_type : "none" as const, bill_of_materials: billOfMaterials?.length ? billOfMaterials : undefined }
          : { action: include ? "include" as const : "omit" as const, match_type: "none" as const, reason: "No automatic model decision supplied; element omitted.", adaptation: "Omitir elemento." },
      };
    }),
    unresolved_decisions: [],
  });
}

function buildInputs(input: {
  portLimit: number;
  blueprint: ReferenceBlueprintV2;
  sceneElements: Array<{ element_id: string; source_image_id?: string; source_type: string; catalog_product_id?: string; catalog_product_ids?: string[] }>;
  references: ImagenEtiquetada[];
  venue?: ImagenEtiquetada;
  previous?: ImagenEtiquetada;
  products: Array<ImagenEtiquetada & { productoId: string }>;
}): { inputs: ImageInput[]; promptInputs: PromptImageInput[]; droppedImageIds: string[]; droppedCatalogProductIds: string[]; droppedReferenceCount: number } {
  // `catalog_product_ids` trae TODOS los materiales de un elemento (ej. rojo
  // + verde + dorado de un árbol de globos) — usar solo `catalog_product_id`
  // aquí dejaría fuera las fotos de los materiales secundarios, y el modelo
  // de imagen nunca vería su color/textura real.
  const requiredProductIds = new Set(input.sceneElements.flatMap((element) => element.catalog_product_ids?.length ? element.catalog_product_ids : [element.catalog_product_id]).filter((id): id is string => Boolean(id)));
  const candidates: ImageInput[] = [];
  if (input.previous) candidates.push({ ...input.previous, role: "previous_generated_result", priority: 0, allowed_use: "Current generated result is the edit base for this revision only." });
  if (input.venue) candidates.push({ ...input.venue, role: "venue_base", priority: 1, allowed_use: "Venue identity: camera, crop, architecture, perspective, and light." });
  // La PRIMERA referencia del cliente (foto real de inspiración, no producto)
  // reserva su propio cupo por encima de las fotos de producto — antes caía
  // siempre al final y desaparecía en cuanto había 3-4 productos cotizados,
  // dejando la composición (encuadre, proporción entre estructuras, densidad,
  // geometría de fondo) sin ninguna entrada visual, solo texto. El resto de
  // referencias adicionales (máx. 3 por request) sigue en el cupo bajo.
  const [primaryReference, ...extraReferences] = input.references;
  if (primaryReference) {
    candidates.push({ ...primaryReference, role: "composition_reference", priority: 2, allowed_use: "Composition reference only: framing, proportion between structures, density, background geometry, and light placement. Never use it as a source of product identity, product color, or any object not already present in AUTOMATIC_SCENE_SPEC." });
  }
  for (const product of input.products) {
    if (!requiredProductIds.has(product.productoId)) continue;
    candidates.push({ ...product, role: "catalog_product_reference", priority: 3, allowed_use: "Product identity only: exact color, shape, material, print, and distinguishing details; re-render physically using the installed design quantity from the estimate, never package surplus." });
  }
  for (const reference of extraReferences) {
    candidates.push({ ...reference, role: "composition_reference", priority: 4, allowed_use: "Composition inspiration only: framing, spatial relationships, density, backdrop geometry, and lighting placement. Do not copy or add any object from this image." });
  }
  const ordered = candidates.sort((a, b) => a.priority - b.priority);
  if (ordered.length > input.portLimit) {
    // Product references are authoritative when present, but the provider
    // limit is also authoritative. Keep the highest-priority inputs and let
    // the scene spec's textual catalog metadata cover any omitted product
    // image instead of rejecting an otherwise valid approved plan.
    ordered.splice(Math.max(0, input.portLimit));
  }
  const used = new Set(ordered.map((item) => item.id));
  const droppedCatalogProductIds = input.products.filter((product) => !used.has(product.id)).map((product) => product.productoId);
  const droppedReferenceCount = input.references.filter((reference) => !used.has(reference.id)).length;
  return {
    inputs: ordered,
    promptInputs: ordered.map((item) => ({ image_id: item.id, role: item.role, allowed_use: item.allowed_use })),
    droppedImageIds: [...input.references.map((reference) => reference.id), ...input.products.map((product) => product.id)].filter((id) => !used.has(id)),
    droppedCatalogProductIds,
    droppedReferenceCount,
  };
}

/**
 * Every /api/generate response carries X-Request-ID (E2E 2026-09-15: a 200 came
 * back without it), the same id as `ui_error.request_id` and the telemetry of the
 * generation, so any outcome can be traced.
 */
export async function POST(request: Request) {
  const generationRequestId = crypto.randomUUID();
  return conRequestId(await generar(request, generationRequestId), generationRequestId);
}

function conRequestId(respuesta: Response, requestId: string): Response {
  try {
    respuesta.headers.set("X-Request-ID", requestId);
    return respuesta;
  } catch {
    // Immutable headers (a proxied response): copy it with the header.
    const headers = new Headers(respuesta.headers);
    headers.set("X-Request-ID", requestId);
    return new Response(respuesta.body, { status: respuesta.status, statusText: respuesta.statusText, headers });
  }
}

async function generar(request: Request, generationRequestId: string): Promise<Response> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_GENERATE_PAYLOAD_BYTES) {
    const mensaje = "El payload de generación es demasiado grande.";
    const uiError = construirUiErrorV1("ADJUNTO_INVALIDO", { mensaje, codigoOrigen: "PAYLOAD_TOO_LARGE", requestId: generationRequestId });
    registrarFalloUi("/api/generate", uiError);
    return Response.json({ error: mensaje, ui_error: uiError }, { status: 413 });
  }
  const correlationHeader = request.headers.get("x-correlation-id");
  const generationCorrelationId = correlationHeader && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(correlationHeader)
    ? correlationHeader
    : generationRequestId;
  const contextoTelemetria = { requestId: generationRequestId, correlationId: generationCorrelationId, superficie: "/api/generate" };
  let proveedor: ProveedorId | undefined;
  try {
    const body = await request.json() as Body;
    validarImagenesEntrada(body);
    const seedParse = parseLoraSeed(body.seed);
    if (!seedParse.ok) {
      const uiError = construirUiErrorV1("SOLICITUD_INVALIDA", { mensaje: seedParse.message, codigoOrigen: "LORA_SEED_INVALID", requestId: generationRequestId });
      registrarFalloUi("/api/generate", uiError);
      return Response.json({ error: seedParse.message, ui_error: uiError }, { status: 400 });
    }
    // Toda imagen sale de una propuesta aprobada (ADR-0023, paso 1). La rama
    // heredada que estimaba y cotizaba en TypeScript a partir de piezas
    // elegidas a mano se retiró: era el único camino de la app que no pasaba
    // por el resolutor, y mantenía viva una segunda implementación de las
    // reglas de conteo.
    if (!body.plan) throw new Error("APROBACION_REQUERIDA: la imagen se genera desde una propuesta aprobada.");
    const planDeclarativo = PlanDecoracionSchema.parse(body.plan.plan);
    const contextoPlan = abrirContextoPlan(body.plan.approval_token);
    if (!contextoPlan) {
      throw new Error("APROBACION_REQUERIDA: el plan debe aprobarse desde la tarjeta antes de generar.");
    }
    // Una propuesta con procedencia "next" ya no se puede re-resolver: ese
    // resolutor desapareció (ADR-0023 paso 5). Los tokens caducan a las 24 h.
    if (contextoPlan.backend !== "python") {
      throw new Error("APROBACION_REQUERIDA: esta propuesta es de una versión anterior; vuelve a pedirla.");
    }
    if (!contextoPlan.catalogSnapshotId) {
      throw new PlanBackendNoDisponibleError("SIN_SNAPSHOT_CATALOGO", "La propuesta aprobada no tiene un snapshot de catálogo disponible; vuelve a pedir la propuesta.");
    }
    // Keep the generation whitelist aligned with /api/plan-editar: a
    // declarative material may carry a variant that is not yet present in the
    // resolved purchases, but it still changes which candidate the resolver
    // is allowed to choose and therefore changes the plan hash.
    const planVariantIds = planDeclarativo
      ? [
          ...body.plan?.compras.map((compra) => compra.variant_id) ?? [],
          ...planDeclarativo.estructuras.flatMap((estructura) =>
            estructura.materiales.map((material) => material.variant_id).filter((id): id is string => Boolean(id)),
          ),
          ...planDeclarativo.estructuras.flatMap((estructura) =>
            (estructura.variant_overrides ?? []).flatMap((override) => [override.objetivo_variant_id, override.variant_id]),
          ),
        ]
      : [];
    const productosBase = (await resolverProductosParaGeneracion({
      productIds: body.productIds,
      ragVariantIds: [...new Set([...(body.ragVariantIds ?? []), ...planVariantIds])],
      ...(contextoPlan?.backend === "python" && contextoPlan.catalogSnapshotId
        ? { catalogSnapshotId: contextoPlan.catalogSnapshotId }
        : {}),
    })).productos;
    const productosManuales = (body.manualProducts ?? []).map((product) => ({
      ...product,
      paquetes: Math.max(1, Math.round(body.productQuantities?.[product.id] ?? product.paquetes ?? 1)),
    }));
    const productos = [
      ...productosBase.map((product) => ({
        ...product,
        paquetes: Math.max(1, Math.round(body.productQuantities?.[product.id] ?? product.paquetes ?? 1)),
      })),
      ...productosManuales,
    ];
    // Frontera de autoridad comercial (plan §2.2/§6, Tarea 00.3): ni el seed
    // SQLite ni las piezas manuales del chat tienen offer_id/snapshot
    // comerciales verificados. Cuando NO hay `planDeclarativo`, `productos`
    // alimenta directo `catalogBlueprint` + `cotizarProductos`, que marca
    // cada línea `disponible: true` como si tuviera oferta real — por eso
    // ese camino cuenta como "commercial_line" y se bloquea en producción.
    // Bajo un plan declarativo, el precio final sale exclusivamente de
    // `cotizarPlan` (Postgres validado) y `productos` solo aporta fotos de
    // referencia, así que ahí basta con etiquetar como referencia.
    const usoComercialProductos: CommercialUsageIntent = planDeclarativo ? "reference" : "commercial_line";
    const fuentesLegacy = productosPorIdConFuente(body.productIds ?? []);
    const idsSeedDemo = fuentesLegacy
      .filter((item) => item.fuente === "seed_demo")
      .map((item) => item.producto.id);
    const idsManuales = productosManuales.map((product) => product.id);
    const productAuthority: NonCommercialProductClassification[] = [
      ...classifyNonCommercialProducts(idsSeedDemo, "seed_demo", usoComercialProductos),
      ...classifyNonCommercialProducts(idsManuales, "manual_product", usoComercialProductos),
    ];
    // Esto se resuelve ANTES de resolver el plan: el resolutor necesita el
    // allowlist para no elegir variantes que el modelo nunca vio, y los ids
    // que llegan del cliente conviene rechazarlos antes de cotizar.
    const parsedLoraMode = body.loraMode === undefined ? null : LoraModeSlugSchema.safeParse(body.loraMode);
    if (body.loraMode !== undefined && !parsedLoraMode?.success) throw new Error("LORA_MODE_INVALID: modo LoRA inválido.");
    // Sin modo ni selección, FLUX va en base (sin LoRA): no hay entrenamiento y es el único modelo en uso
    // (2026-10-06). Antes fallaba con LORA_MODE_REQUIRED.
    const explicitLoraMode = parsedLoraMode?.success
      ? parsedLoraMode.data
      : body.usarLora && body.loraSelection === undefined ? ("base" as const) : null;
    const parsedLoraSelection = body.loraSelection === undefined ? null : LoraSelectionSchema.safeParse(body.loraSelection);
    if (body.loraSelection !== undefined && !parsedLoraSelection?.success) throw new Error("LORA_SELECTION_INVALID: selecciona un artifact producto o estructura válido.");
    if (explicitLoraMode && body.loraSelection !== undefined) throw new Error("LORA_MODE_SELECTION_CONFLICT: usa un modo o una selección manual, no ambos.");
    const explicitLoraSelection = parsedLoraSelection?.success ? parsedLoraSelection.data : null;
    const resolvedLoras = explicitLoraMode
      ? await resolveLoraMode(explicitLoraMode)
      : explicitLoraSelection
        ? await resolveLoraSelection(explicitLoraSelection)
        : undefined;
    // Modo base (FLUX.2 sin LoRA): el caption sale en su propio dialecto, sin
    // trigger y con su propio presupuesto, y el preflight tiene que medirlo así.
    const dialectoPreflight = resolvedLoras && resolvedLoras.length === 0 ? ("base" as const) : undefined;
    // FLUX base no tiene LoRA ni vocabulario de productos (2026-10-06, decisión del dueño): nada se resuelve, se
    // rechaza ni se filtra contra él. Los modos entrenados siguen usando el suyo.
    const vocabularioDelModo = dialectoPreflight === "base" ? [] : PRODUCT_VOCABULARY;
    const loraCatalogAllowlist = explicitLoraMode
      ? await resolveLoraModeDatasetAllowlist(explicitLoraMode)
      : null;
    if (loraCatalogAllowlist) {
      const allowedProductIds = new Set(loraCatalogAllowlist.productIds);
      const allowedVariantIds = new Set(loraCatalogAllowlist.variantIds);
      const requestedIds = [
        ...(body.productIds ?? []),
        ...(body.ragVariantIds ?? []),
        ...(body.manualProducts ?? []).map((product) => product.id),
      ];
      // `productIds` solo puede validar ids de producto (p. ej. piezas manuales
      // del chat); un variant_id tiene que estar en `variantIds` sí o sí, que
      // es la granularidad real de la cobertura (modelo + familia + tamaño).
      const outsidePool = [...new Set(requestedIds)].filter((id) => !allowedProductIds.has(id) && !allowedVariantIds.has(id));
      if (outsidePool.length) throw new Error(`LORA_DATASET_ALLOWLIST_REJECTED: ${outsidePool.join(", ")}`);
    }
    // El plan se re-resuelve con el mismo backend que lo produjo (ADR 0006):
    // resolverlo con el otro podría dar otro hash y estaríamos aprobando un
    // plan distinto del que vio el cliente.
    if (!contextoPlan.catalogSnapshotId) {
      throw new PlanBackendNoDisponibleError("SIN_SNAPSHOT_CATALOGO", "La propuesta aprobada no tiene un snapshot de catálogo disponible; vuelve a pedir la propuesta.");
    }
    const resolucion: ResolucionPlan = await resolverPlan({
      plan: planDeclarativo,
      allowlist: contextoPlan.allowlist,
      catalogSnapshotId: contextoPlan.catalogSnapshotId,
      loraAllowlist: loraCatalogAllowlist,
      requestId: generationRequestId,
      correlationId: generationCorrelationId,
      signal: request.signal,
    });
    const planResuelto = resolucion.resuelto;
    const cotizacionPlan = resolucion.cotizacion;
    // La huella ata la propuesta que el cliente aprobó al plan que el servidor
    // acaba de re-resolver. En desarrollo se puede soltar (ver
    // `aprobacionSinHuellaEnPruebas`): iterar sobre el reparto de color mueve
    // `plan_hash` en cada cambio y obligaría a reaprobar sin aportar nada.
    const sinHuella = aprobacionSinHuellaEnPruebas();
    if (sinHuella) {
      console.warn("[generate] APROBACIÓN SIN HUELLA: solo desarrollo, la propuesta aprobada no se está atando al plan resuelto", {
        request_id: generationRequestId,
        plan_hash_cliente: body.plan.plan_hash,
        plan_hash_servidor: planResuelto.plan_hash,
      });
    }
    if (!sinHuella) {
      if (body.planHash && body.planHash !== planResuelto.plan_hash) throw new Error("Plan hash does not match the validated server plan.");
      if (body.plan.plan_hash !== planResuelto.plan_hash) throw new Error("Plan hash does not match the validated server plan.");
    }
    if (planResuelto.sin_cobertura.length > 0) throw new Error("El plan tiene materiales sin cobertura en la selección validada; no se generó una imagen incoherente.");
    if (planResuelto.comercial.estado === "PRESUPUESTO_EXCEDIDO") {
      throw new Error(`PRESUPUESTO_EXCEDIDO: ${planResuelto.totales.total_cop} COP supera el techo de ${planResuelto.comercial.techo_cop} COP por ${planResuelto.comercial.delta_cop} COP.`);
    }
    const approvalContext = verificarTokenAprobacion(body.plan.approval_token, planResuelto.plan_hash)
      ?? (sinHuella ? { requestId: generationRequestId, expiresAt: 0 } : null);
    if (!approvalContext) throw new Error("APROBACION_REQUERIDA: el plan debe aprobarse desde la tarjeta antes de generar.");
    // presentationMode (apagado por defecto; `modo-presentacion.ts` es el único dueño de la variable).
    // R16: con el modo encendido no se crea una imagen «de cero». Va antes de la auditoría y del proveedor
    // de pago. Apagado, `bloqueoPorGeneracionSinReferencia` devuelve siempre null: nada cambia.
    const politicaPresentacion = leerPoliticaDePresentacion();
    const compradasIds = new Set(planResuelto.compras.map((compra) => compra.variant_id));
    const bloqueoDeCero = bloqueoPorGeneracionSinReferencia(politicaPresentacion, {
      fotoDeReferencia: planConReferencia(planResuelto.plan.estructuras) || (body.imagenesReferencia?.length ?? 0) > 0,
      piezaPrediseniadaDeCatalogo: productos.some((product) => compradasIds.has(product.id) && esKitPrediseñado(product)),
      fotoDelEspacio: Boolean(body.fotoEspacio),
      imagenPrevia: Boolean(body.previousGeneratedImage),
    });
    if (bloqueoDeCero) throw new Error(bloqueoDeCero);
    const auditarImagen =async (status: string, scene: SceneSpec) => {
      await registrarPlanAudit(getRagPool(), {
         requestId: approvalContext.requestId,
        planHash: planResuelto.plan_hash,
        restricciones: planResuelto.plan.restricciones,
        selectedProductIds: planResuelto.compras.map((compra) => compra.variant_id),
        geometry: scene.elements.map((element) => ({ id: element.element_id, bbox: element.target_bbox, quantity: element.quantity })),
        costChosenCop: planResuelto.totales.total_cop,
        ceilingCop: planResuelto.comercial.techo_cop,
        deltaCop: planResuelto.comercial.delta_cop,
         packages: { ahorro_paquetes_cop: planResuelto.totales.ahorro_paquetes_cop, lineas: planResuelto.compras.map((compra) => ({ variant_id: compra.variant_id, paquetes: compra.paquetes, subtotal: compra.subtotal })) },
        instances: scene.elements.map((element) => ({ id: element.element_id, quantity: element.quantity })),
         status,
         sceneSpecHash: resolvedSceneSpecHash,
         flagSnapshot: { planCostOptimizerV2: featureEnabled("PLAN_COST_OPTIMIZER_V2"), planBudgetGateV2: featureEnabled("PLAN_BUDGET_GATE_V2") },
         hechos: {
           motorImagenPrevisto: usarLora ? (usarComposicionLoraGemini ? "fal+gemini" : "fal") : proveedor ?? undefined,
           diagnosticoGeneracion: {
             hashesEntrada: selected.inputs.map((input) => createHash("sha256").update(Buffer.from(input.base64, "base64")).digest("hex").slice(0, 16)),
             semilla: loraSeed ?? null,
             // El resolvedor no devuelve el estado de evaluación junto al artifact;
             // dejar el slot nulo evita atribuir un estado que no vimos.
             slot: null,
             captionHash: usarLora ? hashPrompt(promptLoraParaGenerar).slice(0, 16) : null,
             captionLongitud: usarLora ? promptLoraParaGenerar.length : null,
             preflightOk: usarLora ? loraPreflightParaGenerar.ok : null,
             preflightErrores: usarLora ? loraPreflightParaGenerar.errors : [],
             tallasOmitidas: [...new Set(
               (usarLora ? productPromptCompilation.diagnostics : [])
                 .flatMap((linea) => /size\(s\) ([^ ]+(?:, [^ ]+)*) are not in allowed_codes/.exec(linea)?.[1]?.split(", ") ?? []),
             )],
           },
         },
      });
    };
    await registrarPlanAudit(getRagPool(), {
      requestId: approvalContext.requestId,
      planHash: planResuelto.plan_hash,
      solicitudOriginal: body.solicitudUsuario,
      restricciones: planResuelto.plan.restricciones,
      selectedProductIds: planResuelto.compras.map((compra) => compra.variant_id),
      costChosenCop: planResuelto.totales.total_cop,
      ceilingCop: planResuelto.comercial.techo_cop,
      deltaCop: planResuelto.comercial.delta_cop,
       packages: { ahorro_paquetes_cop: planResuelto.totales.ahorro_paquetes_cop, lineas: planResuelto.compras.map((compra) => ({ variant_id: compra.variant_id, paquetes: compra.paquetes, subtotal: compra.subtotal })) },
      status: "CLIENT_APPROVED",
      flagSnapshot: { planCostOptimizerV2: featureEnabled("PLAN_COST_OPTIMIZER_V2"), planBudgetGateV2: featureEnabled("PLAN_BUDGET_GATE_V2") },
     });
    const materialEstimate = resolucion.materialEstimate;
    const preflight = validateMaterialEstimate(materialEstimate);
    if (!preflight.ok) throw new Error(`La estimación de materiales no es válida: ${preflight.errors.join("; ")}`);
    // La puerta física la decide `physicalWarningsForPlan` por estructura
    // lineal, sobre el plan resuelto de cualquiera de los dos backends.
    const physicalWarnings = advertenciasPuertaFisica(planResuelto.advertencias);
    if (physicalWarnings.length > 0) throw new Error(`La estimación de materiales no es compatible con la escala solicitada: ${physicalWarnings.join("; ")}`);
    if (IMAGE_DEBUG) console.info(formatMaterialEstimateLog(materialEstimate));
    const referenciaAnalizada = body.blueprint === undefined ? undefined : ReferenceBlueprintV2Schema.safeParse(body.blueprint);
    // Sin foto del espacio, el lienzo sigue la forma de la foto de referencia (`aspectoDeLaReferencia`): una
    // columna en una foto vertical no queda sola en un lienzo apaisado que FLUX rellena con ramos inventados.
    const aspecto = body.aspecto
      ?? (body.fotoEspacio ? undefined : aspectoDeLaReferencia(referenciaAnalizada?.success ? referenciaAnalizada.data : undefined))
      ?? "3:2";
    const venue = body.fotoEspacio ? { ...body.fotoEspacio, id: "VENUE_01", descripcion: "Venue base photo. Preserve its camera, crop, architecture, perspective, and ambient lighting." } : undefined;
    const previous = body.previousGeneratedImage ? { ...body.previousGeneratedImage, id: "PREVIOUS_RESULT", descripcion: "Previous generated result. Use as current revision base." } : undefined;
    const references = (body.imagenesReferencia ?? []).map((image, index) => ({ ...image, id: `REF_${String(index + 1).padStart(2, "0")}`, descripcion: "Customer reference photo for composition only." }));
    // Frontera de autoridad (plan de integración de referencias, R1): el plan
    // aprobado es la única fuente de elementos. Un blueprint de referencia
    // adjunto (body.blueprint) usa ids REF_*/CATALOG_* que no existen en las
    // cajas del plan (EST_*), así que no se lee aquí.
    const rawBlueprint = planBlueprint(planResuelto);
    const decidedBlueprint = applyAutomaticDecisions(rawBlueprint, new Set(productos.map((product) => product.id)));
    // `productos` puede incluir variantes fuera de las estructuras resueltas
    // (ragVariantIds heredados del chat) — inyectarlas como elementos sueltos
    // rompería el diseño que el cliente ya aprobó; el plan es la única
    // autoridad de qué se muestra.
    const blueprint = addCreativeCatalogRelationships(decidedBlueprint, productos);
    // FRONTERA PLAN / ESCENOGRAFÍA (2026-09-16). El plan aprobado sigue siendo
    // el único dueño de los ELEMENTOS: el blueprint de referencia que manda el
    // navegador nunca se convierte en un elemento de escena (sus ids REF_* no
    // existen en las cajas del plan, EST_*). Se lee solo para la ESCENOGRAFÍA:
    // lo que el cliente conserva de su propia foto (bancos, flores,
    // mobiliario, cortinas, luces, bases, mesas). Entra en el prompt con su
    // caja y el cliente la enciende o la apaga, pero NUNCA toca cotización,
    // materiales ni `plan_hash` — ni siquiera entra en el `SceneSpec`, así que
    // no cambia `sceneSpecHash` ni la geometría auditada.
    // Es dato del navegador: se valida contra el esquema, se filtra por
    // categoría y por nombre en inglés plano sin letreros, y se limita a
    // `SCENERY_LIMIT` (reference-structure.ts).
    // Un elemento de la foto que una estructura del plan ya materializa lo
    // dibuja el plan: no puede volver a entrar como escenografía y duplicarse.
    const materializedReferenceIds = new Set<string>([
      ...blueprint.elements.map((element) => element.element_id),
      ...planResuelto.plan.estructuras.map((estructura) => estructura.referencia_element_id).filter((id): id is string => Boolean(id)),
    ]);
    // La referencia puede contener un salón completo. Antes, con foto del
    // espacio se descartaba su escenografía entera para no copiar muebles
    // ajenos, y con eso se perdían mesa, plinto, silla y flores: justo los
    // objetos que hacen que el montaje se lea como una fotografía. La
    // protección que importaba nunca fue el venue sino `materializedReferenceIds`,
    // que deja fuera lo que el plan ya construye. La escenografía no toca
    // cotización, materiales ni `plan_hash`, y el cliente la enciende por chip.
    const escenografiaDetectada: SceneryItem[] = referenciaAnalizada?.success
      ? sceneryFromReference(referenciaAnalizada.data, new Set([...materializedReferenceIds, ...elementosMaterializados(referenciaAnalizada.data, planResuelto.plan.estructuras)]))
      : [];
    const escenografia = applySceneryVisibility(escenografiaDetectada, visibilidadEscenografia(body.escenografia));
    const escenografiaVisible = escenografia.filter((item) => item.visible);
    /** Lo que el servidor eligió y qué quedó encendido, para que el cliente vea el mismo estado. */
    const escenografiaRespuesta = escenografia.length
      ? escenografia.map((item) => ({ element_id: item.elementId, source_image_id: item.sourceImageId, name: item.name, category: item.category, bbox: item.bbox, visible: item.visible }))
      : undefined;
    const escenografiaParaEscena = escenografiaVisible.map((item) => ({
      element_id: item.elementId,
      name: item.name,
      category: item.category,
      target_bbox: item.bbox,
      depth_layer: item.depthLayer,
    }));
    const productosConMateriales = productos.map((producto) => {
      const compra = planResuelto.compras.find((item) => item.variant_id === producto.id);
      return compra ? { ...producto, paquetes: compra.paquetes, unidadesPaquete: compra.unidades_paquete } : producto;
    });
    const catalogProducts = Object.fromEntries(
      blueprint.elements
        .filter((element) => element.source_type === "catalog_backed")
        .map((element) => {
          const lineas = element.model_decision?.bill_of_materials?.length
            ? element.model_decision.bill_of_materials
            : element.model_decision?.catalog_product_id
              ? [{ catalog_product_id: element.model_decision.catalog_product_id, role: "material principal", share: 1 }]
              : [];
          const materiales = lineas
            .map((linea) => {
              const producto = productosConMateriales.find((candidate) => candidate.id === linea.catalog_product_id);
               return producto ? { id: producto.id, name: producto.nombre, description: producto.descripcion, category: producto.categoria, colors: producto.colores, unitsPerPackage: producto.unidadesPaquete, packageCount: producto.paquetes, installedUnits: Math.max(0, Math.round((unidadesMaterialDeElemento(element) ?? 0) * linea.share)), share: linea.share, role: linea.role } : undefined;
            })
             .filter((material): material is { id: string; name: string; description: string; category: string; colors: string[]; unitsPerPackage: number | undefined; packageCount: number; installedUnits: number; share: number; role: string } => Boolean(material));
          return [element.element_id, materiales] as const;
        })
         .filter(([, materiales]) => materiales.length > 0),
    );
    // El venue analizado decide la geometría cuando el flag está activo;
    // targetBoxesFor conserva una degradación determinista si no hay análisis.
    const proveedorSeleccionado = resolverProveedor({ override: body.proveedor, cookie: request.headers.get("cookie")?.match(/ia_proveedor=(gemini)/)?.[1] });
    proveedor = proveedorSeleccionado;
    let venueAnalysis: VenueAnalysis | undefined;
    if (venue && featureEnabled("VENUE_AWARE_PLACEMENT_V1")) {
      try {
        // Misma forma que el análisis de referencias (dos pasadas de un solo
        // mensaje con la foto), así que va por el mismo flag de Amaterasu.
        const chatVenue = REFERENCE_ANALYSIS_PYTHON_ENABLED
          ? crearChatTurnoPython({ requestId: generationRequestId, correlationId: generationCorrelationId })
          : await chatDe(proveedorSeleccionado);
        venueAnalysis = (await analizarVenue(chatVenue, venue, contextoTelemetria, request.signal)).analysis;
      } catch (error) {
        if (request.signal.aborted) throw error;
        console.warn("[generate] venue analysis unavailable; using automatic placement fallback", {
          request_id: generationRequestId,
          error: error instanceof Error ? error.message : "unknown error",
        });
      }
    }
    // The venue analysis owns placement when available. If it fails, the pure
    // mapper keeps the existing automatic venue boxes as a soft fallback.
    const cajasDelPlan = planResuelto
      ? Object.fromEntries(Object.entries(cajasDeEstructuras(planResuelto.plan.estructuras)).map(([id, layout]) => [id, layout.bbox]))
      : undefined;
    const targetBoxes = targetBoxesFor(blueprint, cajasDelPlan, Boolean(venue), venueAnalysis);
    const sceneSpec = buildApprovedSceneSpec({
      blueprint,
      aspectRatio: aspecto,
      venueImageId: venue?.id,
      targetBoxes,
      eventPalette: body.brief?.colores,
      catalogProducts,
      materialEstimate,
      protectedRegions: body.protectedRegions,
      editableRegions: body.editableRegions,
      generationMode: previous ? "revise_current_result" : venue ? "edit_venue" : "text_to_image",
      createdBy: previous ? "revision" : "server_default",
      planHash: planResuelto?.plan_hash,
      catalogOnly: true,
      // La puerta `catalogOnly` sigue cerrada para los elementos del plan: la
      // escenografía llega por su propio parámetro, nunca como elemento.
      scenography: escenografiaParaEscena,
    });
    if (body.sceneSpec) {
      const submittedScene = SceneSpecSchema.parse(body.sceneSpec);
      if (sceneSpecHash(submittedScene) !== sceneSpecHash(sceneSpec)) throw new Error("Submitted scene specification does not match the server-approved scene.");
    }
    SceneSpecSchema.parse(sceneSpec);
    if (sceneSpec.elements.length === 0 && productos.length === 0 && !body.revisionInstruction && !body.instruccion) throw new Error("Approve at least one element before generating.");

    const usarLora = body.usarLora === true || Boolean(explicitLoraSelection || explicitLoraMode);
    // Foto real: LoRA diseña aislado y Gemini compone sobre venue. Evita que
    // un modelo LoRA redibuje el espacio al mezclar referencias ambientadas.
    const usarComposicionLoraGemini = usarLora && Boolean(venue);
    // Validar antes de llamar a LoRA evita cobrar una imagen que Gemini no
    // podrá montar sobre la foto del usuario.
    if (usarComposicionLoraGemini && !getGeminiClient()) {
      throw new ErrorIA(
        "sin_llave",
        "gemini",
        "No hay GEMINI_API_KEY configurada para montar la decoración sobre la foto del espacio.",
        false,
      );
    }
    // Ninguna ruta que llame a fal.ai puede usar una combinación URL/trigger
    // anónima (PLAN-COMPOSICION-RICA-V001.md §1.1/§9.2). No existe un modo
    // "por defecto" seguro para adivinar aquí: qué slot está listo depende
    // del registro (hoy, por ejemplo, `unlimited` puede estar `pending` y
    // `training_1` solo `ready` bajo el override local de pruebas), así que
    // adivinar produciría un comportamiento no determinista según el estado
    // de la base de datos. Si el turno necesita LoRA y el cliente no mandó
    // `loraMode` ni `loraSelection`
    // explícitos, se falla cerrado antes de tocar la red.
    if (usarLora && !resolvedLoras) {
      throw new Error("LORA_MODE_REQUIRED: especifica loraMode (\"base\" | \"unlimited\" | \"training_1\" | \"training_2\") o loraSelection antes de generar con FLUX.2. No existe un modo por defecto anónimo.");
    }
    // A venue photo or a previous result go to FLUX.2 /edit with the LoRA
    // (sempertex-lora.ts); reference photos never do, they travel as text. Only
    // the SEMPERTEX_LORA_EDIT=false switch restores the old rejection.
    if (usarLora && !usarComposicionLoraGemini && loraEditApagado() && (venue || previous)) {
      throw new Error("LoRA Sempertex genera desde texto. Para editar fotos, cambia a Gemini.");
    }
    const port = usarLora && !usarComposicionLoraGemini ? null : await imagenDe(proveedorSeleccionado);
    const capabilities = port?.capabilities ?? {
      exactAspectRatios: ["3:2", "1:1", "2:3", "16:9"] as PeticionImagen["aspecto"][],
      totalInputImageLimit: 0,
      objectFidelityInputLimit: 0,
      highFidelityInputSupport: false,
      multiTurnSupport: false,
    };
    const aspectTransform = resolveAspectTransform(aspecto, capabilities);
    const transformedSceneSpec = SceneSpecSchema.parse({ ...sceneSpec, canvas: { ...sceneSpec.canvas, content_rect: aspectTransform.contentRect } });
    const resolvedSceneSpecHash = sceneSpecHash(transformedSceneSpec);
    if (body.sceneSpecHash && body.sceneSpecHash !== resolvedSceneSpecHash) throw new Error("Scene specification hash does not match the validated scene.");
    const { imagenes: productImages, faltantes: fotosCatalogoFaltantes } = await cargarFotosProducto(productosConMateriales, materialEstimate);
    // LoRA Edit recibe hasta cuatro referencias visuales. Mantenemos una lista
    // más amplia aquí para resolver prioridades; el adaptador escoge las cuatro
    // mejores (espacio, productos y después composición).
    const inputLimit = usarLora ? Math.max(16, sceneSpec.elements.length) : capabilities.totalInputImageLimit;
    const selected = buildInputs({ portLimit: inputLimit, blueprint, sceneElements: sceneSpec.elements, references, venue, previous, products: productImages });
    // The level signed into the approved plan wins over the slider at generation time.
    // presentationMode (R23): con el catálogo cerrado el nivel no pasa del techo sin ambientación; apagado, el nivel es el de siempre.
    const creatividad = perfilCreatividad(nivelCreatividadConPolitica(nivelCreatividadParaGenerar(contextoPlan?.creatividad, body.creatividad), politicaPresentacion));
    // The venue and time of day the chat recorded in the approved (signed) plan
    // fill only what the customer left open (a venue photo is the venue); see
    // completarEscenaConPlan.
    // Evento, lugar y momento del día salen de la conversación ENTERA que el
    // chat guardó en el plan (`original_request`), no del último mensaje: tras
    // "sí, apruébalo así" o "cambia el azul por rojo", el último mensaje ya no
    // dice "boda en jardín de noche" (auditoría 2026-10-04, C6). Solo ambienta la
    // escena: no toca compra, precio ni plan_hash. Las estructuras y materiales
    // del plan ya no se repiten aquí en español: tienen sus propias secciones.
    const solicitudParaEscena = solicitudDelPlan(body.plan) ?? body.solicitudUsuario;
    const visualContext = buildVisualContext({
      brief: completarEscenaConPlan({ brief: body.brief, userRequest: solicitudParaEscena, plan: planResuelto?.plan, nivel: creatividad.nivel, fotoEspacio: Boolean(venue) }),
      userRequest: solicitudParaEscena,
    });
    // Un ajuste solo tiene sentido sobre una imagen previa: sin ella, el prompt
    // pedía "aplica solo este delta al resultado existente" en una generación
    // nueva (auditoría 2026-10-04, G11).
    const ajustePedido = body.revisionInstruction ?? body.instruccion;
    const revisionInstruction = previous ? ajustePedido : undefined;
    if (ajustePedido?.trim() && !previous) console.info("[generate] ajuste ignorado: no hay imagen previa", { request_id: contextoTelemetria.requestId });
    // Mezcla de tamaños REAL de lo cotizado (plan de tamaños F4) — se agrega
    // directo de `productosConMateriales` (post-sustitución de
    // resolverVariantesPorDespiece cuando aplicó) en vez de recalcularla del
    // despiece pedido: si un tamaño exacto no existía y se sustituyó por el
    // más cercano, el prompt debe reflejar lo que de verdad se va a cobrar y
    // mostrar, no lo que se pidió originalmente.
     const unidadesPorTamano = new Map<string, { diamPulg: number; forma: string | null; cantidad: number }>();
     for (const linea of materialEstimate.balloons) {
       if (linea.size_inches == null) continue;
       const clave = `${linea.shape ?? "redondo"}:${linea.size_inches}`;
       const existente = unidadesPorTamano.get(clave);
       unidadesPorTamano.set(clave, { diamPulg: linea.size_inches, forma: linea.shape, cantidad: (existente?.cantidad ?? 0) + linea.design_quantity });
     }
    // Ubicación en palabras de cada estructura, con el mismo dueño que el resto
    // del prompt: distingue dos estructuras que se llamen igual sin devolver el
    // `estructura_id` al texto.
    const ubicacionPorEstructura = new Map<string, string>();
    for (const element of transformedSceneSpec.elements) {
      const grupo = element.visual_semantics?.repetition_group ?? element.element_id.split("#")[0]!;
      if (!ubicacionPorEstructura.has(grupo)) ubicacionPorEstructura.set(grupo, placementDescription(element.target_bbox, element.category));
    }
    // Con armado de bouquet, un globo número, metalizado o burbuja se nombra por
    // su tipo en la leyenda de Python, no como "latex balloon" (ADR-0030).
    const armadoPorEstructura = new Map((planResuelto?.armados_bouquet ?? []).map((armado) => [armado.estructura_id, armado] as const));
    const sizeMixBlock = planResuelto
      ? bloqueMezclaPorEstructura(planResuelto.estructuras.map((estructura) => ({
          nombre: estructura.nombre,
          total_unidades: estructura.total_unidades,
          repeticiones: estructura.repeticiones,
          ubicacion_en_palabras: ubicacionPorEstructura.get(estructura.estructura_id),
          mezcla_real: mezclaRealConArmado(estructura.mezcla_real, armadoPorEstructura.get(estructura.estructura_id)),
        }))) ?? undefined
      : bloqueMezclaTamanos([...unidadesPorTamano.values()]) ?? undefined;
    // Mapa de estructuras oficiales declaradas en el plan, para nombrar el prompt de imagen con el mismo vocabulario que el catálogo.
    const officialStructures = officialStructuresDePlan(planResuelto);
    // Patrón de color y armados de bouquet y de guirnalda por estructura tal
    // como los firmó Python en el plan re-resuelto (ADR-0028 §12, ADR-0030,
    // ADR-0032): los constructores solo insertan sus frases.
    const colorPatterns = frasesDeEstructuras(planResuelto);
    // Lo que la escena aprobada dice de cada estructura, para la comprobación
    // estructural de color de `verificarCoherenciaPrompt`. Con las mismas
    // frases que el constructor: una pieza con armado lleva línea de color.
    const escenaParaCoherencia: EscenaParaCoherencia = {
      elementos: transformedSceneSpec.elements.map((element) => ({
        element_id: element.element_id,
        nombre_en_prompt: promptElementName(element.name),
        estructura_id: element.visual_semantics?.repetition_group ?? element.element_id.split("#")[0]!,
        resolved_colors: element.resolved_colors,
        espera_linea_de_color: tieneContratoDeColor(element, colorPatterns, transformedSceneSpec),
      })),
    };
    // El tono de cada producto comprado («Fashion Azul Rey»): los colores exactos del prompt salen de él y
    // no de la primera referencia del color grueso («azul» → 040, un cian; UI-2d).
    const titulosProducto = new Map<string, string>(
      (planResuelto?.estructuras ?? []).flatMap((estructura) => estructura.lineas.map((linea) => [linea.product_id, linea.titulo] as const)),
    );
    const promptBase = { titulosProducto, sceneSpec: transformedSceneSpec, inputs: selected.promptInputs, revisionInstruction, visualContext, sizeMixBlock, droppedCatalogReferenceCount: selected.droppedCatalogProductIds.length + fotosCatalogoFaltantes, droppedCompositionReferenceCount: selected.droppedReferenceCount, creatividad: creatividad.nivel, officialStructures, scenography: escenografiaParaEscena, colorPatterns, catalogoCerrado: politicaPresentacion.catalogoCerrado };
    const providerPrompt = buildImagePrompt(promptBase);
    if (planResuelto) {
      const coherencia = verificarCoherenciaPrompt(providerPrompt, planResuelto, escenaParaCoherencia);
      if (!coherencia.ok) throw new Error(`El prompt no coincide con el plan resuelto: ${coherencia.errores.join("; ")}`);
    }
    // The quote is finalized before the paid provider call. The image receives
    // the same estimate snapshot, but never gets package capacity as visual
    // quantity.
    const cotizacion: Cotizacion = cotizacionPlan;
    // La identidad del producto se resuelve desde el vocabulario allowlisted
    // de v007. El compilador solo recibe etiquetas ya resueltas; nunca infiere
    // una etiqueta canónica desde color, SKU o nombre libre.
    const sizeConfirmations = sizeConfirmationsFromMaterialLines(materialEstimate.balloons, productosConMateriales);
    const productIdAliases = new Map<string, string[]>();
    const productCatalogTitles = new Map<string, string>();
    for (const product of productosConMateriales) {
      const aliases = aliasesDeProducto(product);
      if (aliases.length) {
        productIdAliases.set(product.id, aliases);
      }
      const catalogTitle = product.catalogProductTitle?.trim();
      if (catalogTitle) {
        productCatalogTitles.set(product.id, catalogTitle);
        if (product.familiaId) productCatalogTitles.set(product.familiaId, catalogTitle);
      }
    }
    // La guía de estructura (ADR-0033) solo viaja con el caption de texto, y el
    // formato se decide ANTES de prepararla, así que hay que saber aquí si va a
    // haber guía. Sin esto el único LoRA aprobado nunca la recibe: su trigger es
    // el único cuyo formato por defecto es JSON (ver `resolveLoraPromptFormat`).
    // La guía de escena (GUIA_ESCENA_V1) cuenta igual: con un plan que salió de una foto de referencia, FLUX
    // recibe por `/edit` el mapa plano de toda la decoración en vez de la foto, y también viaja solo con texto.
    const guiaEscenaPosible = Boolean(
      featureEnabled("GUIA_ESCENA_V1")
        && usarLora
        && !usarComposicionLoraGemini
        && !venue
        && !previous
        && !loraEditApagado()
        && planResuelto
        && planConReferencia(planResuelto.plan.estructuras),
    );
    const guiaPosible = guiaEscenaPosible || Boolean(
      featureEnabled("GUIA_ESTRUCTURA_V1")
        && usarLora
        && !usarComposicionLoraGemini
        && !venue
        && !previous
        && !loraEditApagado()
        && planResuelto
        && estructuraParaGuia(planResuelto),
    );
    const promptFormat = resolveLoraPromptFormat(body.promptFormat, usarLora ? resolvedLoras?.[0]?.trigger : undefined, guiaPosible);
    // Mismo dueño que el prompt de Gemini: la escenografía que el cliente dejó
    // encendida. El caption LoRA solo admite tres nombres de styling.
    // En el pipeline híbrido LoRA no debe heredar objetos de una referencia:
    // Gemini conserva el contexto real del venue en su segunda etapa.
    // Fase 6.B. Dos fuentes legítimas y ninguna más: la escenografía que estaba
    // en la foto del propio cliente, y este interruptor explícito. El
    // vocabulario del interruptor es cerrado (`ambiente-fiesta.ts`): un modelo
    // puede elegir de la lista, nunca ampliarla.
    const ambiente = featureEnabled("AMBIENTE_FIESTA_V1") ? ambienteDeFiesta(nivelAmbienteConPolitica(nivelAmbienteDe(body.ambiente), politicaPresentacion)) : ambienteDeFiesta("ninguno");
    const ambientDecor = usarComposicionLoraGemini ? [] : escenografiaVisible.map((item) => item.name).slice(0, 3);
    // Fase 3.3, con una corrección sobre lo que el plan pedía. El plan decía
    // "deja de vaciar el contexto visual", pero de sus tres campos dos SON el
    // venue: `venueKind` ("garden", "hall") y `lightingKind` describen el sitio
    // del cliente, y en modo híbrido la etapa 1 es una llamada solo-texto que no
    // debe dibujar el sitio — de eso se encarga Gemini después. Pasárselos sería
    // el filtrado que `GROUPING_ONLY_CONTEXT` existe para evitar.
    //
    // `palette` no es el venue: sale de `brief.colores`, son los colores que el
    // cliente pidió, y el compilador solo la usa cuando las cláusulas no traen
    // color propio. Vaciarla era daño colateral, y es lo que se devuelve.
    const visualContextLora = usarComposicionLoraGemini ? { ...GROUPING_ONLY_CONTEXT, palette: visualContext.palette } : visualContext;
    const compilarCaptionCon = (maxLength: number | undefined, frases: typeof colorPatterns) => compileProductPrompt({
      sceneSpec: transformedSceneSpec,
      visualContext: visualContextLora,
      vocabulary: vocabularioDelModo,
      sizeConfirmations,
      productIdAliases,
      productCatalogTitles,
      trigger: usarLora ? resolvedLoras?.[0]?.trigger : undefined,
      maxLength,
      ambientDecor,
      creativeCues: creatividad.pistasPrompt,
      officialStructures: officialStructures ?? new Map<string, string>(),
      colorPatterns: frases,
    });
    const compilarCaption = (maxLength: number | undefined) => compilarCaptionCon(maxLength, colorPatterns);
    // Guía de escena (GUIA_ESCENA_V1, encendida): el plan salió de una foto de referencia, así que FLUX recibe
    // por `/edit` UNA imagen con los globos de todas las piezas, dibujados por el motor en Python y colocados
    // donde la foto tiene cada una. La foto del cliente nunca sale hacia fal. Si la guía no se puede construir
    // o su nota no cabe, se genera sin ella y la respuesta lo dice (`guiaEscena.usada: false`, `motivo`).
    // Con foto de referencia sustituye a la guía de estructura, que queda para los planes sin foto.
    const admiteGuiaEscena = Boolean(planResuelto && resolvedLoras && generacionAdmiteGuiaEscena({
      bandera: featureEnabled("GUIA_ESCENA_V1"),
      usarLora,
      hibrido: usarComposicionLoraGemini,
      fotoEspacio: Boolean(venue),
      resultadoPrevio: Boolean(previous),
      editApagado: loraEditApagado(),
      formatoTexto: promptFormat === "texto",
      conReferencia: planConReferencia(planResuelto.plan.estructuras),
    }));
    const guiaEscena = planResuelto && resolvedLoras
      ? await guiaEscenaParaGeneracion<ReturnType<typeof compilarCaption>>({
          admite: admiteGuiaEscena,
          plan: planResuelto,
          foto: referenciaAnalizada?.success ? referenciaAnalizada.data : undefined,
          aspecto,
          pedirDiscos: async (plan, mezclas) => (await llamarPythonPlanGuiaEscena({
            plan,
            mezclas,
            requestId: generationRequestId,
            correlationId: generationCorrelationId,
            parentSignal: request.signal,
          })).resultado,
          maximo: dialectoPreflight === "base" ? BASE_PROMPT_MAX_LENGTH : LORA_PROMPT_MAX_LENGTH,
          compilar: compilarCaption,
          // Con guía, la forma y los colores de cada pieza los dibuja el mapa: las frases de Python de forma y
          // de patrón son lo prescindible si no caben con su nota (2026-10-04: dos piezas del motor orgánico
          // dejaban el prompt base en 1195 de 1000 y la guía se caía). Los armados de bouquet y de guirnalda se
          // quedan: el caption cuenta piezas y elige candados con ellos.
          compilarSinFrases: (maxLength) => compilarCaptionCon(maxLength, colorPatterns?.filter((frase) => frase.armado || frase.guirnalda)),
          largo: (compilacion) => compilacion.prompt.length,
          cabe: (compilacion, imagenes) => preflightLoraPrompt({
            dialect: dialectoPreflight,
            sceneSpec: transformedSceneSpec,
            clauses: compilacion.clauses,
            prompt: ensureLoraTriggers(buildLoraEditPrompt(ensureLoraTriggers(compilacion.prompt, resolvedLoras), imagenes), resolvedLoras),
            triggers: resolvedLoras.map((lora) => lora.trigger),
            vocabulary: vocabularioDelModo,
          }).ok,
          signal: request.signal,
        })
      : {};
    if (guiaEscena.resumen) {
      // Solo el hash y metadatos: ni la guía ni la foto van a registros. El coste es ESTIMADO.
      console.info("[generate] guía de escena", { requestId: generationRequestId, ...guiaEscena.resumen });
    }
    // ADR-0033, detrás de GUIA_ESTRUCTURA_V1 (apagada): sin foto del espacio y
    // con una sola estructura con armado o patrón, el LoRA recibe por `/edit` el
    // mapa de color plano de esa estructura y su carta. Las notas de la guía
    // cuentan contra el presupuesto del caption; si no caben ni sin la carta,
    // la generación sigue sin guía y se registra.
    const guiaEstructura = !admiteGuiaEscena && planResuelto && resolvedLoras && generacionAdmiteGuia({
      bandera: featureEnabled("GUIA_ESTRUCTURA_V1"),
      usarLora,
      hibrido: usarComposicionLoraGemini,
      fotoEspacio: Boolean(venue),
      resultadoPrevio: Boolean(previous),
      editApagado: loraEditApagado(),
      formatoTexto: promptFormat === "texto",
    })
      ? await prepararGuiaEstructura(planResuelto, aspecto)
      : null;
    const captionConGuia = guiaEstructura && resolvedLoras
      ? elegirCaptionConGuia<ReturnType<typeof compilarCaption>, ImagenGuiaLora>({
          imagenes: guiaEstructura.imagenes,
          maximo: LORA_PROMPT_MAX_LENGTH,
          reserva: reservaNotasGuia,
          compilar: compilarCaption,
          largo: (compilacion) => compilacion.prompt.length,
          cabe: (compilacion, imagenes) => preflightLoraPrompt({
            dialect: dialectoPreflight,
            sceneSpec: transformedSceneSpec,
            clauses: compilacion.clauses,
            prompt: ensureLoraTriggers(buildLoraEditPrompt(ensureLoraTriggers(compilacion.prompt, resolvedLoras), imagenes), resolvedLoras),
            triggers: resolvedLoras.map((lora) => lora.trigger),
            vocabulary: vocabularioDelModo,
          }).ok,
        })
      : null;
    const imagenesGuia: readonly ImagenGuiaLora[] | undefined = guiaEscena.imagenes ?? captionConGuia?.imagenes;
    if (guiaEstructura) {
      const entradasExtra = imagenesGuia?.length ?? 0;
      // Solo el hash y metadatos: la guía no va a registros. El coste es ESTIMADO (US$ 0,021 por MP de entrada).
      console.info("[generate] guía de estructura", {
        requestId: generationRequestId,
        estructura_id: guiaEstructura.estructuraId,
        usada: Boolean(imagenesGuia),
        carta: entradasExtra > 1,
        guia_sha256: guiaEstructura.sha256,
        bytes: guiaEstructura.bytes,
        entradas_extra: entradasExtra,
        coste_entradas_extra_usd_estimado: costeEntradasUsdEstimado(entradasExtra),
        ...(imagenesGuia ? {} : { motivo: "las notas de la guía no caben en el presupuesto del caption" }),
      });
    }
    const productPromptCompilation = guiaEscena.compilacion ?? captionConGuia?.compilacion ?? compilarCaption(usarComposicionLoraGemini ? LORA_PROMPT_MAX_LENGTH - LORA_PRESENTATION_INSTRUCTION.length : undefined);
    const loraCompilation = {
      prompt: productPromptCompilation.prompt,
      clauses: productPromptCompilation.clauses,
      compilerVersion: productPromptCompilation.captionCompilerVersion,
    };
    const catalogBackedElementCount = transformedSceneSpec.elements.filter((element) => element.source_type === "catalog_backed").length;
    if (usarLora && dialectoPreflight !== "base" && (productPromptCompilation.unresolved_products.length || (catalogBackedElementCount > 0 && productPromptCompilation.legacy))) {
      const unresolved = productPromptCompilation.unresolved_products.map((product) => product.product_id ?? product.title ?? "unknown");
      throw new Error(`LORA_PRODUCT_VOCABULARY_FAILED: no se pudo resolver identidad canónica para ${unresolved.join(", ") || "uno o más productos visibles"}.`);
    }
    const loraPrompt = loraCompilation.prompt;
    // Fuera de usarLora no hay LoRA resuelto (ni falta
    // que haga: es una generación Gemini pura). effectiveLoraPrompt/loraPreflight
    // solo se usan más abajo cuando alguno de esos tres es cierto, y en ese
    // caso resolvedLoras ya quedó garantizado arriba. En modo `base` es `[]`:
    // ningún trigger que anteponer ni que exigir en el preflight.
    const effectiveLoraPrompt = resolvedLoras ? ensureLoraTriggers(loraPrompt, resolvedLoras) : loraPrompt;
    const triggersPreflight = resolvedLoras ? resolvedLoras.map((lora) => lora.trigger) : [DEFAULT_SEMPERTEX_LORA_TRIGGER];
    const loraPreflight = preflightLoraPrompt({
            dialect: dialectoPreflight,
      sceneSpec: transformedSceneSpec,
      clauses: loraCompilation.clauses,
      prompt: effectiveLoraPrompt,
      triggers: triggersPreflight,
      vocabulary: vocabularioDelModo,
    });
    const effectiveJsonPrompt = usarLora && !usarComposicionLoraGemini && includesJsonPrompt(promptFormat) && resolvedLoras
      ? ensureLoraTriggers(productPromptCompilation.jsonPrompt, resolvedLoras)
      : undefined;
    const jsonPreflight = effectiveJsonPrompt
      ? preflightLoraPrompt({
            dialect: dialectoPreflight,
          sceneSpec: transformedSceneSpec,
          clauses: loraCompilation.clauses,
          prompt: effectiveJsonPrompt,
          triggers: triggersPreflight,
          vocabulary: vocabularioDelModo,
          maxLength: LORA_JSON_PROMPT_MAX_LENGTH,
        })
      : undefined;
    const promptPrincipal = usarLora ? (promptFormat === "json" && effectiveJsonPrompt ? effectiveJsonPrompt : effectiveLoraPrompt) : providerPrompt;
    const promptLoraParaGenerar = usarComposicionLoraGemini
      ? promptPresentacionLora(effectiveLoraPrompt)
      : promptPrincipal;
    const loraPreflightParaGenerar = usarComposicionLoraGemini
      ? preflightLoraPrompt({
            dialect: dialectoPreflight,
          sceneSpec: transformedSceneSpec,
          clauses: loraCompilation.clauses,
          prompt: promptLoraParaGenerar,
          triggers: triggersPreflight,
          vocabulary: vocabularioDelModo,
        })
      : imagenesGuia && resolvedLoras
        // Con guía, el preflight (y su límite de largo) mira el prompt con las notas: el que recibe fal.
        ? preflightLoraPrompt({
            dialect: dialectoPreflight,
            sceneSpec: transformedSceneSpec,
            clauses: loraCompilation.clauses,
            prompt: ensureLoraTriggers(buildLoraEditPrompt(promptLoraParaGenerar, imagenesGuia), resolvedLoras),
            triggers: resolvedLoras.map((lora) => lora.trigger),
            vocabulary: vocabularioDelModo,
          })
        : loraPreflight;
    const loraLanguageLeaks = findLoraPromptLanguageLeaks(effectiveJsonPrompt ? `${loraPrompt} ${effectiveJsonPrompt}` : loraPrompt);
    if (usarLora && loraLanguageLeaks.length) {
      throw new Error(`FLUX_LANGUAGE_FAILED: el prompt contiene texto español sin traducir (${loraLanguageLeaks.join(", ")})`);
    }
    if (jsonPreflight && !jsonPreflight.ok) {
      throw new Error(`FLUX_PREFLIGHT_FAILED: prompt JSON — ${jsonPreflight.errors.join("; ")}`);
    }
    // El caption del LoRA nunca pasa por verificarCoherenciaPrompt (no lleva
    // diámetros ni nombres del plan), así que sus colores por estructura se
    // comprueban sobre las cláusulas compiladas, con el mismo traductor.
    if (usarLora && planResuelto) {
      const coherenciaLora = verificarColoresCaptionLora(planResuelto, escenaParaCoherencia, { clausulas: loraCompilation.clauses, traducirColor: translateLoraColor });
      if (!coherenciaLora.ok) throw new Error(`El caption LoRA no coincide con el plan resuelto: ${coherenciaLora.errores.join("; ")}`);
    }
    if (usarLora && (usarComposicionLoraGemini || includesTextPrompt(promptFormat)) && !loraPreflightParaGenerar.ok) {
      // Sin semánticas canónicas del plan (selección suelta sin propuesta
      // aprobada) ninguna compactación ni reintento produce un prompt válido.
      const codigo = loraPreflightParaGenerar.requiresPlanSemantics ? "FLUX_PLAN_REQUIRED" : "FLUX_PREFLIGHT_FAILED";
      throw new Error(`${codigo}: ${loraPreflightParaGenerar.errors.join("; ")}`);
    }
    // Fase 4, opción B: en modo híbrido la etapa 1 recibía CERO imágenes, así que
    // toda la referencia del cliente viajaba solo como texto. Detrás de bandera
    // hasta que la evaluación de 10 planes decida entre A y B — promover una
    // variante de prompt es decisión de una persona, no de este cambio.
    const referenciasEtapa1 = usarComposicionLoraGemini
      ? (featureEnabled("REFERENCIA_EN_ETAPA1_V1") ? referenciasParaEtapa1Hibrida(selected.inputs) : [])
      : selected.inputs;
    // Lo que la ruta ya eligió para `/edit` y el adaptador no vuelve a filtrar:
    // la guía de estructura, o las referencias de la etapa 1 con
    // REFERENCIA_EN_ETAPA1_V1 (antes `referenciasParaLoraEdit` las descartaba
    // sin venue y la bandera no tenía efecto). Sin ninguna, el adaptador filtra
    // `referenciasEtapa1` como siempre.
    const imagenesEdit: readonly ImagenEditLora[] | undefined = imagenesGuia
      ?? (usarComposicionLoraGemini && featureEnabled("REFERENCIA_EN_ETAPA1_V1") ? referenciasEtapa1 : undefined);
    // Preflight del prompt FINAL que recibe fal: con foto del espacio o
    // referencias, el adaptador le añade la guía de imágenes de entrada
    // DESPUÉS de todas las comprobaciones anteriores, que solo ven el caption.
    // Fallar cerrado aquí es lo que impide mandar español, ids o datos
    // comerciales al proveedor.
    if (usarLora) {
      const referenciasEdit = imagenesEdit ?? (usarComposicionLoraGemini ? [] : referenciasParaLoraEdit(selected.inputs));
      const promptsLora: Array<readonly [string, string | undefined]> = usarComposicionLoraGemini
        ? [["presentacion", promptLoraParaGenerar]]
        : [["texto", promptLoraParaGenerar], ["JSON", effectiveJsonPrompt]];
      for (const [etiqueta, prompt] of promptsLora) {
        if (!prompt) continue;
        const promptFinal = buildLoraEditPrompt(prompt, referenciasEdit);
        const fugas = [...findLoraPromptLanguageLeaks(promptFinal), ...findLoraPromptProductLeaks(promptFinal, vocabularioDelModo)];
        if (fugas.length) throw new Error(`FLUX_EDIT_PREFLIGHT_FAILED: el prompt ${etiqueta} enviado al proveedor filtra ${fugas.join(", ")}`);
        if (promptFinal.length > LORA_EDIT_PROMPT_MAX_LENGTH) {
          throw new Error(`FLUX_EDIT_PREFLIGHT_FAILED: el prompt ${etiqueta} enviado al proveedor mide ${promptFinal.length} y supera el límite ${LORA_EDIT_PROMPT_MAX_LENGTH}`);
        }
      }
    }
    // Solo tiene sentido encadenar contexto real cuando esta petición ES una
    // revisión de una imagen previa; una generación nueva no hereda otra.
    const previousInteractionId = previous ? body.previousInteractionId : undefined;
    // One seed per LoRA request, fixed before calling so it can be returned:
    // the requested one, or a random draw. With "ambos" both provider calls
    // share it, so the only difference between the images is the prompt
    // format. The audit applies to the primary (text) image.
    const loraSeed = usarLora ? resolveLoraSeed(seedParse.seed) : undefined;
    const generarLora = (prompt: string, intento: number) => generarConSempertexLora(prompt, aspecto, referenciasEtapa1, {
      loras: requireResolvedLoras(resolvedLoras),
      signal: request.signal,
      telemetria: { ...contextoTelemetria, intento },
      guidanceScale: creatividad.guidanceScale,
      ...(loraSeed === undefined ? {} : { seed: loraSeed }),
      ...(imagenesEdit ? { imagenesEdit } : {}),
    });
    const [loraPrimaryImage, loraJsonImage] = usarLora
      ? await Promise.all([
          generarLora(promptLoraParaGenerar, 1),
          !usarComposicionLoraGemini && promptFormat === "ambos" && effectiveJsonPrompt ? generarLora(effectiveJsonPrompt, 2) : Promise.resolve(undefined),
        ])
      : [undefined, undefined];
    const inputsComposicionGemini = loraPrimaryImage && usarComposicionLoraGemini && venue
      ? inputsParaComposicionGemini(venue, loraPrimaryImage)
      : undefined;
    const promptComposicionGemini = inputsComposicionGemini
      ? `${buildImagePrompt({
          ...promptBase,
          inputs: inputsComposicionGemini.map(({ id, role, allowed_use }) => ({ image_id: id, role, allowed_use })),
        })}\n\n${hardLockComposicionGemini(...candadosDeComposicion(loraCompilation.clauses), conArmadoGuirnaldaEnCaption(loraCompilation.clauses), piezasDeLosArmados(loraCompilation.clauses))}${ambiente.instruccion ? `\n\n${ambiente.instruccion}` : ""}`
      : undefined;
    const result: { imagen: Imagen; interactionId?: string } = loraPrimaryImage && inputsComposicionGemini && promptComposicionGemini
      ? await port!.generar({
          prompt: promptComposicionGemini,
          sceneSpec: transformedSceneSpec,
          inputs: inputsComposicionGemini,
          aspecto,
          calidad: "alta",
          revisionMode: "new_generation",
          signal: request.signal,
          telemetria: { ...contextoTelemetria, capacidad: "imagen_generacion", intento: 2 },
        })
      : loraPrimaryImage
      ? { imagen: loraPrimaryImage }
      : await port!.generar({ prompt: providerPrompt, sceneSpec: transformedSceneSpec, inputs: selected.inputs, aspecto, calidad: "alta", previousGeneratedImage: previous, previousInteractionId, revisionMode: previous ? "revise_current_result" : "new_generation", signal: request.signal, telemetria: { ...contextoTelemetria, capacidad: "imagen_generacion" } });
    await auditarImagen("IMAGEN_GENERADA", transformedSceneSpec);
    // Sin pesos LoRA (modo `base`) la imagen no es del estilo entrenado; las etiquetas lo dicen.
    const etiquetaFlux = resolvedLoras?.length ? "LoRA Sempertex" : "FLUX.2 base";
    const promptsRespuesta = usarComposicionLoraGemini
      ? {
          [`${etiquetaFlux} · presentación`]: promptLoraParaGenerar,
          "Gemini · composición sobre espacio": promptComposicionGemini ?? providerPrompt,
        }
      : usarLora && promptFormat === "ambos" && effectiveJsonPrompt
        ? { [`${etiquetaFlux} · texto`]: effectiveLoraPrompt, [`${etiquetaFlux} · JSON`]: effectiveJsonPrompt }
        : { [usarLora ? (promptFormat === "json" ? `${etiquetaFlux} · JSON` : etiquetaFlux) : "Gemini · Nano Banana 2"]: promptPrincipal };
    const promptRespuesta = usarComposicionLoraGemini
      ? promptComposicionGemini ?? promptLoraParaGenerar
      : promptPrincipal;
    const debug = IMAGE_DEBUG;
    return Response.json({ imagen: `data:${result.imagen.mime};base64,${result.imagen.base64}`, sceneSpec: transformedSceneSpec, sceneSpecHash: resolvedSceneSpecHash, blueprint, plan: planResuelto, loraPreflight: usarLora ? loraPreflightParaGenerar : undefined, loraPromptVersion: usarLora ? (resolvedLoras?.length ? "v2" : "base") : undefined, loraMode: usarLora ? explicitLoraMode ?? undefined : undefined, loraPromptHash: usarLora ? hashPrompt(promptLoraParaGenerar) : undefined, compilerVersion: usarLora ? LORA_CAPTION_COMPILER_VERSION : undefined, loraProductRuntimeVersion: usarLora ? LORA_PRODUCT_RUNTIME_VERSION : undefined, productPromptCompilation: { resolved_concepts: productPromptCompilation.resolved_concepts, unresolved_products: productPromptCompilation.unresolved_products, vocabulary_version: productPromptCompilation.vocabulary_version, compiler_version: productPromptCompilation.compiler_version, legacy: productPromptCompilation.legacy, dropped_sizes: productPromptCompilation.dropped_sizes, diagnostics: productPromptCompilation.diagnostics }, proveedor, modoImagen: usarLora ? "lora" : "proveedor_base", pipeline: usarComposicionLoraGemini ? "lora_gemini" : undefined, promptFormat: usarLora ? (usarComposicionLoraGemini ? "texto" : promptFormat) : undefined, seed: loraSeed, creatividad: usarLora ? { nivel: creatividad.nivel, nombre: creatividad.nombre, guidance_scale: creatividad.guidanceScale, pistas_prompt: creatividad.pistasPrompt } : undefined, loraJsonPreflight: jsonPreflight, ambientDecor: ambientDecor.length ? ambientDecor : undefined, ambienteFiesta: ambiente.props.length ? { nivel: ambiente.nivel, props: ambiente.props } : undefined, avisoNoCotizado: requiereAvisoNoCotizado(ambiente, escenografiaVisible) ? ambiente.aviso || AVISO_ESCENOGRAFIA_NO_COTIZADA : undefined, escenografia: escenografiaRespuesta, imagenAlternativa: loraJsonImage && effectiveJsonPrompt ? { formato: "json", imagen: `data:${loraJsonImage.mime};base64,${loraJsonImage.base64}`, prompt: effectiveJsonPrompt } : undefined, cotizacion, interactionId: result.interactionId, prompt: promptRespuesta, prompts: promptsRespuesta, productAuthority: productAuthority.length ? productAuthority : undefined, ...(guiaEstructura ? { guiaEstructura: { estructura_id: guiaEstructura.estructuraId, usada: Boolean(imagenesGuia), carta: (imagenesGuia?.length ?? 0) > 1, guia_sha256: guiaEstructura.sha256, coste_entradas_extra_usd_estimado: costeEntradasUsdEstimado(imagenesGuia?.length ?? 0) } } : {}), ...(guiaEscena.resumen ? { guiaEscena: guiaEscena.resumen } : {}), ...(debug ? { visualContext, droppedImageIds: selected.droppedImageIds, aspectTransform, loraSelection: resolvedLoras?.map((lora) => ({ artifactId: lora.artifactId, specialization: lora.specialization, scale: lora.scale, trigger: lora.trigger })) } : {}) });
  } catch (error) {
    // Los campos legacy (`error`, `causa`, sobre operational.v1) se conservan:
    // el smoke los compara. `ui_error` (ui-error.v1) es lo que ve el cliente.
    const uiError = traducirErrorServidor(error, generationRequestId);
    registrarFalloUi("/api/generate", uiError);
    const responder = (cuerpo: Record<string, unknown>, status: number) => Response.json({ ...cuerpo, ui_error: uiError }, { status });
    if (error instanceof Error && /^LORA_(?:MODE|SELECTION|ARTIFACT|SPECIALIZATION|RUN|EVALUATION|PROVIDER|INCOMPATIBLE|MULTI|DATASET_ALLOWLIST|PRODUCT_VOCABULARY)/.test(error.message)) {
      return responder({ error: error.message }, 409);
    }
    if (error instanceof Error && error.message.startsWith(`${CODIGO_GENERACION_SIN_REFERENCIA}:`)) {
      return responder({ error: error.message, causa: "sin_referencia" }, 422);
    }
    if (error instanceof NonCommercialSourceRejectedError) {
      return responder({ error: error.message, causa: "fuente_no_comercial", productId: error.productId, source: error.source, referenceClass: error.referenceClass }, 403);
    }
    if (error instanceof ErrorIA) {
      return responder({ error: error.message, causa: error.causa, proveedor: error.proveedor }, statusDe(error.causa));
    }
    if (error instanceof AllowlistProductoVarianteError) {
      return responder({ error: error.message, causa: error.causa }, 422);
    }
    if (isPythonAdapterError(error)) {
      return responder(pythonErrorBody(error), error.status >= 400 && error.status <= 599 ? error.status : 502);
    }
    if (error instanceof PlanBackendNoDisponibleError) {
      return responder({ error: error.message, causa: error.motivo }, 409);
    }
    if (error instanceof PythonPlanMappingError) {
      return responder({ error: error.message }, 502);
    }
    return responder({ error: error instanceof Error ? error.message : "Image generation failed." }, 400);
  }
}
