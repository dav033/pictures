import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { buildImagePrompt, placementDescription, promptElementName, tieneContratoDeColor, type PromptImageInput } from "@/lib/ia/uzume/build-image-prompt";
import { frasesDeEstructuras, frasesEsenciales } from "@/lib/ia/uzume/mezcla-color-escena";
import { mezclaRealConArmado } from "@/lib/ia/uzume/armado-en-prompt";
import { BASE_PROMPT_MAX_LENGTH, translateFluxColor } from "@/lib/ia/kagutsuchi/caption-flux";
import { resolveFluxSeed } from "@/lib/ia/kagutsuchi/semilla-flux";
import { applySceneryVisibility, elementosMaterializados, sceneryFromReference, type SceneryItem } from "@/lib/ia/referencia/reference-structure";
import { nivelCreatividadParaGenerar, perfilCreatividad } from "@/lib/ia/escena/creatividad";
import { aliasesDeProducto, compileProductPrompt, sizeConfirmationsFromMaterialLines } from "@/lib/ia/kagutsuchi/producto-flux";
import { findFluxPromptLanguageLeaks, findFluxPromptProductLeaks, preflightFluxPrompt } from "@/lib/ia/kagutsuchi/preflight-flux";
import { bloqueMezclaTamanos, bloqueMezclaPorEstructura } from "@/lib/ia/escena/tamano-fisico";
import { descripcionProductoParaImagen } from "@/lib/ia/uzume/producto-para-imagen";
import { type Cotizacion } from "@/lib/cotizacion/motor";
import { featureEnabled, IMAGE_DEBUG, REFERENCE_ANALYSIS_PYTHON_ENABLED } from "@/lib/ia/nucleo/feature-flags";
import { aspectoDeLaReferencia } from "@/lib/ia/nucleo/aspecto";
import { resolveAspectTransform } from "@/lib/ia/uzume/aspect-transform";
import { analizarVenue, type VenueAnalysis } from "@/lib/ia/amaterasu/analizar-venue";
import { crearChatTurnoPython } from "@/lib/ia/amaterasu/chat-python";
import { targetBoxesFor } from "@/lib/ia/uzume/venue-placement";
import { chatDe, resolverProveedor, usaPython } from "@/lib/ia/nucleo/registro";
import { buildApprovedSceneSpec, SceneSpecSchema, sceneSpecHash, type SceneSpec } from "@/lib/ia/escena/scene-spec";
import { registrarPlanAudit } from "@/lib/rag/observability/log";
import { CODIGO_PLAN_DEL_MOTOR_3D, MENSAJE_PLAN_DEL_MOTOR_3D, contextoDelMotor3d } from "@/lib/plan/token-motor";
import { buildFluxEditPrompt, generarConSempertexFlux, FLUX_EDIT_PROMPT_MAX_LENGTH, referenciasParaFluxEdit, reservaNotaGuiaEscena, reservaNotasGuia, type ImagenEditFlux, type ImagenGuiaFlux } from "@/lib/ia/kagutsuchi/flux";
import { costeEntradasUsdEstimado, elegirCaptionConGuia, generacionAdmiteGuia } from "@/lib/ia/kagutsuchi/guia-estructura";
import { prepararGuiaEstructura } from "@/lib/ia/kagutsuchi/rasterizar-guia";
import { generacionAdmiteGuiaEscena, planConReferencia } from "@/lib/ia/kagutsuchi/guia-escena";
import { guiaEscenaParaGeneracion, recetasDelMotorPython } from "@/lib/ia/kagutsuchi/preparar-guia-escena";
import { bloqueoPorGeneracionSinReferencia, CODIGO_GENERACION_SIN_REFERENCIA, leerPoliticaDePresentacion, nivelAmbienteConPolitica, nivelCreatividadConPolitica } from "@/lib/presentacion/modo-presentacion";
import { FluxRevisionTranslationError, traducirRevisionParaFlux } from "@/lib/ia/kagutsuchi/revision-flux";
import { traducirRevisionConModelo } from "@/lib/ia/kagutsuchi/traducir-revision-modelo";

import { buildVisualContext, completarEscenaConPlan } from "@/lib/ia/escena/visual-context";
import { entornoDeEscena } from "@/lib/ia/escena/entorno-escena";
import { ambienteDeFiesta, avisoNoCotizadoDeImagen, nivelAmbienteDe } from "@/lib/ia/uzume/ambiente-fiesta";
import { ErrorIA, type ImageInput, type Imagen, type ImagenEtiquetada, type PeticionImagen } from "@/lib/ia/nucleo/tipos";
import { ReferenceBlueprintV2Schema, unidadesMaterialDeElemento, type ReferenceBlueprintV2 } from "@/lib/ia/referencia/reference-blueprint";
import { resolverProductosParaGeneracion } from "@/lib/rag/generate-products";
import { productosPorIdConFuente } from "@/lib/products";
import { isPythonAdapterError, llamarPythonPlanGuiaEscena, pythonErrorBody } from "@/lib/ia/nucleo/python-adapter";
import {
  classifyNonCommercialProducts,
  NonCommercialSourceRejectedError,
  type CommercialUsageIntent,
} from "@/lib/generacion/provenance";
import { resumenCuerpoGeneracion } from "@/lib/generacion/cuerpo-generacion";
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
import { filtrarTallasNoCompradas, verificarCoherenciaPrompt, verificarColoresCaptionFlux, type EscenaParaCoherencia } from "@/lib/plan/coherencia";
import { abrirContextoPlan, aprobacionSinHuellaEnPruebas, verificarTokenAprobacion } from "@/lib/plan/aprobacion";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import {
  designQuantityForProduct,
  formatMaterialEstimateLog,
  validateMaterialEstimate,
  type DesignMaterialEstimate,
} from "@/lib/materiales/estimacion";
import { conRegistro, decidir } from "@/lib/registro/servidor";
import { aligerarImagenGenerada } from "@/lib/generacion/imagen-liviana";
import {
  conLimite,
  guardarImagenLista,
  marcarImagenEnCurso,
  marcarImagenFallida,
  PlanHashImagenSchema,
  solicitudImagenDe,
  type ConsultorPg,
  type ResultadoEscritura,
} from "@/lib/generacion/imagen-recuperable";

export const maxDuration = 120;

/** Lo que se necesita para guardar la imagen de esta solicitud y recuperarla tras un corte (`imagen-recuperable.ts`). */
type Recuperable = { db: ConsultorPg; solicitudId: string; planHash: string };

/**
 * Solo con `x-solicitud-imagen` (la guiada la manda por intento) y un `plan_hash` con forma válida; sin Postgres
 * configurado no hay dónde guardar y la generación sigue igual. El hash es el que mandó el cliente: es el que él
 * tendrá a mano para preguntar (en producción coincide con el re-resuelto, que se verifica más abajo).
 */
const GUARDAR_IMAGENES_EN_SERVIDOR: boolean = false;

function abrirRecuperable(solicitudId: string | null, planHash: unknown): Recuperable | null {
  // Pedido del dueño (2026-10-07): el servidor no guarda imágenes; la guiada las guarda en el navegador (IndexedDB).
  // Sin almacén, ante un corte la vista hace un único reintento silencioso.
  if (GUARDAR_IMAGENES_EN_SERVIDOR !== true) return null;
  if (!solicitudId) return null;
  const hash = PlanHashImagenSchema.safeParse(planHash);
  if (!hash.success) return null;
  try {
    return { db: getRagPool(), solicitudId, planHash: hash.data };
  } catch {
    return null;
  }
}

const ESCRITURA_VENCIDA: ResultadoEscritura = { ok: false, error: "la base no respondió a tiempo" };

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
  revisionInstruction?: string;
  /** Interruptor de ambientación (fase 6.B). `nivelAmbienteDe` valida el valor. */
  ambiente?: unknown;
  instruccion?: string;
  plan?: PlanResuelto;
  planHash?: string;
  /** Creatividad 0-5: define pistas visuales y escala de guía para FLUX. */
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

/** La mezcla para el prompt sale del estimado que devolvió Python, pieza por pieza. */
function mezclaDelEstimadoPython(
  lines: DesignMaterialEstimate["balloons"],
  estructuraId?: string,
): Array<{ diamPulg: number; forma: string | null; unidades: number }> {
  const grupos = new Map<string, { diamPulg: number; forma: string | null; unidades: number }>();
  const hayEstructuras = lines.some((line) => line.structure_id !== undefined);
  for (const line of lines) {
    if ((estructuraId && hayEstructuras && line.structure_id !== estructuraId) || line.size_inches === null || line.design_quantity === 0) continue;
    const clave = `${line.size_inches}:${line.shape ?? "redondo"}`;
    const grupo = grupos.get(clave);
    grupos.set(clave, { diamPulg: line.size_inches, forma: line.shape, unidades: (grupo?.unidades ?? 0) + line.design_quantity });
  }
  const mezcla = [...grupos.values()];
  const total = mezcla.reduce((suma, linea) => suma + linea.unidades, 0);
  return total > 0 ? mezcla : [];
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
// Auditado (src/lib/registro): entrada, salida, errores y lo que la petición llame (IA, Python, decisiones).
export const POST = conRegistro("/api/generate", atenderPOST);

async function atenderPOST(request: Request) {
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
  const solicitudImagen = solicitudImagenDe(request.headers);
  let recuperable: Recuperable | null = null;
  let marcaEnCurso: Promise<ResultadoEscritura> | null = null;
  try {
    const body = await request.json() as Body;
    const camposRetirados = ["usarLora", "loraMode", "loraSelection", "promptFormat", "seed", "previousInteractionId", "interactionId"];
    if (camposRetirados.some((campo) => Object.hasOwn(body, campo)) || (body.proveedor !== undefined && body.proveedor !== "flux")) {
      throw new Error("IMAGEN_SOLO_FLUX: la generación solo admite FLUX base y el contrato actual.");
    }
    validarImagenesEntrada(body);
    // Las dos vistas arman este cuerpo con `cuerpoGeneracion`; el resumen (sin base64) deja comparar en los registros
    // qué mandó cada una (x-vista) para la misma foto: blueprint, aspecto, creatividad, productos.
    decidir("regla:cuerpo_generacion", "qué trajo el cuerpo de /api/generate (resumen, sin imágenes)", resumenCuerpoGeneracion(body));
    // Toda imagen sale de una propuesta aprobada (ADR-0023, paso 1). La rama
    // heredada que estimaba y cotizaba en TypeScript a partir de piezas
    // elegidas a mano se retiró: era el único camino de la app que no pasaba
    // por el resolutor, y mantenía viva una segunda implementación de las
    // reglas de conteo.
    if (!body.plan) throw new Error("APROBACION_REQUERIDA: la imagen se genera desde una propuesta aprobada.");
    // Si la respuesta se corta en el camino (móvil, 2026-10-07), el navegador pregunta por esta solicitud antes de
    // pedir otra imagen: aquí queda «en curso» y, al terminar, la imagen guardada (`imagen-recuperable.ts`).
    recuperable = abrirRecuperable(solicitudImagen, body.plan.plan_hash);
    if (solicitudImagen) {
      decidir("regla:imagen_recuperable", "la imagen de esta solicitud se guarda para recuperarla si la respuesta se corta", recuperable ? "activa" : "sin_almacen", {
        entrada: { solicitudId: solicitudImagen, planHash: typeof body.plan.plan_hash === "string" ? body.plan.plan_hash : null },
      });
    }
    if (recuperable) {
      const marca = recuperable;
      marcaEnCurso = marcarImagenEnCurso(marca.db, marca).then((resultado) => {
        if (!resultado.ok) decidir("regla:imagen_recuperable_en_curso", "no se pudo anotar la solicitud en curso", "no_anotada", { entrada: { solicitudId: marca.solicitudId }, motivo: resultado.error });
        return resultado;
      });
    }
    const planDeclarativo = PlanDecoracionSchema.parse(body.plan.plan);
    const contextoPlan = abrirContextoPlan(body.plan.approval_token);
    if (!contextoPlan) {
      throw new Error("APROBACION_REQUERIDA: el plan debe aprobarse desde la tarjeta antes de generar.");
    }
    // Un plan del motor 3D no se dibuja con esta ruta: Python contaría otra cosa que el plan que el cliente aprobó (REQ-007).
    if (contextoDelMotor3d(contextoPlan)) throw new Error(`${CODIGO_PLAN_DEL_MOTOR_3D}: ${MENSAJE_PLAN_DEL_MOTOR_3D}`);
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
    classifyNonCommercialProducts(idsSeedDemo, "seed_demo", usoComercialProductos);
    classifyNonCommercialProducts(idsManuales, "manual_product", usoComercialProductos);
    // Esto se resuelve ANTES de resolver el plan: el resolutor necesita el
    // allowlist para no elegir variantes que el modelo nunca vio, y los ids
    // que llegan del cliente conviene rechazarlos antes de cotizar.
    const resolvedFluxApplications: [] = [];
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
      requestId: generationRequestId,
      correlationId: generationCorrelationId,
      signal: request.signal,
    });
    const planResuelto = resolucion.resuelto;
    const cotizacionPlan = resolucion.cotizacion;
    decidir("regla:plan_resuelto_generacion", "plan que el servidor re-resolvió (Python) para la imagen", {
      planHash: planResuelto.plan_hash,
      totalCop: planResuelto.totales.total_cop,
      compras: planResuelto.compras.map((compra) => ({ variant_id: compra.variant_id, paquetes: compra.paquetes, subtotal: compra.subtotal })),
      sinCobertura: planResuelto.sin_cobertura,
      comercial: planResuelto.comercial,
    }, { entrada: { planHashCliente: body.plan.plan_hash, estructuras: planResuelto.plan.estructuras.length } });
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
    // Un material sin cobertura (p. ej. una talla que el producto no vende) NO impide dibujar (pedido del dueño,
    // 2026-10-07: «esto de que no se puede dibujar no puede pasar»). La imagen sale con lo que el plan sí compra; la
    // tarjeta ya avisa lo que falta y aquí queda registrado.
    if (planResuelto.sin_cobertura.length > 0) {
      decidir("regla:imagen_con_faltantes", "se dibuja aunque haya materiales sin cobertura: la imagen muestra lo que el plan compra", {
        sinCobertura: planResuelto.sin_cobertura,
      }, { entrada: { planHash: planResuelto.plan_hash } });
    }
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
    const motorImagenPrevisto = "flux";
    const auditarImagen =async (status: string, scene: SceneSpec) => {
      decidir("regla:auditoria_imagen", "estado de la imagen en la auditoría de planes (Postgres)", status, { entrada: { planHash: planResuelto.plan_hash, sceneSpecHash: sceneSpecHash(scene), motor: motorImagenPrevisto } });
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
           motorImagenPrevisto,
           diagnosticoGeneracion: {
             hashesEntrada: selected.inputs.map((input) => createHash("sha256").update(Buffer.from(input.base64, "base64")).digest("hex").slice(0, 16)),
             semilla: fluxSeed,
             // El resolvedor no devuelve el estado de evaluación junto al artifact;
             // dejar el slot nulo evita atribuir un estado que no vimos.
             slot: null,
             captionHash: hashPrompt(promptFluxParaGenerar).slice(0, 16),
             captionLongitud: promptFluxParaGenerar.length,
             preflightOk: fluxPreflightParaGenerar.ok,
             preflightErrores: fluxPreflightParaGenerar.errors,
             tallasOmitidas: [...new Set(
               productPromptCompilation.diagnostics
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
    const proveedorSeleccionado = resolverProveedor({ cookie: request.headers.get("cookie")?.match(/ia_proveedor=(gemini)/)?.[1] });
    let venueAnalysis: VenueAnalysis | undefined;
    if (venue && featureEnabled("VENUE_AWARE_PLACEMENT_V1")) {
      try {
        // Misma forma que el análisis de referencias (dos pasadas de un solo
        // mensaje con la foto), así que va por el mismo flag de Amaterasu.
        const chatVenue = usaPython(proveedorSeleccionado, REFERENCE_ANALYSIS_PYTHON_ENABLED)
          ? crearChatTurnoPython({ requestId: generationRequestId, correlationId: generationCorrelationId, proposito: "analisis_venue" })
          : await chatDe(proveedorSeleccionado, "analisis_venue");
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

    const capabilities = {
      exactAspectRatios: ["3:2", "1:1", "2:3", "16:9"] as PeticionImagen["aspecto"][],
      totalInputImageLimit: 0,
      objectFidelityInputLimit: 0,
      highFidelityInputSupport: false,
      multiTurnSupport: false,
    };
    const aspectTransform = resolveAspectTransform(aspecto, capabilities);
    const transformedSceneSpec = SceneSpecSchema.parse({ ...sceneSpec, canvas: { ...sceneSpec.canvas, content_rect: aspectTransform.contentRect } });
    const resolvedSceneSpecHash = sceneSpecHash(transformedSceneSpec);
    decidir("regla:escena_aprobada", "escena que el servidor aprueba para la imagen", { sceneSpecHash: resolvedSceneSpecHash, modo: sceneSpec.generation_mode, elementos: sceneSpec.elements.length, aspecto }, { entrada: { venue: Boolean(venue), previa: Boolean(previous), venueAnalizado: Boolean(venueAnalysis) } });
    if (body.sceneSpecHash && body.sceneSpecHash !== resolvedSceneSpecHash) throw new Error("Scene specification hash does not match the validated scene.");
    const { imagenes: productImages, faltantes: fotosCatalogoFaltantes } = await cargarFotosProducto(productosConMateriales, materialEstimate);
    // LoRA Edit recibe hasta cuatro referencias visuales. Mantenemos una lista
    // más amplia aquí para resolver prioridades; el adaptador escoge las cuatro
    // mejores (espacio, productos y después composición).
    const inputLimit = Math.max(16, sceneSpec.elements.length);
    const selected = buildInputs({ portLimit: inputLimit, blueprint, sceneElements: sceneSpec.elements, references, venue, previous, products: productImages });
    // The level signed into the approved plan wins over the slider at generation time.
    // presentationMode (R23): con el catálogo cerrado el nivel no pasa del techo sin ambientación; apagado, el nivel es el de siempre.
    const creatividad = perfilCreatividad(nivelCreatividadConPolitica(nivelCreatividadParaGenerar(contextoPlan?.creatividad, body.creatividad), politicaPresentacion));
    decidir("regla:creatividad_generacion", "nivel de creatividad con que se genera (el firmado en el plan manda)", creatividad, { entrada: { delPlan: contextoPlan?.creatividad ?? null, delCliente: body.creatividad ?? null, referenciasElegidas: selected.inputs.map((input) => input.role) } });
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
      ? bloqueMezclaPorEstructura(planResuelto.estructuras.map((estructura) => {
          const mezclaEstimada = mezclaDelEstimadoPython(materialEstimate.balloons, estructura.estructura_id);
          const mezclaGlobalEstimada = mezclaDelEstimadoPython(materialEstimate.balloons);
          return {
            nombre: estructura.nombre,
            total_unidades: estructura.total_unidades,
            repeticiones: estructura.repeticiones,
            ubicacion_en_palabras: ubicacionPorEstructura.get(estructura.estructura_id),
            mezcla_real: mezclaEstimada.length ? mezclaEstimada : mezclaGlobalEstimada.length ? mezclaGlobalEstimada : mezclaRealConArmado(estructura.mezcla_real, armadoPorEstructura.get(estructura.estructura_id)),
          };
        })) ?? undefined
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
    const providerPrompt = filtrarTallasNoCompradas(
      buildImagePrompt(promptBase),
      materialEstimate.balloons.flatMap((linea) => linea.size_inches === null ? [] : [linea.size_inches]),
    );
    if (planResuelto) {
      const coherencia = verificarCoherenciaPrompt(
        providerPrompt,
        planResuelto,
        escenaParaCoherencia,
        materialEstimate.balloons.flatMap((linea) => linea.size_inches === null ? [] : [linea.size_inches]),
      );
      if (!coherencia.ok) {
        console.warn("[generate] coherencia visual rechazada", {
          request_id: generationRequestId,
          errores: coherencia.errores,
          tallas_del_bloque: [...(sizeMixBlock?.matchAll(/(\d+(?:\.\d+)?)-inch/g) ?? [])].map((match) => Number(match[1])),
          tallas_del_estimado_python: [...new Set(materialEstimate.balloons.flatMap((linea) => linea.size_inches === null ? [] : [linea.size_inches]))],
          tallas_del_prompt: [...(providerPrompt.matchAll(/(\d+(?:\.\d+)?)-inch/g))].map((match) => Number(match[1])),
        });
        // Nunca deja sin imagen (pedido del dueño, 2026-10-07): se dibuja y queda registrado lo que no cuadró.
        decidir("regla:coherencia_prompt_aviso", "el prompt no coincide del todo con el plan resuelto; se dibuja igual", { errores: coherencia.errores }, { entrada: { planHash: planResuelto.plan_hash } });
      }
    }
    // The quote is finalized before the paid provider call. The image receives
    // the same estimate snapshot, but never gets package capacity as visual
    // quantity.
    const cotizacion: Cotizacion = cotizacionPlan;
    // El runtime describe productos desde sus títulos de catálogo.
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
    // Las guías acompañan el único caption base de FLUX.
    // La guía de escena (GUIA_ESCENA_V1) cuenta igual: con un plan que salió de una foto de referencia, FLUX
    // recibe por `/edit` el mapa plano de toda la decoración en vez de la foto, y también viaja solo con texto.
    // La escenografía aprobada solo ambienta el caption de FLUX.
    // Fase 6.B. Dos fuentes legítimas y ninguna más: la escenografía que estaba
    // en la foto del propio cliente, y este interruptor explícito. El
    // vocabulario del interruptor es cerrado (`ambiente-fiesta.ts`): un modelo
    // puede elegir de la lista, nunca ampliarla.
    const ambiente = featureEnabled("AMBIENTE_FIESTA_V1") ? ambienteDeFiesta(nivelAmbienteConPolitica(nivelAmbienteDe(body.ambiente), politicaPresentacion)) : ambienteDeFiesta("ninguno");
    // El follaje tejido en la guirnalda (monstera, palma, hojas) es pequeño y disperso: ordenado por confianza y área
    // quedaba fuera de los 3 primeros detrás del panel, y FLUX dibujaba la guirnalda pelada (medio arco, 2026-10-07).
    // Si los tres primeros no lo tienen, el primer follaje toma el tercer puesto. Sigue siendo escenografía: no se cotiza.
    const nombresEscenografia = escenografiaVisible.map((item) => item.name);
    const esFollaje = (item: SceneryItem): boolean => item.category === "floral" || /\b(?:leaf|leaves|foliage|greenery|monstera|palms?|ferns?|eucalyptus|ivy)\b/.test(item.name);
    const primerFollaje = escenografiaVisible.find(esFollaje);
    const ambientDecor = primerFollaje && !nombresEscenografia.slice(0, 3).includes(primerFollaje.name)
      ? [...nombresEscenografia.slice(0, 2), primerFollaje.name]
      : nombresEscenografia.slice(0, 3);
    const visualContextFlux = visualContext;
    // Guía de escena (GUIA_ESCENA_V1, encendida): FLUX recibe por `/edit` UNA imagen con los globos de todas las
    // piezas, dibujados por el motor en Python (la receta del motor en las piezas sin armado: lo que enseña la
    // gráfica del plan). Con un plan que salió de una foto, cada pieza donde la foto tiene la suya (la foto del
    // cliente nunca sale hacia fal); sin foto (GUIA_ESCENA_SIN_FOTO_V1: un plan de texto o de una idea), cada pieza
    // a su escala real en metros según su ubicación. Si la guía no se puede construir o su nota no cabe, se genera
    // sin ella y la respuesta lo dice (`guiaEscena.usada: false`, `motivo`). Misma ruta y mismo constructor para la
    // clásica y la guiada. Sustituye a la guía de estructura cuando aplica.
    // Las flores de globo no están en el dibujo del motor: con la guía, FLUX copia el mapa y las borra (dueño,
    // 2026-10-07, aro con flores). Un plan con flores va solo con texto, que sí las describe.
    const planConFlores = Boolean(planResuelto?.plan.estructuras.some((estructura) => Boolean(estructura.flores)));
    if (planConFlores) decidir("regla:guia_escena_sin_flores", "plan con flores de globo: la imagen va sin guía de escena para que FLUX dibuje las flores", true, { entrada: { planHash: planResuelto?.plan_hash ?? null } });
    const admiteGuiaEscena = !planConFlores && Boolean(planResuelto && resolvedFluxApplications && generacionAdmiteGuiaEscena({
      bandera: featureEnabled("GUIA_ESCENA_V1"),
      usarFlux: true,
      hibrido: false,
      fotoEspacio: Boolean(venue),
      resultadoPrevio: Boolean(previous),
      editApagado: false,
      formatoTexto: true,
      conReferencia: planConReferencia(planResuelto.plan.estructuras),
      sinFoto: featureEnabled("GUIA_ESCENA_SIN_FOTO_V1"),
    }));
    // El ENTORNO del evento (2026-10-07, «composiciones más audaces… del entorno»): escenario, utilería, luz y encuadre
    // de lo que dijo el cliente (evento, lugar, momento, temática) o, si no dijo nada, el de su evento; nunca pared
    // vacía. Solo texto a imagen: con foto del espacio o sobre una imagen previa la escena ya existe. Lo que añade se
    // avisa como no cotizado (`avisoNoCotizado`), igual en la clásica y en la guiada (mismo cuerpo, misma ruta).
    // Con la guía de escena el punto de vista es el del mapa: el entorno va sin su encuadre 3/4 (`conGuiaDeEscena`).
    const entorno = entornoDeEscena({ contexto: visualContextFlux, nivel: creatividad.nivel, modo: transformedSceneSpec.generation_mode, conEscenografiaDeFoto: ambientDecor.length > 0, conGuiaDeEscena: admiteGuiaEscena, desdeFoto: Boolean(referenciaAnalizada?.success) });
    decidir("regla:entorno_escena", "entorno del evento que acompaña a la decoración en el caption de FLUX", entorno ?? null, { entrada: { modo: transformedSceneSpec.generation_mode, nivel: creatividad.nivel, evento: visualContextFlux.eventType ?? null, lugar: visualContextFlux.venue ?? null, momento: visualContextFlux.timeOfDay ?? null, estilo: visualContextFlux.style ?? null, escenografiaDeFoto: ambientDecor.length, conGuiaDeEscena: admiteGuiaEscena, desdeFoto: Boolean(referenciaAnalizada?.success) } });
    const compilarCaptionCon = (maxLength: number | undefined, frases: typeof colorPatterns) => compileProductPrompt({
      sceneSpec: transformedSceneSpec,
      visualContext: visualContextFlux,
      sizeConfirmations,
      productIdAliases,
      productCatalogTitles,
      maxLength,
      ambientDecor,
      creativeCues: creatividad.pistasPrompt,
      officialStructures: officialStructures ?? new Map<string, string>(),
      colorPatterns: frases,
      entorno,
    });
    const compilarCaption = (maxLength: number | undefined) => compilarCaptionCon(maxLength, colorPatterns);
    // En base, el límite de 1000 es del CAPTION (que la decoración vaya primero), no de la nota fija que explica
    // la guía de escena: con la nota dentro del mismo 1000, al caption le quedaban ~380 caracteres, dos piezas no
    // cabían, la guía se caía y el caption sin guía (frases de Python incluidas) fallaba en 1152 (2026-10-06,
    // FLUX_PREFLIGHT_FAILED). El tope duro del prompt que recibe fal sigue siendo FLUX_EDIT_PROMPT_MAX_LENGTH.
    const limiteConGuiaEscena = BASE_PROMPT_MAX_LENGTH + reservaNotaGuiaEscena();
    const guiaEscena = planResuelto && resolvedFluxApplications
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
          completarRecetas: recetasDelMotorPython({ requestId: generationRequestId, correlationId: generationCorrelationId, signal: request.signal }),
          maximo: limiteConGuiaEscena,
          compilar: compilarCaption,
          // Con guía, la forma y los colores de cada pieza los dibuja el mapa: las frases de Python de forma y
          // de patrón son lo prescindible si no caben con su nota (2026-10-04: dos piezas del motor orgánico
          // dejaban el prompt base en 1195 de 1000 y la guía se caía). Los armados de bouquet y de guirnalda se
          // quedan: el caption cuenta piezas y elige candados con ellos.
          // Las flores de globo de cada pieza (flores-pieza.ts) también se quedan: son globos que se compran y la guía no las dibuja.
          compilarSinFrases: (maxLength) => compilarCaptionCon(maxLength, frasesEsenciales(colorPatterns)),
          largo: (compilacion) => compilacion.prompt.length,
          cabe: (compilacion, imagenes) => preflightFluxPrompt({
            sceneSpec: transformedSceneSpec,
            clauses: compilacion.clauses,
            prompt: buildFluxEditPrompt(compilacion.prompt, imagenes),
            maxLength: limiteConGuiaEscena,
          }).ok,
          signal: request.signal,
        })
      : {};
    if (guiaEscena.resumen) {
      // Solo el hash y metadatos: ni la guía ni la foto van a registros. El coste es ESTIMADO.
      console.info("[generate] guía de escena", { requestId: generationRequestId, ...guiaEscena.resumen });
    }
    // Auditoría de IA: qué piezas dibujó la guía, cuáles fueron solo con texto (`omitidas`, con su motivo) y la caja
    // de cada una en el lienzo; sin la guía ni la foto, solo metadatos y su hash.
    decidir("regla:guia_escena", "guía de escena que acompaña a FLUX por /edit (piezas dibujadas, omitidas y su caja)", guiaEscena.resumen ?? null, {
      entrada: {
        admite: admiteGuiaEscena,
        conReferencia: Boolean(planResuelto && planConReferencia(planResuelto.plan.estructuras)),
        sinFoto: featureEnabled("GUIA_ESCENA_SIN_FOTO_V1"),
        fotoEspacio: Boolean(venue),
        resultadoPrevio: Boolean(previous),
        estructuras: planResuelto?.plan.estructuras.map((estructura) => ({ id: estructura.estructura_id, tipo: estructura.tipo, ubicacion: estructura.ubicacion, repeticiones: estructura.repeticiones })) ?? [],
      },
    });
    // ADR-0033, detrás de GUIA_ESTRUCTURA_V1 (apagada): sin foto del espacio y
    // con una sola estructura con armado o patrón, el LoRA recibe por `/edit` el
    // mapa de color plano de esa estructura y su carta. Las notas de la guía
    // cuentan contra el presupuesto del caption; si no caben ni sin la carta,
    // la generación sigue sin guía y se registra.
    const guiaEstructura = !admiteGuiaEscena && planResuelto && resolvedFluxApplications && generacionAdmiteGuia({
      bandera: featureEnabled("GUIA_ESTRUCTURA_V1"),
      usarFlux: true,
      hibrido: false,
      fotoEspacio: Boolean(venue),
      resultadoPrevio: Boolean(previous),
      editApagado: false,
      formatoTexto: true,
    })
      ? await prepararGuiaEstructura(planResuelto, aspecto)
      : null;
    const captionConGuia = guiaEstructura && resolvedFluxApplications
      ? elegirCaptionConGuia<ReturnType<typeof compilarCaption>, ImagenGuiaFlux>({
          imagenes: guiaEstructura.imagenes,
          maximo: BASE_PROMPT_MAX_LENGTH,
          reserva: reservaNotasGuia,
          compilar: compilarCaption,
          largo: (compilacion) => compilacion.prompt.length,
          cabe: (compilacion, imagenes) => preflightFluxPrompt({
            sceneSpec: transformedSceneSpec,
            clauses: compilacion.clauses,
            prompt: buildFluxEditPrompt(compilacion.prompt, imagenes),
          }).ok,
        })
      : null;
    const imagenesGuia: readonly ImagenGuiaFlux[] | undefined = guiaEscena.imagenes ?? captionConGuia?.imagenes;
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
    const productPromptCompilation = guiaEscena.compilacion ?? captionConGuia?.compilacion ?? compilarCaption(undefined);
    const fluxCompilation = {
      prompt: productPromptCompilation.prompt,
      clauses: productPromptCompilation.clauses,
      compilerVersion: productPromptCompilation.captionCompilerVersion,
    };
    const promptFluxParaGenerar = fluxCompilation.prompt;
    const fluxPreflight = preflightFluxPrompt({
      sceneSpec: transformedSceneSpec,
      clauses: fluxCompilation.clauses,
      prompt: promptFluxParaGenerar,
    });
    const fluxPreflightParaGenerar = imagenesGuia
      ? preflightFluxPrompt({
          sceneSpec: transformedSceneSpec,
          clauses: fluxCompilation.clauses,
          prompt: buildFluxEditPrompt(promptFluxParaGenerar, imagenesGuia),
          maxLength: limiteConGuiaEscena,
        })
      : fluxPreflight;
    const fluxLanguageLeaks = findFluxPromptLanguageLeaks(promptFluxParaGenerar);
    if (fluxLanguageLeaks.length) {
      throw new Error(`FLUX_LANGUAGE_FAILED: el prompt contiene texto español sin traducir (${fluxLanguageLeaks.join(", ")})`);
    }
    if (!fluxPreflightParaGenerar.ok) {
      const codigo = fluxPreflightParaGenerar.requiresPlanSemantics ? "FLUX_PLAN_REQUIRED" : "FLUX_PREFLIGHT_FAILED";
      // El texto rechazado queda en el registro (auditoría de IA): sin él, un «longitud 1540 supera límite 1000» no
      // decía qué parte del caption sobraba ni si la guía de escena se había caído (banco de fotos 06, 2026-10-07).
      decidir("regla:prompt_flux_rechazado", "texto que no pasó la revisión previa de FLUX y no se envió", {
        codigo,
        errores: fluxPreflightParaGenerar.errors,
        largo: promptFluxParaGenerar.length,
        guia: imagenesGuia ? "usada" : admiteGuiaEscena ? "no_cupo" : "no_aplica",
        prompt: promptFluxParaGenerar,
      });
      throw new Error(`${codigo}: ${fluxPreflightParaGenerar.errors.join("; ")}`);
    }
    if (planResuelto) {
      const coherenciaFlux = verificarColoresCaptionFlux(planResuelto, escenaParaCoherencia, { clausulas: fluxCompilation.clauses, traducirColor: translateFluxColor });
      // Nunca deja sin imagen: p. ej. un color que la idea compra con otro producto (variant_overrides) «falta» por nombre.
      if (!coherenciaFlux.ok) decidir("regla:coherencia_caption_aviso", "el caption FLUX no coincide del todo con el plan resuelto; se dibuja igual", { errores: coherenciaFlux.errores }, { entrada: { planHash: planResuelto.plan_hash } });
    }
    const revisionFlux = revisionInstruction?.trim()
      ? await traducirRevisionParaFlux(revisionInstruction, traducirRevisionConModelo)
      : undefined;
    const sufijoRevision = revisionFlux
      ? `\n\nUser revision request: ${revisionFlux}. Apply only this change; preserve the current scene and venue.`
      : "";
    const promptFlux = `${promptFluxParaGenerar}${sufijoRevision}`;
    const referenciasEtapa1 = selected.inputs;
    const imagenesEdit: readonly ImagenEditFlux[] = imagenesGuia ?? referenciasParaFluxEdit(selected.inputs);
    // El preflight inspecciona texto final, incluidas referencias y revisión traducida.
    const promptFinal = `${buildFluxEditPrompt(promptFluxParaGenerar, imagenesEdit)}${sufijoRevision}`;
    const preflightFinal = preflightFluxPrompt({
      sceneSpec: transformedSceneSpec,
      clauses: fluxCompilation.clauses,
      prompt: promptFinal,
      maxLength: FLUX_EDIT_PROMPT_MAX_LENGTH,
    });
    const fugasFinales = [...findFluxPromptLanguageLeaks(promptFinal), ...findFluxPromptProductLeaks(promptFinal)];
    if (fugasFinales.length) throw new Error(`FLUX_EDIT_PREFLIGHT_FAILED: el prompt enviado a FLUX filtra ${fugasFinales.join(", ")}`);
    if (promptFinal.length > FLUX_EDIT_PROMPT_MAX_LENGTH) {
      throw new Error(`FLUX_EDIT_PREFLIGHT_FAILED: el prompt enviado a FLUX mide ${promptFinal.length} y supera el límite ${FLUX_EDIT_PROMPT_MAX_LENGTH}`);
    }
    if (!preflightFinal.ok) throw new Error(`FLUX_PREFLIGHT_FAILED: ${preflightFinal.errors.join("; ")}`);
    // Solo tiene sentido encadenar contexto real cuando esta petición ES una
    // revisión de una imagen previa; una generación nueva no hereda otra.
    // Semilla fija para atribuir esta llamada a fal.
    const fluxSeed = resolveFluxSeed(undefined);
    decidir("regla:prompt_flux", "texto final, referencias y semilla que van a FLUX", {
      promptFinal,
      largo: promptFinal.length,
      compilador: fluxCompilation.compilerVersion,
      referencias: imagenesEdit.map((imagen) => imagen.role),
      semilla: fluxSeed ?? null,
      guidanceScale: creatividad.guidanceScale,
    }, { entrada: { revision: revisionFlux ?? null, conGuiaEscena: Boolean(imagenesGuia), aplicaciones: (resolvedFluxApplications ?? []).length } });
    const generarFlux = (prompt: string, intento: number) => generarConSempertexFlux(prompt, aspecto, referenciasEtapa1, {
      loras: resolvedFluxApplications ?? [],
      signal: request.signal,
      telemetria: { ...contextoTelemetria, intento },
      guidanceScale: creatividad.guidanceScale,
      ...(fluxSeed === undefined ? {} : { seed: fluxSeed }),
      imagenesEdit,
    });
    const fluxPrimaryImage = await generarFlux(promptFlux, 1);
    const imagen = fluxPrimaryImage;
    await auditarImagen("IMAGEN_GENERADA", transformedSceneSpec);
    // Etiqueta explícita del motor único de imagen.
    const etiquetaFlux = "FLUX base";
    const promptsRespuesta = { [etiquetaFlux]: promptFlux };
    const promptRespuesta = promptFlux;
    // El PNG de FLUX (~2,8 MB, ~3,8 MB en base64) viaja como JPEG de calidad alta (~200-400 KB) a las dos vistas: en el
    // móvil la respuesta pesada se cortaba (2026-10-07). Misma resolución; si no se puede aligerar, va como llegó.
    const imagenViaje = await aligerarImagenGenerada(imagen);
    decidir("regla:imagen_liviana", "formato y peso con que viaja la imagen al navegador", {
      resultado: imagenViaje.resultado,
      mime: imagenViaje.mime,
      kbAntes: Math.round(imagenViaje.bytesAntes / 1024),
      kbDespues: Math.round(imagenViaje.bytesDespues / 1024),
      ancho: imagenViaje.ancho,
      alto: imagenViaje.alto,
    }, { entrada: { mimeFlux: imagen.mime }, ...(imagenViaje.detalle ? { motivo: imagenViaje.detalle } : {}) });
    const avisoNoCotizado = avisoNoCotizadoDeImagen(ambiente, escenografiaVisible, entorno);
    if (recuperable) {
      // Antes de responder: si la respuesta no llega al navegador, la imagen ya está donde él la va a buscar.
      const guardado = await conLimite(guardarImagenLista(recuperable.db, { ...recuperable, mime: imagenViaje.mime, bytes: imagenViaje.bytes, avisoNoCotizado }), 5_000, ESCRITURA_VENCIDA);
      decidir("regla:imagen_recuperable_guardada", "la imagen quedó guardada para recuperarla si la respuesta se corta", guardado.ok ? "guardada" : "no_guardada", {
        entrada: { solicitudId: recuperable.solicitudId, kb: Math.round(imagenViaje.bytesDespues / 1024) },
        ...(guardado.ok ? {} : { motivo: guardado.error }),
      });
    }
    return Response.json({
      imagen: `data:${imagenViaje.mime};base64,${imagenViaje.base64}`,
      motorImagen: "flux",
      plan: planResuelto,
      cotizacion,
      prompt: promptRespuesta,
      prompts: promptsRespuesta,
      avisoNoCotizado,
    });
  } catch (error) {
    if (recuperable) {
      // Quien pregunte por esta solicitud ya no espera: no hubo imagen (y no se pagó otra).
      const fallida = recuperable;
      await marcaEnCurso?.catch(() => undefined);
      const marcada = await conLimite(marcarImagenFallida(fallida.db, fallida), 3_000, ESCRITURA_VENCIDA);
      if (!marcada.ok) decidir("regla:imagen_recuperable_fallida", "no se pudo anotar que la solicitud falló", "no_anotada", { entrada: { solicitudId: fallida.solicitudId }, motivo: marcada.error });
    }
    // Los campos legacy (`error`, `causa`, sobre operational.v1) se conservan:
    // el smoke los compara. `ui_error` (ui-error.v1) es lo que ve el cliente.
    const uiError = traducirErrorServidor(error, generationRequestId);
    registrarFalloUi("/api/generate", uiError);
    const responder = (cuerpo: Record<string, unknown>, status: number) => Response.json({ ...cuerpo, ui_error: uiError }, { status });
    if (error instanceof Error && error.message.startsWith("IMAGEN_SOLO_FLUX:")) {
      return responder({ error: error.message }, 409);
    }
    if (error instanceof Error && error.message.startsWith(`${CODIGO_PLAN_DEL_MOTOR_3D}:`)) {
      return responder({ error: MENSAJE_PLAN_DEL_MOTOR_3D, causa: CODIGO_PLAN_DEL_MOTOR_3D }, 409);
    }
    if (error instanceof FluxRevisionTranslationError) {
      return responder({ error: error.message }, 503);
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
