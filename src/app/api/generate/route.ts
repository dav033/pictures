import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildImagePrompt, buildLoraImagePrompt, type PromptImageInput } from "@/lib/ia/build-image-prompt";
import { bloqueMezclaTamanos, descripcionFisicaTamano } from "@/lib/ia/tamano-fisico";
import { cotizarProductos } from "@/lib/cotizacion/motor";
import { featureEnabled } from "@/lib/ia/feature-flags";
import { resolveAspectTransform } from "@/lib/ia/aspect-transform";
import { evaluateSceneQa, buildCorrectiveRetryPrompt, type ImageQaReport } from "@/lib/ia/image-qa";
import { imagenDe, resolverProveedor } from "@/lib/ia/registro";
import { buildApprovedSceneSpec, SceneSpecSchema, sceneSpecHash } from "@/lib/ia/scene-spec";
import { registrarEvento } from "@/lib/ia/telemetria";
import { generarConSempertexLora } from "@/lib/ia/sempertex-lora";
import { buildVisualContext } from "@/lib/ia/visual-context";
import { ErrorIA, type ImageInput, type Imagen, type ImagenEtiquetada, type PeticionImagen, type ProveedorId } from "@/lib/ia/tipos";
import { ReferenceBlueprintV2Schema, type ReferenceBlueprintV2 } from "@/lib/ia/reference-blueprint";
import type { ResultadoMedidas } from "@/lib/medidas/geometria";
import { productosPorId } from "@/lib/products";
import type { Brief, Producto } from "@/lib/types";

export const maxDuration = 120;

type Body = {
  productIds?: string[];
  productQuantities?: Record<string, number>;
  /** Piezas que el cliente agregó a mano en el chat (no existen en el
   * catálogo real): llegan con sus datos completos, no un id a resolver, así
   * que se suman directo a `productos` sin pasar por `productosPorId`. */
  manualProducts?: Producto[];
  brief?: Brief;
  solicitudUsuario?: string;
  proveedor?: string;
  usarLora?: boolean;
  comparar?: boolean;
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
};

type SalidaComparacion = {
  id: "gemini" | "lora";
  nombre: string;
  modelo: string;
  imagen?: string;
  error?: string;
};

function textoDeError(error: unknown): string {
  return error instanceof Error ? error.message : "No se pudo generar este resultado.";
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

function quantityForProduct(product: Producto): ReferenceBlueprintV2["elements"][number]["quantity"] {
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

function catalogElement(product: Producto, index: number, familia: Producto[] = [product]): ReferenceBlueprintV2["elements"][number] {
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
    quantity: quantityForProduct(product),
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

function ensureQuotedProducts(blueprint: ReferenceBlueprintV2, products: Producto[]): ReferenceBlueprintV2 {
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
    elements: [...blueprint.elements, ...missing.map((product, index) => catalogElement(product, index, hermanosDeFamilia(product, missing)))],
    palette: {
      observed: [...new Set([...blueprint.palette.observed, ...products.flatMap((product) => product.colores)])].slice(0, 12),
      priority: [...new Set([...blueprint.palette.priority, ...products.flatMap((product) => product.colores)])].slice(0, 8),
    },
  });
}

function catalogBlueprint(productos: Producto[]): ReferenceBlueprintV2 {
  const blueprint = ReferenceBlueprintV2Schema.parse({
    schema_version: "2.0",
    source_images: [{ image_id: "CATALOG_SOURCE", approved_roles: ["catalog_product_reference"] }],
    elements: productos.map((product, index) => catalogElement(product, index, hermanosDeFamilia(product, productos))),
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
}): { inputs: ImageInput[]; promptInputs: PromptImageInput[]; droppedImageIds: string[] } {
  // `catalog_product_ids` trae TODOS los materiales de un elemento (ej. rojo
  // + verde + dorado de un árbol de globos) — usar solo `catalog_product_id`
  // aquí dejaría fuera las fotos de los materiales secundarios, y el modelo
  // de imagen nunca vería su color/textura real.
  const requiredProductIds = new Set(input.sceneElements.flatMap((element) => element.catalog_product_ids?.length ? element.catalog_product_ids : [element.catalog_product_id]).filter((id): id is string => Boolean(id)));
  const candidates: ImageInput[] = [];
  if (input.previous) candidates.push({ ...input.previous, role: "previous_generated_result", priority: 0, allowed_use: "Current generated result is the edit base for this revision only." });
  if (input.venue) candidates.push({ ...input.venue, role: "venue_base", priority: 1, allowed_use: "Venue identity: camera, crop, architecture, perspective, and light." });
  for (const product of input.products) {
    if (!requiredProductIds.has(product.productoId)) continue;
    candidates.push({ ...product, role: "catalog_product_reference", priority: 3, allowed_use: "Product identity only: exact color, shape, material, print, and distinguishing details; re-render physically using the full quoted package quantity." });
  }
  // Se conserva una referencia visual al final de la lista para dar contexto
  // de encuadre y densidad. El prompt prohíbe usarla como catálogo de objetos.
  for (const reference of input.references) {
    candidates.push({ ...reference, role: "composition_reference", priority: 4, allowed_use: "Composition inspiration only: framing, spatial relationships, density, backdrop geometry, and lighting placement. Do not copy or add any object from this image." });
  }
  const ordered = candidates.sort((a, b) => a.priority - b.priority);
  if (ordered.length > input.portLimit) {
    const required = ordered.filter((candidate) => candidate.priority <= 3);
    if (required.length > input.portLimit) throw new Error(`Approved scene needs ${required.length} image inputs, provider limit is ${input.portLimit}.`);
    ordered.splice(input.portLimit);
  }
  const used = new Set(ordered.map((item) => item.id));
  return {
    inputs: ordered,
    promptInputs: ordered.map((item) => ({ image_id: item.id, role: item.role, allowed_use: item.allowed_use })),
    droppedImageIds: [...input.references.map((reference) => reference.id), ...input.products.map((product) => product.id)].filter((id) => !used.has(id)),
  };
}

function buildQa(sceneSpec: Parameters<typeof evaluateSceneQa>[0]): ImageQaReport {
  const report = evaluateSceneQa(sceneSpec, { presentElementIds: sceneSpec.elements.map((element) => element.element_id) });
  return { ...report, confidence: "unknown" };
}

export async function POST(request: Request) {
  const body = await request.json() as Body;
  const inicio = Date.now();
  let proveedor: ProveedorId | undefined;
  try {
    if (!featureEnabled("REFERENCE_BLUEPRINT_V2")) throw new Error("REFERENCE_BLUEPRINT_V2 is disabled.");
    const productosBase = await productosPorId(body.productIds ?? []);
    if ((body.productIds ?? []).length && productosBase.length !== new Set(body.productIds).size) throw new Error("One or more selected catalog products could not be validated.");
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
    const aspecto = body.aspecto ?? "3:2";
    const venue = body.fotoEspacio ? { ...body.fotoEspacio, id: "VENUE_01", descripcion: "Venue base photo. Preserve its camera, crop, architecture, perspective, and ambient lighting." } : undefined;
    if (venue && !featureEnabled("LOCALIZED_EDIT_ENABLED")) throw new Error("Localized venue editing is disabled.");
    const previous = body.previousGeneratedImage ? { ...body.previousGeneratedImage, id: "PREVIOUS_RESULT", descripcion: "Previous generated result. Use as current revision base." } : undefined;
    const references = (body.imagenesReferencia ?? []).map((image, index) => ({ ...image, id: `REF_${String(index + 1).padStart(2, "0")}`, descripcion: "Automatic model decision defines element inclusion and catalog adaptation." }));
    const rawBlueprint = body.blueprint ? ReferenceBlueprintV2Schema.parse(body.blueprint) : catalogBlueprint(productos);
    const blueprint = addCreativeCatalogRelationships(ensureQuotedProducts(applyAutomaticDecisions(rawBlueprint, new Set(productos.map((product) => product.id))), productos), productos);
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
        const paquetesNecesarios = Math.max(1, Math.ceil(unidadesNecesarias / Math.max(1, producto.unidadesPaquete ?? 1)));
        paquetesPorMaterial.set(producto.id, (paquetesPorMaterial.get(producto.id) ?? 0) + paquetesNecesarios);
      }
    }
    // El cliente puede haber fijado una cantidad explícita (ej. producto
    // elegido a mano en el catálogo) — eso siempre gana sobre lo derivado
    // automáticamente del plan de referencias.
    const productosConMateriales = productos.map((producto) => {
      const explicita = body.productQuantities?.[producto.id];
      const derivada = paquetesPorMaterial.get(producto.id);
      return explicita || !derivada ? producto : { ...producto, paquetes: derivada };
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
              return producto ? { id: producto.id, name: producto.nombre, description: producto.descripcion, category: producto.categoria, colors: producto.colores, unitsPerPackage: producto.unidadesPaquete, packageCount: producto.paquetes, share: linea.share, role: linea.role } : undefined;
            })
            .filter((material): material is { id: string; name: string; description: string; category: string; colors: string[]; unitsPerPackage: number | undefined; packageCount: number; share: number; role: string } => Boolean(material));
          return [element.element_id, materiales] as const;
        })
        .filter(([, materiales]) => materiales.length > 0),
    );
    const targetBoxes = targetBoxesFor(blueprint, undefined, Boolean(venue));
    const sceneSpec = buildApprovedSceneSpec({
      blueprint,
      aspectRatio: aspecto,
      venueImageId: venue?.id,
      targetBoxes,
      eventPalette: body.brief?.colores,
      catalogProducts,
      protectedRegions: body.protectedRegions,
      editableRegions: body.editableRegions,
      generationMode: previous ? "revise_current_result" : venue ? "edit_venue" : "text_to_image",
      createdBy: previous ? "revision" : "server_default",
      catalogOnly: true,
    });
    if (body.sceneSpec) {
      const submittedScene = SceneSpecSchema.parse(body.sceneSpec);
      const submittedIds = submittedScene.elements.map((element) => element.element_id).sort().join(",");
      const rebuiltIds = sceneSpec.elements.map((element) => element.element_id).sort().join(",");
      if (submittedIds !== rebuiltIds) throw new Error("Submitted scene specification does not match approved elements.");
    }
    SceneSpecSchema.parse(sceneSpec);
    if (sceneSpec.elements.length === 0 && productos.length === 0 && !body.revisionInstruction && !body.instruccion) throw new Error("Approve at least one element before generating.");

    const usarLora = body.usarLora === true;
    const comparar = body.comparar === true;
    const sinReferencias = body.sinReferencias === true;
    if (usarLora && (venue || references.length || previous)) {
      throw new Error("LoRA Sempertex genera desde texto. Para editar fotos o usar referencias, cambia a Gemini.");
    }
    if (usarLora && comparar) throw new Error("El modo Comparar ya incluye LoRA; elige Comparar en vez de LoRA individual.");
    if (sinReferencias && (usarLora || comparar)) {
      throw new Error("Sin-referencias es una prueba solo para Gemini base; no se combina con LoRA ni Comparar.");
    }
    proveedor = resolverProveedor({ override: body.proveedor, cookie: request.headers.get("cookie")?.match(/ia_proveedor=(gemini)/)?.[1] });
    const port = usarLora ? null : await imagenDe(comparar ? "gemini" : proveedor);
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
    const visualContext = buildVisualContext({ brief: body.brief, userRequest: body.solicitudUsuario });
    const revisionInstruction = body.revisionInstruction ?? body.instruccion;
    // Mezcla de tamaños REAL de lo cotizado (plan de tamaños F4) — se agrega
    // directo de `productosConMateriales` (post-sustitución de
    // resolverVariantesPorDespiece cuando aplicó) en vez de recalcularla del
    // despiece pedido: si un tamaño exacto no existía y se sustituyó por el
    // más cercano, el prompt debe reflejar lo que de verdad se va a cobrar y
    // mostrar, no lo que se pidió originalmente.
    const unidadesPorTamano = new Map<string, { diamPulg: number; forma: string | null; cantidad: number }>();
    for (const producto of productosConMateriales) {
      if (producto.diamPulg == null) continue;
      const clave = `${producto.forma ?? "redondo"}:${producto.diamPulg}`;
      const unidadesFisicas = Math.max(1, Math.round(producto.unidadesPaquete ?? 1)) * Math.max(1, Math.round(producto.paquetes ?? 1));
      const existente = unidadesPorTamano.get(clave);
      unidadesPorTamano.set(clave, { diamPulg: producto.diamPulg, forma: producto.forma ?? null, cantidad: (existente?.cantidad ?? 0) + unidadesFisicas });
    }
    const sizeMixBlock = bloqueMezclaTamanos([...unidadesPorTamano.values()]) ?? undefined;
    const providerPrompt = buildImagePrompt({ sceneSpec: transformedSceneSpec, inputs: selected.promptInputs, revisionInstruction, visualContext, sizeMixBlock });
    const loraPrompt = buildLoraImagePrompt({ sceneSpec: transformedSceneSpec, visualContext, revisionInstruction });
    let result: { imagen: Imagen; interactionId?: string };
    let comparacion: SalidaComparacion[] | undefined;
    // Solo tiene sentido encadenar contexto real cuando esta petición ES una
    // revisión de una imagen previa (mismo criterio que `revisionMode`); una
    // generación nueva de cero no debe heredar la conversación de otra.
    const previousInteractionId = previous ? body.previousInteractionId : undefined;
    if (comparar) {
      const [gemini, lora] = await Promise.allSettled([
        port!.generar({ prompt: providerPrompt, sceneSpec: transformedSceneSpec, inputs: selected.inputs, aspecto, calidad: "alta", previousGeneratedImage: previous, previousInteractionId, revisionMode: previous ? "revise_current_result" : "new_generation" }),
        generarConSempertexLora(loraPrompt, aspecto, selected.inputs),
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
        ? { imagen: await generarConSempertexLora(loraPrompt, aspecto, selected.inputs) }
        : await port!.generar({ prompt: providerPrompt, sceneSpec: transformedSceneSpec, inputs: selected.inputs, aspecto, calidad: "alta", previousGeneratedImage: previous, previousInteractionId, revisionMode: previous ? "revise_current_result" : "new_generation" });
    }
    const cotizacion = cotizarProductos(productosConMateriales);
    let qa = buildQa(transformedSceneSpec);
    let retried = false;
    if (!usarLora && !comparar && featureEnabled("IMAGE_QA_ENABLED") && !qa.pass) {
      const retryPrompt = `${providerPrompt}\n\n${buildCorrectiveRetryPrompt(qa)}`;
      const retry = await port!.generar({ prompt: retryPrompt, sceneSpec: transformedSceneSpec, inputs: selected.inputs, aspecto, calidad: "alta", previousGeneratedImage: { ...result.imagen, id: "GENERATED_RESULT", descripcion: "Current generated result for one corrective retry." }, previousInteractionId: result.interactionId, revisionMode: "revise_current_result" });
      retried = true;
      qa = buildQa(transformedSceneSpec);
      return Response.json({ imagen: `data:${retry.imagen.mime};base64,${retry.imagen.base64}`, sceneSpec: transformedSceneSpec, sceneSpecHash: resolvedSceneSpecHash, blueprint, qa, retried, proveedor, cotizacion, interactionId: retry.interactionId });
    }
    registrarEvento({ proveedor, operacion: "imagen", ms: Date.now() - inicio, resultado: "ok" });
    const debug = process.env.NODE_ENV !== "production" || process.env.IMAGE_DEBUG === "true";
    return Response.json({ imagen: `data:${result.imagen.mime};base64,${result.imagen.base64}`, comparacion, sceneSpec: transformedSceneSpec, sceneSpecHash: resolvedSceneSpecHash, blueprint, qa, retried, proveedor: comparar ? "gemini" : proveedor, modoImagen: comparar ? "comparacion" : usarLora ? "lora" : "proveedor_base", cotizacion, interactionId: result.interactionId, ...(debug ? { prompt: providerPrompt, prompts: { provider: providerPrompt, lora: loraPrompt }, visualContext, droppedImageIds: selected.droppedImageIds, aspectTransform } : {}) });
  } catch (error) {
    if (error instanceof ErrorIA) {
      registrarEvento({ proveedor: proveedor ?? error.proveedor, operacion: "imagen", ms: Date.now() - inicio, resultado: "error", error: error.message });
      return Response.json({ error: error.message, causa: error.causa, proveedor: error.proveedor }, { status: statusDe(error.causa) });
    }
    return Response.json({ error: error instanceof Error ? error.message : "Image generation failed." }, { status: 400 });
  }
}
