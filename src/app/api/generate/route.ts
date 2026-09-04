import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { buildImagePrompt, buildLoraImagePromptV1, type PromptImageInput } from "@/lib/ia/build-image-prompt";
import { LORA_CAPTION_COMPILER_VERSION } from "@/lib/ia/lora-caption-compiler";
import { compileProductPrompt, LORA_PRODUCT_RUNTIME_VERSION } from "@/lib/ia/lora-product-runtime";
import { PRODUCT_VOCABULARY } from "@/lib/lora/product-vocabulary-data";
import { findLoraPromptLanguageLeaks, preflightLoraPrompt, type LoraPromptPreflightReport } from "@/lib/ia/lora-prompt-preflight";
import { bloqueMezclaTamanos, bloqueMezclaPorEstructura, descripcionFisicaTamano } from "@/lib/ia/tamano-fisico";
import { cotizarPlan, cotizarProductos } from "@/lib/cotizacion/motor";
import { featureEnabled } from "@/lib/ia/feature-flags";
import { resolveAspectTransform } from "@/lib/ia/aspect-transform";
import { evaluateSceneQa, buildCorrectiveRetryPrompt, observarImagenGenerada, type ImageQaReport } from "@/lib/ia/image-qa";
import { imagenDe, resolverProveedor } from "@/lib/ia/registro";
import { buildApprovedSceneSpec, SceneSpecSchema, sceneSpecHash } from "@/lib/ia/scene-spec";
import { registrarEvento } from "@/lib/ia/telemetria";
import { registrarPlanAudit } from "@/lib/rag/observability/log";
import { DEFAULT_SEMPERTEX_LORA_TRIGGER, ensureLoraTriggers, generarConSempertexLora } from "@/lib/ia/sempertex-lora";
import { LoraModeSlugSchema, LoraSelectionSchema } from "@/lib/lora/schema";
import { resolveLoraMode, resolveLoraModeDatasetAllowlist, resolveLoraSelection, type ResolvedLoraApplication } from "@/lib/lora/mode-resolver";

/**
 * Guardián en el punto de uso: nunca se llama a `generarConSempertexLora` con
 * `loras` vacío o indefinido. Es cinturón y tirantes sobre la resolución de
 * más arriba — si algo cambia esa lógica y deja de garantizar la resolución,
 * esto falla antes de tocar la red en vez de caer en un fallback anónimo.
 */
function requireResolvedLoras(loras: ResolvedLoraApplication[] | undefined): ResolvedLoraApplication[] {
  if (!loras?.length) throw new Error("LORA_MODE_REQUIRED: no se pudo resolver un artifact LoRA registrado para esta generación.");
  return loras;
}
import { buildVisualContext } from "@/lib/ia/visual-context";
import { ErrorIA, type ImageInput, type Imagen, type ImagenEtiquetada, type PeticionImagen, type ProveedorId } from "@/lib/ia/tipos";
import { ReferenceBlueprintV2Schema, type ReferenceBlueprintV2 } from "@/lib/ia/reference-blueprint";
import type { ResultadoMedidas } from "@/lib/medidas/geometria";
import { resolverProductosParaGeneracion } from "@/lib/rag/generate-products";
import { productosPorIdConFuente } from "@/lib/products";
import {
  classifyNonCommercialProducts,
  NonCommercialSourceRejectedError,
  type CommercialUsageIntent,
  type NonCommercialProductClassification,
} from "@/lib/generacion/provenance";
import type { Brief, Producto } from "@/lib/types";
import { getRagPool } from "@/lib/rag/db";
import { resolverPlan } from "@/lib/plan/resolver";
import { PlanDecoracionSchema } from "@/lib/plan/tipos";
import { cajasDeEstructuras } from "@/lib/plan/ubicaciones";
import { verificarCoherenciaPrompt } from "@/lib/plan/coherencia";
import { verificarTokenAprobacion } from "@/lib/plan/aprobacion";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import {
  blockingPhysicalWarnings,
  designQuantityForProduct,
  estimateFromMeasuredMaterials,
  estimateFromPlan,
  formatMaterialEstimateLog,
  purchaseForProduct,
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
  comparar?: boolean;
  /** Depuración: compara el prompt legado v1 de la app contra el compilador v2. */
  compararLora?: boolean;
  seedLoraDebug?: number;
  /** Prueba: fuerza al proveedor base (Gemini) a generar sin ninguna imagen
   * de referencia adjunta (ni de producto, ni de espacio, ni de estilo) —
   * identidad de producto solo por texto, igual que el LoRA, pero con
   * Gemini. Sirve para aislar si el problema de composición es "falta
   * entrenamiento" o "el texto solo no alcanza ni con un modelo capaz". */
  sinReferencias?: boolean;
  medidas?: ResultadoMedidas;
  fotoEspacio?: Imagen;
  imagenesReferencia?: Imagen[];
  aspecto?: PeticionImagen["aspecto"];
  blueprint?: unknown;
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
  instruccion?: string;
  plan?: PlanResuelto;
  planHash?: string;
};

type SalidaComparacion = {
  id: "gemini" | "lora" | "lora-v1" | "lora-v2" | "lora-wrapper";
  nombre: string;
  modelo: string;
  imagen?: string;
  error?: string;
  prompt?: string;
  promptVersion?: string;
  promptHash?: string;
  compilerVersion?: string;
  seed?: number;
  qa?: ImageQaReport;
  preflight?: LoraPromptPreflightReport;
};

function textoDeError(error: unknown): string {
  return error instanceof Error ? error.message : "No se pudo generar este resultado.";
}

function hashPrompt(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex");
}

function statusDe(causa: ErrorIA["causa"]): number {
  if (causa === "sin_llave") return 503;
  if (causa === "cuota") return 429;
  if (causa === "filtrado") return 422;
  if (causa === "timeout") return 504;
  return 502;
}

async function cargarFoto(foto: string): Promise<Imagen | null> {
  try {
    if (/^https?:\/\//.test(foto)) {
      const response = await fetch(foto, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) return null;
      return { base64: Buffer.from(await response.arrayBuffer()).toString("base64"), mime: response.headers.get("content-type") ?? "image/jpeg" };
    }
    const fullPath = path.join(process.cwd(), "public", foto);
    const bytes = await readFile(fullPath);
    const ext = path.extname(fullPath).toLowerCase();
    return { base64: bytes.toString("base64"), mime: ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg" };
  } catch {
    return null;
  }
}

async function cargarFotosProducto(productos: Producto[]): Promise<Array<ImagenEtiquetada & { productoId: string }>> {
  const results = await Promise.all(productos.filter((product) => product.foto).map(async (product, index) => {
    const image = await cargarFoto(product.foto!);
    if (!image) return null;
    const packageNote = product.paquetes && product.unidadesPaquete ? ` Cotización: ${product.paquetes} paquete(s) de ${product.unidadesPaquete} unidades.` : "";
    return { ...image, id: `CATALOG_${String(index + 1).padStart(2, "0")}`, productoId: product.id, descripcion: `${product.nombre}. ${product.descripcion}.${packageNote}` };
  }));
  return results.filter((item): item is ImagenEtiquetada & { productoId: string } => item !== null);
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

function categoryForProduct(product: Producto): ReferenceBlueprintV2["elements"][number]["category"] {
  const category = `${product.categoria} ${product.nombre} ${product.descripcion}`.toLowerCase();
  if (/(mural|backdrop|fondo|pared|panel|tel[oó]n)/.test(category)) return "backdrop";
  if (/(cortina|drape|tela)/.test(category)) return "curtain";
  if (category.includes("flor")) return "floral";
  if (category.includes("mueble") || category.includes("mobil")) return "furniture";
  if (category.includes("luz") || category.includes("ilumin")) return "lighting";
  if (category.includes("mesa")) return "tableware";
  if (category.includes("arco") || category.includes("globo")) return "balloon_structure";
  return "other";
}

function sceneRoleForProduct(category: ReferenceBlueprintV2["elements"][number]["category"]): ReferenceBlueprintV2["elements"][number]["scene_role"] {
  if (["backdrop", "curtain", "drape", "panel"].includes(category)) return "backdrop";
  if (category === "lighting") return "lighting";
  if (category === "balloon_structure") return "midground";
  return "foreground";
}

function safeCatalogElementId(product: Producto, index: number): string {
  const id = product.id.replace(/[^a-z0-9_-]/gi, "_").slice(0, 56);
  return `CATALOG_${id}_${String(index + 1).padStart(2, "0")}`;
}

function catalogReferenceBox(category: ReferenceBlueprintV2["elements"][number]["category"], index: number) {
  if (["backdrop", "curtain", "drape", "panel"].includes(category)) return { x: 0.08, y: 0.08, width: 0.84, height: 0.78 };
  if (category === "lighting") return { x: 0.12, y: 0.04, width: 0.76, height: 0.68 };
  if (category === "balloon_structure") {
    if (index === 0) return { x: 0.12, y: 0.12, width: 0.76, height: 0.5 };
    return index % 2 === 0
      ? { x: 0.08, y: 0.38, width: 0.3, height: 0.5 }
      : { x: 0.62, y: 0.38, width: 0.3, height: 0.5 };
  }
  return index % 2 === 0
    ? { x: 0.08, y: 0.58, width: 0.26, height: 0.28 }
    : { x: 0.66, y: 0.58, width: 0.26, height: 0.28 };
}

function quantityForProduct(product: Producto, materialEstimate?: DesignMaterialEstimate): ReferenceBlueprintV2["elements"][number]["quantity"] {
  if (materialEstimate) {
    const estimatedQuantity = designQuantityForProduct(materialEstimate, product.id);
    return { mode: "exact", min: estimatedQuantity, max: estimatedQuantity };
  }
  const packageUnits = Math.max(1, Math.round(product.unidadesPaquete ?? 1));
  const packageCount = Math.max(1, Math.round(product.paquetes ?? 1));
  const isLooseBalloonPack = /(globo|balloon|latex|metalizado|redondo|infinity)/i.test(`${product.categoria} ${product.nombre}`);
  if (isLooseBalloonPack && packageUnits > 1) return { mode: "exact", min: packageUnits * packageCount, max: packageUnits * packageCount };
  return { mode: "approximate", min: 1, max: 1 };
}

/** Todos los productos que comparten familia (mismo producto Shopify, distinto tamaño/variante) — plan de tamaños F4. Una familia de 1 es el caso normal (sin mezcla de tamaños). */
function hermanosDeFamilia(product: Producto, lista: Producto[]): Producto[] {
  const clave = product.familiaId ?? product.id;
  return lista.filter((p) => (p.familiaId ?? p.id) === clave);
}

function catalogElement(product: Producto, index: number, familia: Producto[] = [product], materialEstimate?: DesignMaterialEstimate): ReferenceBlueprintV2["elements"][number] {
  const category = categoryForProduct(product);
  const sceneRole = sceneRoleForProduct(category);
  const backdrop = sceneRole === "backdrop";
  const lighting = sceneRole === "lighting";
  // Varios tamaños del MISMO producto (ej. R-5/R-9/R-12/R-18 de una misma
  // guirnalda, resueltos por resolverVariantesPorDespiece) deben leerse como
  // UNA sola estructura, no como piezas dispersas — comparten la misma caja
  // de referencia (la que le tocaría al índice 0 de su categoría) en vez de
  // dispersarse por índice; el vínculo "overlaps" entre hermanos se agrega
  // aparte, en addCreativeCatalogRelationships.
  const esFamiliaMultiTamano = familia.length > 1;
  const tamanoFisico = descripcionFisicaTamano(product.diamPulg, product.forma);
  return {
    element_id: safeCatalogElementId(product, index),
    source_image_id: "CATALOG_SOURCE",
    name: product.nombre,
    category,
    scene_role: sceneRole,
    detection_confidence: 1,
    visible_evidence: "Producto incluido explícitamente en la cotización automática.",
    reference_bbox: esFamiliaMultiTamano ? catalogReferenceBox(category, 0) : catalogReferenceBox(category, index),
    depth_layer: backdrop ? 1 : lighting ? 2 : 10 + index,
    include_policy: "include",
    approved: true,
    source_type: "catalog_backed",
    quantity: quantityForProduct(product, materialEstimate),
    appearance: {
      observed_colors: product.colores.slice(0, 8),
      resolved_colors: product.colores.slice(0, 8),
      color_policy: "match_reference",
      material: product.descripcion.slice(0, 160),
      shape: product.nombre.slice(0, 160),
      composition: esKitPrediseñado(product)
        ? "pre-assembled complete kit with its own finished look; keep it visually self-contained, never blend its components into another element"
        : "single uniform material",
    },
    relationships: [],
    uncertainties: [],
    model_decision: {
      action: "include",
      catalog_product_id: product.id,
      match_type: "exact",
      reason: "Producto incluido en la cotización automática; debe aparecer en la visualización.",
      adaptation: [
        "Usar este producto exacto, integrado físicamente en la escena.",
        tamanoFisico ? `Physical size: ${tamanoFisico}.` : "",
        esFamiliaMultiTamano
          ? `This is one of ${familia.length} balloon sizes that together form a SINGLE blended structure ("${product.nombre}") — group it together with its sibling sizes in the same cluster, never render as a separate isolated installation.`
          : "",
      ].filter(Boolean).join(" "),
    },
  };
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

function ensureQuotedProducts(blueprint: ReferenceBlueprintV2, products: Producto[], materialEstimate?: DesignMaterialEstimate): ReferenceBlueprintV2 {
  // Un producto puede estar representado solo como material secundario de un
  // bill_of_materials (ej. los globos verdes de un árbol cuyo material
  // principal son los rojos) — si solo se mira `catalog_product_id`, ese
  // producto parece "no representado" y termina duplicado como un elemento
  // suelto más en la escena.
  const represented = new Set(
    blueprint.elements.flatMap((element) => [
      element.model_decision?.catalog_product_id,
      ...(element.model_decision?.bill_of_materials?.map((line) => line.catalog_product_id) ?? []),
    ]).filter((id): id is string => Boolean(id)),
  );
  const missing = products.filter((product) => !represented.has(product.id));
  if (!missing.length) return blueprint;

  const sourceImages = blueprint.source_images.some((source) => source.image_id === "CATALOG_SOURCE")
    ? blueprint.source_images
    : [...blueprint.source_images, { image_id: "CATALOG_SOURCE", approved_roles: ["catalog_product_reference"] as const }];
  return ReferenceBlueprintV2Schema.parse({
    ...blueprint,
    source_images: sourceImages,
    elements: [...blueprint.elements, ...missing.map((product, index) => catalogElement(product, index, hermanosDeFamilia(product, missing), materialEstimate))],
    palette: {
      observed: [...new Set([...blueprint.palette.observed, ...products.flatMap((product) => product.colores)])].slice(0, 12),
      priority: [...new Set([...blueprint.palette.priority, ...products.flatMap((product) => product.colores)])].slice(0, 8),
    },
  });
}

function catalogBlueprint(productos: Producto[], materialEstimate?: DesignMaterialEstimate): ReferenceBlueprintV2 {
  const blueprint = ReferenceBlueprintV2Schema.parse({
    schema_version: "2.0",
    source_images: [{ image_id: "CATALOG_SOURCE", approved_roles: ["catalog_product_reference"] }],
    elements: productos.map((product, index) => catalogElement(product, index, hermanosDeFamilia(product, productos), materialEstimate)),
    /*
      element_id: `CATALOG_E${String(index + 1).padStart(2, "0")}`,
      source_image_id: "CATALOG_SOURCE",
      name: product.nombre,
      category: categoryForProduct(product),
      scene_role: "foreground",
      detection_confidence: 1,
      visible_evidence: "Explicitly selected catalog product.",
      reference_bbox: { x: 0.1 + (index % 3) * 0.28, y: 0.18 + Math.floor(index / 3) * 0.25, width: 0.24, height: 0.24 },
      depth_layer: index + 1,
      include_policy: "include",
      approved: true,
      source_type: "catalog_backed",
      quantity: { mode: "approximate", min: 1, max: 1 },
      appearance: { observed_colors: product.colores.slice(0, 8), resolved_colors: product.colores.slice(0, 8), color_policy: "match_reference", material: product.descripcion.slice(0, 160), shape: product.nombre.slice(0, 160) },
      relationships: [],
      uncertainties: [],
      model_decision: { action: "include", catalog_product_id: product.id, match_type: "exact", reason: "Producto elegido automáticamente por el asistente.", adaptation: "Conservar identidad del producto y adaptarlo al espacio." },
    })), */
    composition: { focal_point: "cohesive event installation with a strong central decorative focal point", density: productos.length >= 3 ? "dense" : "moderate", symmetry: "asymmetric", negative_space: ["clear usable floor in front of the decoration", "unoccupied venue circulation areas"] },
    palette: { observed: [...new Set(productos.flatMap((product) => product.colores))].slice(0, 12), priority: [...new Set(productos.flatMap((product) => product.colores))].slice(0, 8) },
    unresolved_decisions: [],
  });
  return addCreativeCatalogRelationships(blueprint, productos);
}

export function planBlueprint(plan: PlanResuelto): ReferenceBlueprintV2 {
  const cajas = cajasDeEstructuras(plan.plan.estructuras);
  const focal = plan.plan.estructuras.find((estructura) => estructura.rol_escena === "focal")?.estructura_id;
  const focalDeclarada = plan.plan.estructuras.find((estructura) => estructura.estructura_id === focal);
  const focalElementId = focal && focalDeclarada && focalDeclarada.repeticiones > 1 ? `${focal}#1` : focal;
  const densidad = plan.plan.estructuras.some((estructura) => estructura.densidad === "lujosa")
    ? "dense" as const
    : plan.plan.estructuras.some((estructura) => estructura.densidad === "sencilla")
      ? "sparse" as const
      : "moderate" as const;
  const elements = plan.estructuras.flatMap((resuelta) => {
    const declarada = plan.plan.estructuras.find((estructura) => estructura.estructura_id === resuelta.estructura_id)!;
    const materialPorVariante = new Map<string, { id: string; share: number; role: string; color: string | null }>();
    for (const linea of resuelta.lineas) {
      const previo = materialPorVariante.get(linea.variant_id);
      materialPorVariante.set(linea.variant_id, {
        id: linea.variant_id,
        share: (previo?.share ?? 0) + linea.unidades / Math.max(1, resuelta.total_unidades),
        role: declarada.materiales.find((material) => material.product_id === linea.product_id)?.rol_material ?? "principal",
        color: linea.color,
      });
    }
    const materiales = [...materialPorVariante.values()];
    const medidas = [declarada.medidas.ancho_m, declarada.medidas.alto_m, declarada.medidas.largo_m].filter((value): value is number => value != null).map((value) => `${value} m`).join(" × ");
    const nombreBase = medidas ? `${declarada.nombre} (${medidas})` : declarada.nombre;
    const dimensiones = {
      ...(declarada.medidas.ancho_m !== undefined ? { width: declarada.medidas.ancho_m } : {}),
      ...(declarada.medidas.alto_m !== undefined ? { height: declarada.medidas.alto_m } : {}),
      ...(declarada.medidas.largo_m !== undefined ? { length: declarada.medidas.largo_m } : {}),
    };
    const repeticiones = Math.max(1, declarada.repeticiones);
    return Array.from({ length: repeticiones }, (_, index) => {
      const elementId = repeticiones === 1 ? resuelta.estructura_id : `${resuelta.estructura_id}#${index + 1}`;
      const baseUnits = Math.floor(resuelta.total_unidades / repeticiones);
      const remainder = resuelta.total_unidades % repeticiones;
      const instanceUnits = baseUnits + (index < remainder ? 1 : 0);
      const relaciones: ReferenceBlueprintV2["elements"][number]["relationships"] = elementId === focalElementId
        ? []
        : focalElementId
          ? [{ type: declarada.tipo === "backdrop" ? "behind" as const : "aligned_with" as const, target_element_id: focalElementId }]
          : [];
      const nombre = repeticiones > 1 ? `${nombreBase} #${index + 1} de ${repeticiones}` : nombreBase;
      return {
      element_id: elementId,
      source_image_id: "PLAN_SOURCE",
      name: nombre.slice(0, 160),
      category: ["backdrop"].includes(declarada.tipo) ? "backdrop" as const : ["kit", "accesorio"].includes(declarada.tipo) ? "other" as const : "balloon_structure" as const,
      scene_role: declarada.tipo === "backdrop" ? "backdrop" as const : declarada.rol_escena === "focal" ? "midground" as const : "foreground" as const,
      detection_confidence: 1,
      visible_evidence: "Estructura declarada y resuelta por el plan de decoración.",
      reference_bbox: cajas[elementId]!.bbox,
      depth_layer: cajas[elementId]!.depthLayer,
      include_policy: "include" as const,
      approved: true,
      source_type: "catalog_backed" as const,
      quantity: { mode: "exact" as const, min: instanceUnits, max: instanceUnits },
      appearance: {
        observed_colors: [...new Set(resuelta.lineas.map((linea) => linea.color).filter((color): color is string => Boolean(color)))].slice(0, 8),
        resolved_colors: [...new Set(resuelta.lineas.map((linea) => linea.color).filter((color): color is string => Boolean(color)))].slice(0, 8),
        color_policy: "match_reference" as const,
        material: "Materiales reales del catálogo resueltos por variante.",
        shape: nombre.slice(0, 160),
        composition: materiales.map((material) => `${Math.round(material.share * 100)}% ${material.role} (${material.color ?? "color de catálogo"})`).join("; ").slice(0, 240) || "pieza de catálogo",
      },
      visual_semantics: {
        structure_type: declarada.tipo,
        placement: declarada.ubicacion,
        design_role: declarada.rol_escena === "focal" ? "focal" as const : declarada.rol_escena === "soporte" || declarada.tipo === "backdrop" ? "soporte" as const : "acento" as const,
        repetition_group: resuelta.estructura_id,
        ...(Object.keys(dimensiones).length ? { dimensions_m: dimensiones } : {}),
        density: declarada.densidad,
      },
      resolved_finishes: [...new Set(resuelta.lineas.map((linea) => linea.acabado).filter((acabado): acabado is string => Boolean(acabado)))].slice(0, 8),
      relationships: relaciones,
      uncertainties: resuelta.supuestos,
      model_decision: {
        action: "include" as const,
        catalog_product_id: materiales[0]?.id,
        match_type: "exact" as const,
        reason: declarada.porque,
        adaptation: "Construir esta estructura completa en la ubicación indicada; no renderizar los materiales como piezas aisladas.",
        bill_of_materials: materiales.map((material) => ({ catalog_product_id: material.id, role: material.role, share: Math.min(1, material.share) })),
      },
      };
    });
  });
  return ReferenceBlueprintV2Schema.parse({
    schema_version: "2.0",
    source_images: [{ image_id: "PLAN_SOURCE", approved_roles: ["composition_reference"] }],
    elements,
    composition: {
      focal_point: plan.plan.estructuras.find((estructura) => estructura.rol_escena === "focal")?.nombre ?? "instalación central",
      density: densidad,
      symmetry: "asymmetric",
      negative_space: ["circulación libre", "contacto físico con piso o mobiliario"],
    },
    palette: { observed: plan.plan.concepto.paleta.slice(0, 12), priority: plan.plan.concepto.paleta.slice(0, 8) },
    unresolved_decisions: [],
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

function automaticTargetBox(element: ReferenceBlueprintV2["elements"][number], index: number, venue: boolean) {
  if (!venue) return element.reference_bbox;
  if (element.scene_role === "backdrop" || element.category === "curtain" || element.category === "drape") return { x: 0.08, y: 0.04, width: 0.84, height: 0.82 };
  if (element.scene_role === "lighting") return { x: 0.12, y: 0.05, width: 0.76, height: 0.42 };
  if (element.scene_role === "midground" || element.category === "balloon_structure") {
    if (index === 0) return { x: 0.12, y: 0.12, width: 0.76, height: 0.5 };
    return index % 2 === 0
      ? { x: 0.08, y: 0.38, width: 0.3, height: 0.5 }
      : { x: 0.62, y: 0.38, width: 0.3, height: 0.5 };
  }
  if (element.scene_role === "foreground") return { x: 0.18, y: 0.56, width: 0.64, height: 0.34 };
  return { x: 0.08 + (index % 3) * 0.3, y: 0.16 + Math.floor(index / 3) * 0.25, width: 0.24, height: 0.28 };
}

function targetBoxesFor(blueprint: ReferenceBlueprintV2, supplied: Record<string, { x: number; y: number; width: number; height: number }> | undefined, venue: boolean): Record<string, { x: number; y: number; width: number; height: number }> {
  const boxes = { ...(supplied ?? {}) };
  const approved = blueprint.elements.filter((element) => element.approved && element.include_policy !== "exclude");
  for (const [index, element] of approved.entries()) {
    if (!boxes[element.element_id]) boxes[element.element_id] = automaticTargetBox(element, index, venue);
  }
  return boxes;
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

async function buildQa(sceneSpec: Parameters<typeof evaluateSceneQa>[0], image: Imagen, hashes: { planHash?: string; sceneSpecHash: string }, materialEstimate?: DesignMaterialEstimate): Promise<ImageQaReport> {
  const observation = await observarImagenGenerada(sceneSpec, image, materialEstimate);
  if (!observation) return { ...evaluateSceneQa(sceneSpec, {}, materialEstimate), pass: null, confidence: "unknown", observation_confidence: null, plan_hash: hashes.planHash, scene_spec_hash: hashes.sceneSpecHash, observed_instances: null };
  return { ...evaluateSceneQa(sceneSpec, observation, materialEstimate), confidence: "vision_assisted", plan_hash: hashes.planHash, scene_spec_hash: hashes.sceneSpecHash, observed_instances: observation.presentElementIds ?? [] };
}

export async function POST(request: Request) {
  const body = await request.json() as Body;
  const inicio = Date.now();
  const generationRequestId = crypto.randomUUID();
  let proveedor: ProveedorId | undefined;
  try {
    if (!featureEnabled("REFERENCE_BLUEPRINT_V2")) throw new Error("REFERENCE_BLUEPRINT_V2 is disabled.");
    const planDeclarativo = body.plan ? PlanDecoracionSchema.parse(body.plan.plan) : undefined;
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
    let planResuelto: PlanResuelto | undefined;
    let approvalContext: { requestId: string; expiresAt: number } | null = null;
    const auditarImagen = async (status: string, qa: ImageQaReport, scene: Parameters<typeof evaluateSceneQa>[0]) => {
      if (!planResuelto) return;
      await registrarPlanAudit(getRagPool(), {
         requestId: approvalContext?.requestId ?? generationRequestId,
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
         error: qa.pass === false ? qa.retry_reasons.join(" | ") : undefined,
         sceneSpecHash: qa.scene_spec_hash,
         qaHash: qa.scene_spec_hash ? `${qa.scene_spec_hash}:${qa.pass === true ? "pass" : qa.pass === false ? "fail" : "unknown"}` : undefined,
         flagSnapshot: { planCostOptimizerV2: featureEnabled("PLAN_COST_OPTIMIZER_V2"), planBudgetGateV2: featureEnabled("PLAN_BUDGET_GATE_V2"), imageInstanceQa: featureEnabled("IMAGE_INSTANCE_QA") },
      });
    };
    if (planDeclarativo) {
      const whitelist = new Map<string, Set<string>>();
      for (const producto of productosBase) {
        if (!producto.familiaId) continue;
        const variantes = whitelist.get(producto.familiaId) ?? new Set<string>();
        variantes.add(producto.id);
        whitelist.set(producto.familiaId, variantes);
      }
      planResuelto = await resolverPlan(getRagPool(), planDeclarativo, whitelist);
      if (body.planHash && body.planHash !== planResuelto.plan_hash) throw new Error("Plan hash does not match the validated server plan.");
      if (body.plan?.plan_hash !== planResuelto.plan_hash) throw new Error("Plan hash does not match the validated server plan.");
      if (planResuelto.sin_cobertura.length > 0) throw new Error("El plan tiene materiales sin cobertura en la selección validada; no se generó una imagen incoherente.");
      if (planResuelto.comercial.estado === "PRESUPUESTO_EXCEDIDO") {
        throw new Error(`PRESUPUESTO_EXCEDIDO: ${planResuelto.totales.total_cop} COP supera el techo de ${planResuelto.comercial.techo_cop} COP por ${planResuelto.comercial.delta_cop} COP.`);
      }
      approvalContext = verificarTokenAprobacion(body.plan?.approval_token, planResuelto.plan_hash);
      if (!approvalContext) throw new Error("APROBACION_REQUERIDA: el plan debe aprobarse desde la tarjeta antes de generar.");
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
        flagSnapshot: { planCostOptimizerV2: featureEnabled("PLAN_COST_OPTIMIZER_V2"), planBudgetGateV2: featureEnabled("PLAN_BUDGET_GATE_V2"), imageInstanceQa: featureEnabled("IMAGE_INSTANCE_QA") },
      });
    }
    const materialEstimateForLayout = planResuelto
      ? estimateFromPlan(planResuelto)
      : estimateFromMeasuredMaterials(body.medidas, productos);
    const preflight = validateMaterialEstimate(materialEstimateForLayout);
    if (!preflight.ok) throw new Error(`La estimación de materiales no es válida: ${preflight.errors.join("; ")}`);
    const physicalWarnings = blockingPhysicalWarnings(materialEstimateForLayout);
    if (physicalWarnings.length > 0) throw new Error(`La estimación de materiales no es compatible con la escala solicitada: ${physicalWarnings.join("; ")}`);
    if (process.env.NODE_ENV !== "production" || process.env.IMAGE_DEBUG === "true") console.info(formatMaterialEstimateLog(materialEstimateForLayout));
    const aspecto = body.aspecto ?? "3:2";
    const venue = body.fotoEspacio ? { ...body.fotoEspacio, id: "VENUE_01", descripcion: "Venue base photo. Preserve its camera, crop, architecture, perspective, and ambient lighting." } : undefined;
    if (venue && !featureEnabled("LOCALIZED_EDIT_ENABLED")) throw new Error("Localized venue editing is disabled.");
    const previous = body.previousGeneratedImage ? { ...body.previousGeneratedImage, id: "PREVIOUS_RESULT", descripcion: "Previous generated result. Use as current revision base." } : undefined;
    const references = (body.imagenesReferencia ?? []).map((image, index) => ({ ...image, id: `REF_${String(index + 1).padStart(2, "0")}`, descripcion: "Automatic model decision defines element inclusion and catalog adaptation." }));
    // Frontera de autoridad (plan de integración de referencias, R1): con un
    // plan declarativo aprobado, el plan SIEMPRE es la única fuente de
    // elementos — un blueprint de referencia adjunto (body.blueprint) usa ids
    // REF_*/CATALOG_* que no existen en las cajas del plan (EST_*) y hacía
    // fallar buildApprovedSceneSpec para cualquier cliente que adjuntara una
    // foto de inspiración junto con un plan aprobado.
    const productosParaEscena = planResuelto
      ? productos
      : productos.filter((product) => designQuantityForProduct(materialEstimateForLayout, product.id) > 0);
    const rawBlueprint = planResuelto
      ? planBlueprint(planResuelto)
      : body.blueprint
        ? ReferenceBlueprintV2Schema.parse(body.blueprint)
        : catalogBlueprint(productosParaEscena, materialEstimateForLayout);
    const decidedBlueprint = applyAutomaticDecisions(rawBlueprint, new Set(productos.map((product) => product.id)));
    // Bajo un plan, `productos` puede incluir variantes fuera de las
    // estructuras resueltas (ragVariantIds heredados del chat) — inyectarlas
    // como elementos sueltos con ensureQuotedProducts rompería el diseño que
    // el cliente ya aprobó; el plan es la única autoridad de qué se muestra.
    const blueprint = planResuelto
      ? addCreativeCatalogRelationships(decidedBlueprint, productos)
      : addCreativeCatalogRelationships(ensureQuotedProducts(decidedBlueprint, productosParaEscena, materialEstimateForLayout), productosParaEscena);
    // Bill of materials: un elemento puede necesitar varios productos reales
    // en proporciones distintas (ej. árbol de globos = 60% rojo + 30% verde +
    // 10% dorado). Se suma la cantidad de paquetes que cada producto necesita
    // en TODOS los elementos donde participa, para que la cotización refleje
    // cada material por separado en vez de asumir 1 paquete por producto.
    const paquetesPorMaterial = new Map<string, number>();
    for (const element of blueprint.elements) {
      if (!element.approved || element.source_type !== "catalog_backed") continue;
      const lineas = element.model_decision?.bill_of_materials?.length
        ? element.model_decision.bill_of_materials
        : element.model_decision?.catalog_product_id
          ? [{ catalog_product_id: element.model_decision.catalog_product_id, role: "material principal", share: 1 }]
          : [];
      const cantidadTotal = element.quantity.max || element.quantity.min || 1;
      for (const linea of lineas) {
        const producto = productos.find((candidate) => candidate.id === linea.catalog_product_id);
        if (!producto) continue;
        const unidadesNecesarias = Math.max(1, Math.round(cantidadTotal * linea.share));
        const compraEstimada = purchaseForProduct(materialEstimateForLayout, producto.id);
        const paquetesNecesarios = compraEstimada?.package_count ?? Math.max(1, Math.ceil(unidadesNecesarias / Math.max(1, producto.unidadesPaquete ?? 1)));
        paquetesPorMaterial.set(producto.id, (paquetesPorMaterial.get(producto.id) ?? 0) + paquetesNecesarios);
      }
    }
    // El cliente puede haber fijado una cantidad explícita (ej. producto
    // elegido a mano en el catálogo) — eso siempre gana sobre lo derivado
    // automáticamente del plan de referencias.
    const productosConMateriales = planResuelto
      ? productos.map((producto) => {
          const compra = planResuelto!.compras.find((item) => item.variant_id === producto.id);
          return compra ? { ...producto, paquetes: compra.paquetes, unidadesPaquete: compra.unidades_paquete } : producto;
        })
      : productos.map((producto) => {
      const explicita = body.productQuantities?.[producto.id];
      const derivada = paquetesPorMaterial.get(producto.id);
      return explicita || !derivada ? producto : { ...producto, paquetes: derivada };
       });
    const materialEstimate = planResuelto
      ? estimateFromPlan(planResuelto)
      : estimateFromMeasuredMaterials(body.medidas, productosConMateriales);
    const finalPreflight = validateMaterialEstimate(materialEstimate);
    if (!finalPreflight.ok) throw new Error(`La estimación de materiales no es válida: ${finalPreflight.errors.join("; ")}`);
    const finalPhysicalWarnings = blockingPhysicalWarnings(materialEstimate);
    if (finalPhysicalWarnings.length > 0) throw new Error(`La estimación de materiales no es compatible con la escala solicitada: ${finalPhysicalWarnings.join("; ")}`);
    if (process.env.NODE_ENV !== "production" || process.env.IMAGE_DEBUG === "true") console.info(formatMaterialEstimateLog(materialEstimate));
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
               return producto ? { id: producto.id, name: producto.nombre, description: producto.descripcion, category: producto.categoria, colors: producto.colores, unitsPerPackage: producto.unidadesPaquete, packageCount: producto.paquetes, installedUnits: Math.max(0, Math.round((element.quantity.max || element.quantity.min || 0) * linea.share)), share: linea.share, role: linea.role } : undefined;
            })
             .filter((material): material is { id: string; name: string; description: string; category: string; colors: string[]; unitsPerPackage: number | undefined; packageCount: number; installedUnits: number; share: number; role: string } => Boolean(material));
          return [element.element_id, materiales] as const;
        })
         .filter(([, materiales]) => materiales.length > 0),
    );
    // Unión, no reemplazo: las cajas del plan cubren cada EST_*, pero
    // targetBoxesFor rellena con una caja automática cualquier elemento
    // aprobado que quedara sin caja en vez de reventar buildApprovedSceneSpec.
    const cajasDelPlan = planResuelto
      ? Object.fromEntries(Object.entries(cajasDeEstructuras(planResuelto.plan.estructuras)).map(([id, layout]) => [id, layout.bbox]))
      : undefined;
    const targetBoxes = targetBoxesFor(blueprint, cajasDelPlan, Boolean(venue));
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
    });
    if (body.sceneSpec) {
      const submittedScene = SceneSpecSchema.parse(body.sceneSpec);
      if (sceneSpecHash(submittedScene) !== sceneSpecHash(sceneSpec)) throw new Error("Submitted scene specification does not match the server-approved scene.");
    }
    SceneSpecSchema.parse(sceneSpec);
    if (sceneSpec.elements.length === 0 && productos.length === 0 && !body.revisionInstruction && !body.instruccion) throw new Error("Approve at least one element before generating.");

    const parsedLoraMode = body.loraMode === undefined ? null : LoraModeSlugSchema.safeParse(body.loraMode);
    if (body.loraMode !== undefined && !parsedLoraMode?.success) throw new Error("LORA_MODE_INVALID: modo LoRA inválido.");
    const explicitLoraMode = parsedLoraMode?.success ? parsedLoraMode.data : null;
    const parsedLoraSelection = body.loraSelection === undefined ? null : LoraSelectionSchema.safeParse(body.loraSelection);
    if (body.loraSelection !== undefined && !parsedLoraSelection?.success) throw new Error("LORA_SELECTION_INVALID: selecciona un artifact producto o estructura válido.");
    if (explicitLoraMode && body.loraSelection !== undefined) throw new Error("LORA_MODE_SELECTION_CONFLICT: usa un modo o una selección manual, no ambos.");
    const explicitLoraSelection = parsedLoraSelection?.success ? parsedLoraSelection.data : null;
    const resolvedLoras = explicitLoraMode
      ? await resolveLoraMode(explicitLoraMode)
      : explicitLoraSelection
        ? await resolveLoraSelection(explicitLoraSelection)
        : undefined;
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
      const outsidePool = [...new Set(requestedIds)].filter((id) => !allowedProductIds.has(id) && !allowedVariantIds.has(id));
      if (outsidePool.length) throw new Error(`LORA_DATASET_ALLOWLIST_REJECTED: ${outsidePool.join(", ")}`);
    }
    const usarLora = body.usarLora === true || Boolean(explicitLoraSelection || explicitLoraMode);
    const comparar = body.comparar === true;
    const compararLora = body.compararLora === true;
    const sinReferencias = body.sinReferencias === true;
    // Ninguna ruta que llame a fal.ai puede usar una combinación URL/trigger
    // anónima (PLAN-COMPOSICION-RICA-V001.md §1.1/§9.2). No existe un modo
    // "por defecto" seguro para adivinar aquí: qué slot está listo depende
    // del registro (hoy, por ejemplo, `unlimited` puede estar `pending` y
    // `training_1` solo `ready` bajo el override local de pruebas), así que
    // adivinar produciría un comportamiento no determinista según el estado
    // de la base de datos. Si el turno necesita LoRA (usarLora, comparar o
    // compararLora) y el cliente no mandó `loraMode` ni `loraSelection`
    // explícitos, se falla cerrado antes de tocar la red.
    if ((usarLora || comparar || compararLora) && !resolvedLoras) {
      throw new Error("LORA_MODE_REQUIRED: especifica loraMode (\"unlimited\" | \"training_1\" | \"training_2\") o loraSelection antes de generar con LoRA Sempertex. No existe un modo por defecto anónimo.");
    }
    if ((usarLora || compararLora) && (venue || references.length || previous)) {
      throw new Error("LoRA Sempertex genera desde texto. Para editar fotos o usar referencias, cambia a Gemini.");
    }
    if (usarLora && (comparar || compararLora)) throw new Error("Elige un modo de comparación o LoRA individual, no ambos.");
    if (comparar && compararLora) throw new Error("Elige una sola comparación.");
    if (sinReferencias && (usarLora || comparar || compararLora)) {
      throw new Error("Sin-referencias es una prueba solo para Gemini base; no se combina con LoRA ni Comparar.");
    }
    proveedor = resolverProveedor({ override: body.proveedor, cookie: request.headers.get("cookie")?.match(/ia_proveedor=(gemini)/)?.[1] });
    const port = usarLora || compararLora ? null : await imagenDe(comparar ? "gemini" : proveedor);
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
    const productImages = await cargarFotosProducto(productosConMateriales);
    // LoRA Edit recibe hasta cuatro referencias visuales. Mantenemos una lista
    // más amplia aquí para resolver prioridades; el adaptador escoge las cuatro
    // mejores (espacio, productos y después composición).
    const inputLimit = usarLora ? Math.max(16, sceneSpec.elements.length) : capabilities.totalInputImageLimit;
    // sinReferencias: nada de fotos entra a buildInputs (ni producto, ni
    // espacio, ni previa, ni estilo) — así vuelve limpio {inputs: [],
    // promptInputs: []} sin disparar el chequeo de "required > portLimit".
    // La identidad del producto le llega a Gemini solo por el desglose de
    // materiales en el prompt de texto (scene-spec.ts), igual que al LoRA.
    const selected = sinReferencias
      ? buildInputs({ portLimit: 0, blueprint, sceneElements: sceneSpec.elements, references: [], venue: undefined, previous: undefined, products: [] })
      : buildInputs({ portLimit: inputLimit, blueprint, sceneElements: sceneSpec.elements, references, venue, previous, products: productImages });
    const visualContext = buildVisualContext({
      brief: body.brief,
      userRequest: body.solicitudUsuario,
      approvedPlan: planResuelto?.plan.estructuras.map((estructura) => `${estructura.nombre} (${estructura.tipo}, ${estructura.ubicacion})`),
      approvedMaterials: planResuelto?.compras.map((compra) => {
        const product = productosConMateriales.find((candidate) => candidate.id === compra.variant_id);
        return product ? `${product.nombre}${product.colores.length ? ` — ${product.colores.join(", ")}` : ""}` : undefined;
      }).filter((material): material is string => Boolean(material)),
      pieceMatchLevels: blueprint.elements
        .filter((element) => element.model_decision?.catalog_product_id && element.model_decision.match_type !== "none")
        .map((element) => ({
          piece: element.name,
          match_level: element.model_decision?.match_type === "exact" ? "exacto" : "adaptable",
        })),
    });
    const revisionInstruction = body.revisionInstruction ?? body.instruccion;
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
    const sizeMixBlock = planResuelto
      ? bloqueMezclaPorEstructura(planResuelto.estructuras.map((estructura) => ({
          estructura_id: estructura.estructura_id,
          nombre: estructura.nombre,
          total_unidades: estructura.total_unidades,
          mezcla_real: estructura.mezcla_real.map((linea) => ({ diamPulg: linea.diam_pulg, forma: linea.forma, unidades: linea.unidades, pct: linea.pct })),
        }))) ?? undefined
      : bloqueMezclaTamanos([...unidadesPorTamano.values()]) ?? undefined;
    const providerPrompt = buildImagePrompt({ sceneSpec: transformedSceneSpec, inputs: selected.promptInputs, revisionInstruction, visualContext, sizeMixBlock, droppedCatalogReferenceCount: selected.droppedCatalogProductIds.length, droppedCompositionReferenceCount: selected.droppedReferenceCount });
    if (planResuelto) {
      const coherencia = verificarCoherenciaPrompt(providerPrompt, planResuelto);
      if (!coherencia.ok) throw new Error(`El prompt no coincide con el plan resuelto: ${coherencia.errores.join("; ")}`);
    }
    // Fail closed before opening a paid provider call. An approved plan must
    // have an observable instance-QA path, not a post-generation warning.
    if (planResuelto && !featureEnabled("IMAGE_INSTANCE_QA")) {
      throw new Error("IMAGE_QA_REQUIRED: activa IMAGE_INSTANCE_QA para generar un plan aprobado.");
    }
    // The quote is finalized before the paid provider call. The image receives
    // the same estimate snapshot, but never gets package capacity as visual
    // quantity.
    const cotizacion = planResuelto ? cotizarPlan(planResuelto) : cotizarProductos(productosConMateriales, materialEstimate);
    // La identidad del producto se resuelve desde el vocabulario allowlisted
    // de v007. El compilador solo recibe etiquetas ya resueltas; nunca infiere
    // una etiqueta canónica desde color, SKU o nombre libre.
    const sizeConfirmations = materialEstimate.balloons.flatMap((line) => {
      const elementId = line.structure_id;
      const selectedProductId = line.variant_id ?? line.product_id;
      if (!elementId || !selectedProductId) return [];
      const product = productosConMateriales.find((candidate) =>
        candidate.id === selectedProductId ||
        candidate.familiaId === line.product_id ||
        candidate.familiaId === selectedProductId,
      );
      return product?.tamanoCodigo
        ? [{ elementId, productId: selectedProductId, sizeCode: product.tamanoCodigo, diameterInches: product.diamPulg }]
        : [];
    });
    const productIdAliases = new Map<string, string[]>();
    for (const product of productosConMateriales) {
      const aliases = [product.catalogSku, product.familiaId]
        .filter((id): id is string => Boolean(id && id !== product.id));
      if (aliases.length) {
        productIdAliases.set(product.id, aliases);
      }
    }
    const productPromptCompilation = compileProductPrompt({
      sceneSpec: transformedSceneSpec,
      visualContext,
      vocabulary: PRODUCT_VOCABULARY,
      sizeConfirmations,
      productIdAliases,
    });
    const loraCompilation = {
      prompt: productPromptCompilation.prompt,
      clauses: productPromptCompilation.clauses,
      compilerVersion: productPromptCompilation.captionCompilerVersion,
    };
    const catalogBackedElementCount = transformedSceneSpec.elements.filter((element) => element.source_type === "catalog_backed").length;
    if ((usarLora || compararLora) && (productPromptCompilation.unresolved_products.length || (catalogBackedElementCount > 0 && productPromptCompilation.legacy))) {
      const unresolved = productPromptCompilation.unresolved_products.map((product) => product.product_id ?? product.title ?? "unknown");
      throw new Error(`LORA_PRODUCT_VOCABULARY_FAILED: no se pudo resolver identidad canónica para ${unresolved.join(", ") || "uno o más productos visibles"}.`);
    }
    const loraPromptV2 = loraCompilation.prompt;
    const loraPromptV1 = buildLoraImagePromptV1({ sceneSpec: transformedSceneSpec, visualContext, revisionInstruction });
    const requestedLoraVersion = process.env.LORA_PROMPT_VERSION === "v1" ? "v1" : "v2";
    const loraPrompt = requestedLoraVersion === "v1" ? loraPromptV1 : loraPromptV2;
    // Fuera de usarLora/comparar/compararLora no hay LoRA resuelto (ni falta
    // que haga: es una generación Gemini pura). effectiveLoraPrompt/loraPreflight
    // solo se usan más abajo cuando alguno de esos tres es cierto, y en ese
    // caso resolvedLoras ya quedó garantizado arriba.
    const effectiveLoraPrompt = resolvedLoras?.length ? ensureLoraTriggers(loraPrompt, resolvedLoras) : loraPrompt;
    const loraPreflight = preflightLoraPrompt({
      sceneSpec: transformedSceneSpec,
      clauses: loraCompilation.clauses,
      prompt: effectiveLoraPrompt,
      triggers: resolvedLoras?.length ? resolvedLoras.map((lora) => lora.trigger) : [DEFAULT_SEMPERTEX_LORA_TRIGGER],
      vocabulary: PRODUCT_VOCABULARY,
    });
    const promptsGeneracion: Record<string, string> = compararLora
      ? { "LoRA · app v1": loraPromptV1, "LoRA · app v2": loraPromptV2 }
      : comparar
        ? { "Gemini · Nano Banana 2": providerPrompt, "LoRA Sempertex": effectiveLoraPrompt }
        : usarLora
          ? { "LoRA Sempertex": effectiveLoraPrompt }
          : { "Gemini · Nano Banana 2": providerPrompt };
    const promptPrincipal = compararLora ? loraPromptV2 : usarLora ? effectiveLoraPrompt : providerPrompt;
    const loraLanguageLeaks = [...new Set([
      ...findLoraPromptLanguageLeaks(loraPromptV1),
      ...findLoraPromptLanguageLeaks(loraPromptV2),
    ])];
    if ((usarLora || comparar || compararLora) && loraLanguageLeaks.length) {
      throw new Error(`LORA_LANGUAGE_FAILED: el prompt contiene texto español sin traducir (${loraLanguageLeaks.join(", ")})`);
    }
    // `compararLora` always sends loraPromptV2 to fal.ai as its "lora-v2"
    // variant regardless of LORA_PROMPT_VERSION, so it must be gated
    // unconditionally — only usarLora/comparar respect the rollback flag via
    // `loraPrompt`.
    if (((usarLora || comparar) && requestedLoraVersion === "v2" || compararLora) && !loraPreflight.ok) {
      throw new Error(`LORA_PREFLIGHT_FAILED: ${loraPreflight.errors.join("; ")}`);
    }
    const seedLoraDebug = Number.isInteger(body.seedLoraDebug) && body.seedLoraDebug! >= 0 ? body.seedLoraDebug : undefined;
    let result: { imagen: Imagen; interactionId?: string };
    let comparacion: SalidaComparacion[] | undefined;
    // Solo tiene sentido encadenar contexto real cuando esta petición ES una
    // revisión de una imagen previa (mismo criterio que `revisionMode`); una
    // generación nueva de cero no debe heredar la conversación de otra.
    const previousInteractionId = previous ? body.previousInteractionId : undefined;
    let qa: ImageQaReport | undefined;
    if (compararLora) {
      const sharedSeed = seedLoraDebug ?? Math.floor(Math.random() * 2_147_483_647);
      const loraVariants = [
        { id: "lora-v1" as const, nombre: "LoRA app v1", modelo: "Prompt legado de la app", prompt: loraPromptV1 },
        { id: "lora-v2" as const, nombre: "LoRA app v2", modelo: `Caption compiler ${LORA_CAPTION_COMPILER_VERSION}`, prompt: loraPromptV2 },
      ];
      const compararLoraApplications = requireResolvedLoras(resolvedLoras);
      const variantResults = await Promise.allSettled(loraVariants.map((variant) => generarConSempertexLora(variant.prompt, aspecto, [], { seed: sharedSeed, loras: compararLoraApplications })));
      const variantImages = variantResults.map((variantResult) => variantResult.status === "fulfilled" ? variantResult.value : undefined);
      const variantQa = await Promise.all(variantImages.map((image) => image
        ? buildQa(transformedSceneSpec, image, { planHash: planResuelto?.plan_hash, sceneSpecHash: resolvedSceneSpecHash }, materialEstimate)
        : Promise.resolve(undefined)));
      await Promise.all(variantQa.map((candidateQa, index) => candidateQa
        ? auditarImagen(`IMAGEN_QA_${loraVariants[index]!.id.toUpperCase()}`, candidateQa, transformedSceneSpec)
        : Promise.resolve()));
      comparacion = loraVariants.map((variant, index) => {
        const settled = variantResults[index]!;
        const image = variantImages[index];
        return {
          id: variant.id,
          nombre: variant.nombre,
          modelo: variant.modelo,
          prompt: variant.prompt,
          imagen: image ? `data:${image.mime};base64,${image.base64}` : undefined,
          error: settled.status === "rejected" ? textoDeError(settled.reason) : undefined,
          promptVersion: variant.id === "lora-v1" ? "v1" : "v2",
          promptHash: hashPrompt(variant.prompt),
          compilerVersion: variant.id === "lora-v2" ? LORA_CAPTION_COMPILER_VERSION : undefined,
          seed: sharedSeed,
          qa: variantQa[index],
          preflight: variant.id === "lora-v2" ? loraPreflight : preflightLoraPrompt({ sceneSpec: transformedSceneSpec, clauses: loraCompilation.clauses, prompt: loraPromptV1 }),
        };
      });
      const principalIndex = variantImages[1] ? 1 : variantImages.findIndex(Boolean);
      const imagenPrincipal = principalIndex >= 0 ? variantImages[principalIndex] : undefined;
      if (!imagenPrincipal) throw new Error("No se pudo generar ninguna comparación LoRA.");
      qa = principalIndex >= 0 ? variantQa[principalIndex] : undefined;
      result = { imagen: imagenPrincipal };
    } else if (comparar) {
      const [gemini, lora] = await Promise.allSettled([
        port!.generar({ prompt: providerPrompt, sceneSpec: transformedSceneSpec, inputs: selected.inputs, aspecto, calidad: "alta", previousGeneratedImage: previous, previousInteractionId, revisionMode: previous ? "revise_current_result" : "new_generation" }),
        generarConSempertexLora(effectiveLoraPrompt, aspecto, selected.inputs, { loras: requireResolvedLoras(resolvedLoras) }),
      ]);
      const geminiImagen = gemini.status === "fulfilled" ? gemini.value.imagen : undefined;
      const loraImagen = lora.status === "fulfilled" ? lora.value : undefined;
      comparacion = [
        {
          id: "gemini",
          nombre: "Gemini",
          modelo: gemini.status === "fulfilled" ? gemini.value.modelo : "Gemini · Nano Banana 2",
          imagen: geminiImagen ? `data:${geminiImagen.mime};base64,${geminiImagen.base64}` : undefined,
          error: gemini.status === "rejected" ? textoDeError(gemini.reason) : undefined,
        },
        {
          id: "lora",
          nombre: "LoRA Sempertex",
          modelo: "FLUX.2 [dev] · fal.ai",
          imagen: loraImagen ? `data:${loraImagen.mime};base64,${loraImagen.base64}` : undefined,
          error: lora.status === "rejected" ? textoDeError(lora.reason) : undefined,
        },
      ];
      const imagenPrincipal = geminiImagen ?? loraImagen;
      if (!imagenPrincipal) {
        throw new Error(`No se pudo generar ninguna de las dos imágenes. Gemini: ${textoDeError(gemini.status === "rejected" ? gemini.reason : undefined)} LoRA: ${textoDeError(lora.status === "rejected" ? lora.reason : undefined)}`);
      }
      result = { imagen: imagenPrincipal, interactionId: gemini.status === "fulfilled" ? gemini.value.interactionId : undefined };
    } else {
      result = usarLora
        ? { imagen: await generarConSempertexLora(effectiveLoraPrompt, aspecto, selected.inputs, { loras: requireResolvedLoras(resolvedLoras) }) }
        : await port!.generar({ prompt: providerPrompt, sceneSpec: transformedSceneSpec, inputs: selected.inputs, aspecto, calidad: "alta", previousGeneratedImage: previous, previousInteractionId, revisionMode: previous ? "revise_current_result" : "new_generation" });
    }
    qa ??= await buildQa(transformedSceneSpec, result.imagen, { planHash: planResuelto?.plan_hash, sceneSpecHash: resolvedSceneSpecHash }, materialEstimate);
    let retried = false;
    if (!usarLora && !comparar && !compararLora && featureEnabled("IMAGE_QA_ENABLED") && qa.pass === false) {
      const retryPrompt = `${providerPrompt}\n\n${buildCorrectiveRetryPrompt(qa)}`;
      const retry = await port!.generar({ prompt: retryPrompt, sceneSpec: transformedSceneSpec, inputs: selected.inputs, aspecto, calidad: "alta", previousGeneratedImage: { ...result.imagen, id: "GENERATED_RESULT", descripcion: "Current generated result for one corrective retry." }, previousInteractionId: result.interactionId, revisionMode: "revise_current_result" });
      retried = true;
      qa = await buildQa(transformedSceneSpec, retry.imagen, { planHash: planResuelto?.plan_hash, sceneSpecHash: resolvedSceneSpecHash }, materialEstimate);
      await auditarImagen("IMAGEN_QA_RETRY", qa, transformedSceneSpec);
      if (qa.pass !== true) return Response.json({ error: `NON_CONFORME: la imagen no cumple la cardinalidad o composición aprobada${qa.retry_reasons.length ? ` — ${qa.retry_reasons.join("; ")}` : ""}.`, qa, plan: planResuelto, sceneSpec: transformedSceneSpec, sceneSpecHash: resolvedSceneSpecHash }, { status: 422 });
      return Response.json({ imagen: `data:${retry.imagen.mime};base64,${retry.imagen.base64}`, sceneSpec: transformedSceneSpec, sceneSpecHash: resolvedSceneSpecHash, blueprint, plan: planResuelto, qa, retried, proveedor, cotizacion, interactionId: retry.interactionId, prompt: retryPrompt, prompts: { "Gemini · Nano Banana 2": retryPrompt }, productAuthority: productAuthority.length ? productAuthority : undefined });
    }
    await auditarImagen("IMAGEN_QA", qa, transformedSceneSpec);
    // Mientras se evalúa el LoRA v2 (sin retry automático como el camino
    // Gemini), no bloqueamos con 422: se devuelve igual la imagen para poder
    // verla, con el QA en pass:false para que el frontend siga mostrando la
    // advertencia "no conforme" en vez de esconder el resultado.
    if (planResuelto && qa.pass !== true && !usarLora && !compararLora) return Response.json({ error: `NON_CONFORME: la imagen no fue observada conforme al plan aprobado${qa.retry_reasons.length ? ` — ${qa.retry_reasons.join("; ")}` : ""}.`, qa, plan: planResuelto, sceneSpec: transformedSceneSpec, sceneSpecHash: resolvedSceneSpecHash }, { status: 422 });
    registrarEvento({ proveedor, operacion: "imagen", ms: Date.now() - inicio, resultado: "ok" });
    const debug = process.env.NODE_ENV !== "production" || process.env.IMAGE_DEBUG === "true";
    return Response.json({ imagen: `data:${result.imagen.mime};base64,${result.imagen.base64}`, comparacion, sceneSpec: transformedSceneSpec, sceneSpecHash: resolvedSceneSpecHash, blueprint, plan: planResuelto, qa, loraPreflight: (usarLora || comparar || compararLora) ? loraPreflight : undefined, loraPromptVersion: requestedLoraVersion, loraPromptHash: hashPrompt(effectiveLoraPrompt), compilerVersion: LORA_CAPTION_COMPILER_VERSION, loraProductRuntimeVersion: LORA_PRODUCT_RUNTIME_VERSION, productPromptCompilation: { resolved_concepts: productPromptCompilation.resolved_concepts, unresolved_products: productPromptCompilation.unresolved_products, vocabulary_version: productPromptCompilation.vocabulary_version, compiler_version: productPromptCompilation.compiler_version, legacy: productPromptCompilation.legacy, diagnostics: productPromptCompilation.diagnostics }, retried, proveedor: comparar ? "gemini" : proveedor, modoImagen: compararLora ? "comparacion_lora" : comparar ? "comparacion" : usarLora ? "lora" : "proveedor_base", cotizacion, interactionId: result.interactionId, prompt: promptPrincipal, prompts: promptsGeneracion, productAuthority: productAuthority.length ? productAuthority : undefined, ...(debug ? { visualContext, droppedImageIds: selected.droppedImageIds, aspectTransform, loraSelection: resolvedLoras?.map((lora) => ({ artifactId: lora.artifactId, specialization: lora.specialization, scale: lora.scale, trigger: lora.trigger })) } : {}) });
  } catch (error) {
    if (error instanceof Error && /^LORA_(?:MODE|SELECTION|ARTIFACT|SPECIALIZATION|RUN|EVALUATION|PROVIDER|INCOMPATIBLE|MULTI|DATASET_ALLOWLIST|PRODUCT_VOCABULARY)/.test(error.message)) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof NonCommercialSourceRejectedError) {
      return Response.json({ error: error.message, causa: "fuente_no_comercial", productId: error.productId, source: error.source, referenceClass: error.referenceClass }, { status: 403 });
    }
    if (error instanceof ErrorIA) {
      registrarEvento({ proveedor: proveedor ?? error.proveedor, operacion: "imagen", ms: Date.now() - inicio, resultado: "error", error: error.message });
      return Response.json({ error: error.message, causa: error.causa, proveedor: error.proveedor }, { status: statusDe(error.causa) });
    }
    return Response.json({ error: error instanceof Error ? error.message : "Image generation failed." }, { status: 400 });
  }
}
