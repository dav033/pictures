import "server-only";
import { createHash } from "node:crypto";
import { ErrorIA, type ChatPort, type Herramienta, type ImagenEtiquetada, type TurnoChat } from "./tipos";
import type { Producto } from "@/lib/types";
import { bytesBase64, registrarGemini, resultadoTelemetria, type ContextoTelemetriaIA } from "./telemetria-llamadas";
import {
  analysisCacheKey,
  ReferenceBlueprintV2Schema,
  stableElementId,
  type ReferenceBlueprintV2,
} from "./reference-blueprint";
import {
  attachedStructureContainers,
  DETECTED_STRUCTURE_TOOL_SCHEMA,
  COMPOSITION_RELEVANCE,
  referenceStructureSemantics,
  STRUCTURE_DETECTION_RULES,
  STRUCTURE_RULES_V14_CANDIDATE,
  type VarianteReconocedor,
  tieneElementosAprobados,
  tieneEstructurasDeGlobos,
} from "./reference-structure";
import { analisisFijoDeEjemplo } from "./analisis-ejemplos";
import { category, mergeCandidates, normalize, object, parseCandidates, stringList, stringValue, toolArgs, type Candidate } from "./candidatos-referencia";

export { inferReferenceLayer, VERIFIER_MIN_CONFIDENCE } from "./candidatos-referencia";

export type AnalisisV2Resultado = {
  blueprint: ReferenceBlueprintV2;
  /** UI/chat contract: at least one approved balloon structure (see `tieneEstructurasDeGlobos`). */
  tieneEstructurasDeGlobos: boolean;
  /** UI contract: at least one approved element. False = nothing usable was seen (never "Listo"). */
  tieneElementos: boolean;
  metadata: {
    passes: ["inventory", "audit"];
    /** True when this result came from the in-memory cache instead of a new provider call. */
    cached: boolean;
    cache_key: string;
    system_prompt_hash: string;
    requires_review: boolean;
    unresolved_count: number;
    default_approval_rule: string;
  };
};

export type ReferenceCatalogItem = Pick<Producto, "id" | "nombre" | "categoria" | "colores" | "descripcion">;

/**
 * `legacy` is retained only for the historical fixture that validates the
 * old catalog-matching behavior; no production route may select it.
 *
 * `perceptual`: never matches or invents a catalog id. Used when
 * PLAN_DECORACION_ENABLED is on (plan de integración de referencias visuales,
 * R3) — the chat model is the only one allowed to turn a detected element
 * into a real product, via buscar_catalogo_rag against the validated
 * PostgreSQL catalog. The two catalogs this module could otherwise match
 * against (the 14-product SQLite demo seed and a separate SQLite mirror of
 * Shopify) are never guaranteed to agree with the PostgreSQL RAG catalog
 * that `resolverPlan` validates against — an id minted here could point at a
 * stale price, a discontinued variant, or (for the demo seed) get rejected
 * outright by `classifyNonCommercialProducts` in production.
 */
export type AnalysisMode = "legacy" | "perceptual";

const INVENTORY_SYSTEM = `You are a forensic event-design image analyst and catalog matching director. Return only structured data through the tool.
Inventory every visible decorative or background design element. Explicitly inspect the rear layer for curtains, fabric drapes, shimmer walls, printed backdrops, panels, frames, balloon structures, plinths, furniture, florals, signage, and lighting.
Describe only visible evidence. Use low confidence when uncertain. Each item needs box_2d: [ymin, xmin, ymax, xmax] as integers from 0 to 1000 relative to its own image, tightly enclosing only that element (for a balloon piece, its outermost balloons; each separate piece gets its own box).
For every detected element, make the final decision yourself: include it, omit it, or include it with the closest catalog product. Never ask the customer. Prefer a same-function catalog substitute over an unrelated exact color. A dark-blue curtain may use the closest available curtain/drape color and must explain the adaptation. If no relevant product exists, omit the element. Never invent catalog ids.
If the closest catalog match's own product photo shows a different sample assembly than the detected element (for example, a DIY balloon kit photographed as a small bouquet when the detected element is a full arch, or a single unit photographed alone when the detected element is a cluster), say so explicitly in \`adaptation\`: name the required final shape and state that the catalog photo is a material/color reference only, not the target arrangement.
For any \`balloon_structure\` element (arch, tree, column, cluster, garland, or similar balloon sculpture), do not require a product literally named or photographed as that shape. Loose latex balloon packages and generic balloon kits sold by color are valid raw material for any balloon sculpture shape — the shape is built by hand from many individual balloons, not printed on the product. Match on balloon type, size, and color only, then describe the required shape yourself in \`adaptation\`. Only omit a \`balloon_structure\` element when no compatible loose or packaged balloon product exists in the matching color at all.
For every element, also detect its color mix and physical composition: what proportion of it is each observed color, and how those parts are arranged (base vs. tip, background vs. accent, size gradient, clustering pattern). Put this in \`composition\` as one short sentence, for example "60% red round balloons at the base, 30% green climbing the sides, 10% gold metallic accents near the top".
When one element's composition needs more than one distinct color or material and a single catalog product cannot cover all of them, do not just pick the closest single product and drop the rest: return a \`bill_of_materials\` array in \`model_decision\` with one entry per required catalog product — each with its own \`role\` (what part of the composition it covers, matching \`composition\`) and \`share\` (its fraction of the element's total quantity, all entries summing to 1). List the primary/largest-share material first and also set \`catalog_product_id\` to that same primary material's id. Only use a single implicit material (no \`bill_of_materials\`) when the element is genuinely uniform in color and material.`;

// Variante `perceptual` (R3): sin acceso a catálogo, así que nunca se le pide
// resolver un product id — solo describir lo que ve. `model_decision` sigue
// siendo obligatorio en el schema de la herramienta (compatibilidad de
// forma), pero aquí solo transporta la decisión de relevancia visual
// (incluir/omitir de la composición), no una decisión comercial.
const INVENTORY_SYSTEM_PERCEPTUAL = `You are a forensic event-design image analyst. Return only structured data through the tool. You have no catalog access in this pass — never propose, guess, or invent a catalog_product_id or bill_of_materials.
Inventory every visible decorative or background design element. Explicitly inspect the rear layer for curtains, fabric drapes, shimmer walls, printed backdrops, panels, frames, balloon structures, plinths, furniture, florals, signage, and lighting.
Describe only visible evidence. Use low confidence when uncertain. Each item needs box_2d: [ymin, xmin, ymax, xmax] as integers from 0 to 1000 relative to its own image, tightly enclosing only that element (for a balloon piece, its outermost balloons; each separate piece gets its own box).
For every detected element, set model_decision.action to "include" when it is a meaningful, decorator-relevant part of the composition, or "omit" when it is negligible background clutter (e.g. an unrelated wall outlet, a stray chair leg) — base this purely on visual relevance, never on whether a matching product might exist. Always set model_decision.match_type to "none" and leave catalog_product_id and bill_of_materials unset.
For every element, also detect its color mix and physical composition: what proportion of it is each observed color, and how those parts are arranged (base vs. tip, background vs. accent, size gradient, clustering pattern). Put this in \`composition\` as one short sentence, for example "60% red round balloons at the base, 30% green climbing the sides, 10% gold metallic accents near the top".
${STRUCTURE_DETECTION_RULES}`;

const REAR_LAYER_RULE = "Rear-layer rule: any visible curtain, telon, drape, fabric backdrop, black cloth background, shimmer wall, or panel must be classified as curtain/drape/backdrop/panel and scene_role backdrop, never other or midground. If string lights are separately visible, classify them as lighting behind the decoration; do not move them to the ceiling.";

const AUDIT_SYSTEM = `You are a strict verifier and catalog-resolution reviewer of an event-design reference inventory. Inspect the image and draft inventory. Report only visible event-design elements that were missed, misclassified, or lack evidence. For every new finding, decide include or omit and select the closest valid catalog product when useful. Do not ask the customer. Include box_2d ([ymin, xmin, ymax, xmax], integers 0-1000), visible_evidence, and the complete model_decision object.`;
const AUDIT_SYSTEM_PERCEPTUAL = `You are a strict verifier of an event-design reference inventory. Inspect the image and draft inventory. Report only visible event-design elements that were missed, misclassified, or lack evidence. You have no catalog access — never propose a catalog_product_id or bill_of_materials; set match_type to "none" and decide include/omit purely on visual relevance. Do not ask the customer. Include box_2d ([ymin, xmin, ymax, xmax], integers 0-1000), visible_evidence, and the complete model_decision object. Also correct structure when a balloon structure type, side, height or curve was misread.
${STRUCTURE_DETECTION_RULES}`;
export const ANALYSIS_PARSER_VERSION = "semantic-layers-v13-box-2d";

const TOOL: Herramienta = {
  nombre: "return_reference_inventory",
  descripcion: "Return exhaustive visible event-design inventory and composition metadata.",
  esquema: {
    type: "object",
    required: ["images"],
    properties: {
      images: {
        type: "array",
        items: {
          type: "object",
          required: ["image_id", "suggested_roles", "elements", "composition", "palette"],
          properties: {
            image_id: { type: "string" },
            suggested_roles: { type: "array", items: { type: "string" } },
            elements: {
              type: "array",
            items: {
              type: "object",
              additionalProperties: true,
              required: ["name", "category", "scene_role", "detection_confidence", "visible_evidence", "box_2d", "model_decision"],
              properties: {
                name: { type: "string" },
                category: { type: "string" },
                scene_role: { type: "string" },
                detection_confidence: { type: "number" },
                visible_evidence: { type: "string" },
                // Gemini's native detection format: tighter boxes than x/y/width/height in 0-1.
                box_2d: {
                  type: "array",
                  description: "[ymin, xmin, ymax, xmax], integers from 0 to 1000 relative to the image.",
                  items: { type: "integer" },
                },
                composition: { type: "string", description: "One sentence: proportion of each color and how the parts are arranged." },
                observed_colors: { type: "array", items: { type: "string" }, description: "Plain English color names seen on this element, most dominant first, each prefixed with its finish when visible: pearl (soft satin sheen), chrome (mirror-like), metallic, matte or clear (e.g. royal blue, pearl white, chrome gold)." },
                quantity: {
                  type: "object",
                  description: "How many separate identical pieces this element represents: 1 for a single structure, 2 for a pair of identical columns reported as one element.",
                  required: ["mode", "min", "max"],
                  properties: {
                    mode: { type: "string", enum: ["exact", "approximate", "range"] },
                    min: { type: "integer" },
                    max: { type: "integer" },
                  },
                },
                material: { type: "string" },
                structure: DETECTED_STRUCTURE_TOOL_SCHEMA,
                composition_relevance: { type: "string", enum: [...COMPOSITION_RELEVANCE] },
                model_decision: {
                    type: "object",
                    required: ["action", "match_type", "reason", "adaptation"],
                    properties: {
                      action: { type: "string", enum: ["include", "omit"] },
                      catalog_product_id: { type: "string" },
                      match_type: { type: "string", enum: ["exact", "closest", "none"] },
                      reason: { type: "string" },
                      adaptation: { type: "string" },
                      bill_of_materials: {
                        type: "array",
                        items: {
                          type: "object",
                          required: ["catalog_product_id", "role", "share"],
                          properties: {
                            catalog_product_id: { type: "string" },
                            role: { type: "string" },
                            share: { type: "number" },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            composition: {
              type: "object",
              additionalProperties: true,
              required: ["focal_point", "density", "symmetry"],
              properties: {
                focal_point: { type: "string", description: "Short description of the visual focal point of the image." },
                density: { type: "string", enum: ["sparse", "moderate", "dense"], description: "How full the decorated area is." },
                symmetry: { type: "string", enum: ["symmetric", "asymmetric"], description: "Whether the decoration mirrors left and right." },
              },
            },
            palette: {
              type: "object",
              additionalProperties: true,
              properties: {
                observed: { type: "array", items: { type: "string" }, description: "Dominant colors of the whole decoration, most dominant first." },
              },
            },
          },
        },
      },
    },
  },
};

const AUDIT_TOOL: Herramienta = {
  nombre: "return_reference_audit",
  descripcion: "Return only missed or unsupported visible event-design elements.",
  esquema: {
    type: "object",
    required: ["images"],
    properties: {
      images: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: true,
          properties: {
            elements: { type: "array", items: { type: "object", additionalProperties: true } },
          },
        },
      },
    },
  },
};

const cache = new Map<string, AnalisisV2Resultado>();
const MAX_CACHE = 40;

/**
 * In-flight analyses by cache key (#19): concurrent requests for the same
 * photos share one provider call. The shared call is aborted only when every
 * waiting request has been cancelled.
 */
type AnalisisEnVuelo = { promise: Promise<AnalisisV2Resultado>; controller: AbortController; waiters: number };
const enVuelo = new Map<string, AnalisisEnVuelo>();

export type OpcionesAnalisisReferencias = {
  /**
   * Skip the completed-result cache and ask the provider again (the UI's
   * "Reintentar"). The new result replaces the cached one. An analysis of the
   * same photos already in flight is still shared: it is already a new call.
   */
  forzarNuevoAnalisis?: boolean;
  /**
   * Evaluation only (Plan A §A0.3): called after every provider attempt of each
   * pass with its raw tool arguments, so a runner can map the detector's own
   * structure types, which the blueprint merges. Never called for a cached,
   * fixed-example or already in-flight analysis (use `forzarNuevoAnalisis` and
   * do not analyze the same photos concurrently). Errors it throws propagate.
   */
  observarPase?: (pase: PaseObservado) => void;
  /** Evaluation only: prompt variant. Omitted means production v13. */
  variante?: VarianteReconocedor;
};

export type PaseObservado = {
  capacidad: "analisis_referencia_inventario" | "analisis_referencia_auditoria";
  intento: number;
  ms: number;
  uso: TurnoChat["uso"];
  finishReason?: string;
  /** Parsed tool arguments, or null when the answer was malformed. */
  args: Record<string, unknown> | null;
};

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new Error("CLIENT_CANCELLED");
}

function esperarAnalisisCompartido(key: string, entry: AnalisisEnVuelo, signal: AbortSignal | undefined): Promise<AnalisisV2Resultado> {
  if (signal?.aborted) return Promise.reject(abortReason(signal));
  entry.waiters += 1;
  return new Promise<AnalisisV2Resultado>((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      entry.waiters -= 1;
      if (entry.waiters === 0) {
        if (enVuelo.get(key) === entry) enVuelo.delete(key);
        entry.controller.abort(abortReason(signal!));
      }
      reject(abortReason(signal!));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    entry.promise.then(
      (result) => {
        if (settled) return;
        settled = true;
        entry.waiters -= 1;
        signal?.removeEventListener("abort", onAbort);
        resolve(result);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        entry.waiters -= 1;
        signal?.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}
/** Attempts per analysis pass when the model answers with malformed tool output. */
const MAX_INTENTOS_FORMATO_ANALISIS = 2;
const PARAMETROS_INVENTARIO = { temperatura: 0, maxTokens: 6000 } as const;
const PARAMETROS_AUDITORIA = { temperatura: 0, maxTokens: 4000 } as const;

/**
 * Hash of the effective analysis configuration, recorded per pass in telemetry
 * (Plan A §A0.1). Covers the fields that exist today from the A1.3 definition:
 * parser version, mode, prompts and catalog (via `systemPromptHash`), tool
 * schemas, model, thinking level and per-pass temperature/maxOutputTokens.
 * Not used by the cache key yet (that is A1.3).
 */
export function analysisConfigHash(input: { model: string; thinkingLevel: string | undefined; mode: AnalysisMode; systemPromptHash: string }): string {
  return createHash("sha256").update(JSON.stringify({
    parser_version: ANALYSIS_PARSER_VERSION,
    mode: input.mode,
    system_prompt_hash: input.systemPromptHash,
    tools: [TOOL, AUDIT_TOOL],
    model: input.model,
    thinking_level: input.thinkingLevel ?? "desconocido",
    inventory: PARAMETROS_INVENTARIO,
    audit: PARAMETROS_AUDITORIA,
  })).digest("hex");
}


function catalogFallback(candidate: Candidate, catalogo: ReferenceCatalogItem[]): { id?: string; type: "exact" | "closest" | "none"; reason: string; adaptation: string } {
  const requested = new Set(normalize([candidate.name, candidate.category, candidate.material, candidate.shape, ...candidate.observed_colors].join(" ")).split(/[^a-z0-9]+/).filter((word) => word.length > 2));
  const categoryMap: Record<string, string[]> = {
    curtain: ["cortina", "drape", "manteleria"],
    drape: ["cortina", "drape", "manteleria"],
    backdrop: ["backdrop", "panel", "arco"],
    // Cualquier globo suelto o kit ("globo_latex", "guirnalda_arco") sirve de
    // materia prima para armar cualquier figura de globos a mano — arco,
    // árbol, columna. No hace falta un producto que se llame o se fotografíe
    // como esa forma exacta.
    balloon_structure: ["arco", "globo"],
    furniture: ["mobiliario"],
    floral: ["flores"],
    lighting: ["iluminacion"],
    tableware: ["centro_mesa", "manteleria"],
  };
  const preferredCategories = categoryMap[candidate.category] ?? [];
  const ranked = catalogo.map((product) => {
    const productWords = new Set(normalize([product.nombre, product.categoria, product.descripcion, ...product.colores].join(" ")).split(/[^a-z0-9]+/).filter((word) => word.length > 2));
    const categoryScore = preferredCategories.some((category) => normalize(product.categoria).includes(category)) ? 5 : 0;
    const colorScore = candidate.observed_colors.filter((color) => product.colores.some((item) => normalize(item).includes(normalize(color)) || normalize(color).includes(normalize(item)))).length * 1.5;
    const wordScore = [...requested].filter((word) => productWords.has(word)).length;
    return { product, score: categoryScore + colorScore + wordScore };
  }).sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best || best.score < 4) return { type: "none", reason: "No hay sustituto de catálogo suficientemente cercano; se omite.", adaptation: "Omitir elemento para evitar inventar una pieza no disponible." };
  return { id: best.product.id, type: "closest", reason: `Sustituto automático más cercano: ${best.product.nombre}.`, adaptation: `Adaptar color observado (${candidate.observed_colors.join(", ") || "no determinable"}) a ${best.product.colores.join(", ") || "la apariencia disponible"}.` };
}

/**
 * Filtra el bill_of_materials del modelo a ids reales del catálogo, garantiza
 * que el material principal (`primaryId`) quede primero, y normaliza los
 * shares para que sumen 1 — sin esto, un id inventado o un share mal escrito
 * por el modelo rompería la cotización de cada material por separado.
 */
function resolveBillOfMaterials(
  raw: Array<{ catalog_product_id: string; role: string; share: number }> | undefined,
  catalogIds: Set<string>,
  primaryId: string | undefined,
): Array<{ catalog_product_id: string; role: string; share: number }> {
  const valid = (raw ?? []).filter((line) => catalogIds.has(line.catalog_product_id));
  const withoutPrimary = primaryId ? valid.filter((line) => line.catalog_product_id !== primaryId) : valid;
  const lines = primaryId
    ? [valid.find((line) => line.catalog_product_id === primaryId) ?? { catalog_product_id: primaryId, role: "material principal", share: 1 }, ...withoutPrimary]
    : withoutPrimary;
  if (lines.length === 0) return [];
  const totalShare = lines.reduce((sum, line) => sum + line.share, 0);
  return totalShare > 0
    ? lines.map((line) => ({ ...line, share: line.share / totalShare }))
    : lines.map((line, index) => ({ ...line, share: index === 0 ? 1 : 0 }));
}

function buildBlueprint(images: ImagenEtiquetada[], inventoryRaw: Record<string, unknown>, auditRaw: Record<string, unknown>, catalogo: ReferenceCatalogItem[], mode: AnalysisMode): ReferenceBlueprintV2 {
  const inventoryImages = Array.isArray(inventoryRaw.images) ? inventoryRaw.images : [];
  const auditImages = Array.isArray(auditRaw.images) ? auditRaw.images : [];
  const knownImageIds = new Set(images.map((image) => image.id));
  const safeImageId = (value: unknown) => {
    const candidate = stringValue(value, images[0].id, 40);
    return knownImageIds.has(candidate) ? candidate : images[0].id;
  };
  const allCandidates = mergeCandidates(
    inventoryImages.flatMap((value) => {
      const item = object(value);
      return parseCandidates(safeImageId(item.image_id), item);
    }),
    auditImages.flatMap((value) => {
      const item = object(value);
      return parseCandidates(safeImageId(item.image_id), item);
    }),
  );
  const bySourceIndex = new Map<string, number>();
  // Modo perceptual (R3): ningún id de catálogo puede salir de este módulo,
  // sin importar lo que haya devuelto el modelo — el chat es el único que
  // puede convertir un elemento detectado en un producto real, vía
  // buscar_catalogo_rag contra PostgreSQL validado.
  const catalogIds = new Set(mode === "perceptual" ? [] : catalogo.map((item) => item.id));
  const elements = allCandidates.map((candidate) => {
    const requestedId = candidate.model_decision.catalog_product_id;
    const modelMatch = mode === "perceptual"
      ? { id: undefined as string | undefined, type: "none" as const, reason: candidate.model_decision.reason, adaptation: "Sin emparejamiento de catálogo en este modo; el chat resuelve el producto real contra el RAG." }
      : requestedId && catalogIds.has(requestedId)
        ? { id: requestedId as string | undefined, type: candidate.model_decision.match_type, reason: candidate.model_decision.reason, adaptation: candidate.model_decision.adaptation }
        : catalogFallback(candidate, catalogo);
    // Important: `&&` must return boolean here. Returning `modelMatch.id`
    // leaked catalog product id into `approved`, causing Zod error
    // `expected boolean, received string`.
    // Invariant after merging the verifier (which may upgrade a category to
    // balloon_structure without a typed structure): a balloon structure is only
    // approvable with a structure type (#2).
    const untypedBalloon = candidate.category === "balloon_structure" && !candidate.structure;
    const action = untypedBalloon
      ? false
      : mode === "perceptual"
        ? candidate.model_decision.action === "include"
        : candidate.model_decision.action === "include" && Boolean(modelMatch.id || modelMatch.type === "none");
    const resolution = action ? modelMatch : { ...modelMatch, id: undefined, type: "none" as const, reason: candidate.model_decision.reason, adaptation: mode === "perceptual" ? "Elemento omitido: no es relevante para la composición." : "Omitir elemento según decisión automática del modelo." };
    const sourceType = mode === "perceptual" ? "reference_only" as const : resolution.id ? "catalog_backed" as const : "reference_only" as const;
    const matchedProduct = sourceType === "catalog_backed" && resolution.id ? catalogo.find((product) => product.id === resolution.id) : undefined;
    const resolvedCategory = candidate.category === "other" && matchedProduct ? category(matchedProduct.categoria) : candidate.category;
    const resolvedName = candidate.name === "unidentified decorative element"
      ? matchedProduct?.nombre ?? "Elemento decorativo"
      : candidate.name;
    const index = bySourceIndex.get(candidate.source_image_id) ?? 0;
    bySourceIndex.set(candidate.source_image_id, index + 1);
    const billOfMaterials = mode === "perceptual" ? [] : resolveBillOfMaterials(candidate.model_decision.bill_of_materials, catalogIds, resolution.id);
    return {
      element_id: stableElementId(candidate.source_image_id, index),
      source_image_id: candidate.source_image_id,
      name: resolvedName,
      category: resolvedCategory,
      scene_role: candidate.scene_role,
      detection_confidence: candidate.detection_confidence,
      visible_evidence: candidate.visible_evidence,
      reference_bbox: candidate.reference_bbox,
      depth_layer: candidate.depth_layer,
      include_policy: action ? "include" as const : "exclude" as const,
      approved: action,
      source_type: sourceType,
      quantity: candidate.quantity,
      // Identical separate pieces the photo shows (a pair of columns = 2), never
      // balloons or packages: consumers read it with unidadesMaterialDeElemento.
      quantity_semantics: "physical_instances" as const,
      appearance: {
        observed_colors: candidate.observed_colors.length ? candidate.observed_colors : ["color not determinable"],
        resolved_colors: [],
        color_policy: "adapt_to_event_palette" as const,
        material: candidate.material,
        shape: candidate.shape,
        composition: candidate.composition,
      },
      relationships: candidate.relationships.filter((relation) => relation.target_element_id !== "unknown"),
      uncertainties: candidate.uncertainties,
      model_decision: {
        action: action ? "include" as const : "omit" as const,
        catalog_product_id: resolution.id,
        match_type: resolution.type,
        reason: resolution.reason,
        adaptation: resolution.adaptation,
        bill_of_materials: billOfMaterials.length > 1 ? billOfMaterials : undefined,
      },
    };
  });
  // #11: foil figures on a balloon wall (or one arrangement split in three
  // centerpieces) are part of the larger structure, not extra quoted pieces.
  const attachments = attachedStructureContainers(elements.map((element, index) => ({
    sourceImageId: element.source_image_id,
    name: element.name,
    approved: element.approved,
    bbox: element.reference_bbox,
    structure: allCandidates[index]!.structure,
  })));
  for (const [innerIndex, containerIndex] of attachments) {
    const inner = elements[innerIndex]!;
    const container = elements[containerIndex]!;
    elements[innerIndex] = {
      ...inner,
      approved: false,
      include_policy: "exclude",
      source_type: "reference_only",
      relationships: [...inner.relationships, { type: "overlaps" as const, target_element_id: container.element_id }].slice(0, 12),
      uncertainties: [`Attached to ${container.element_id}; quoted as part of that structure.`, ...inner.uncertainties].slice(0, 8),
      model_decision: { ...inner.model_decision, action: "omit", catalog_product_id: undefined, match_type: "none", bill_of_materials: undefined },
    };
  }
  const compositionDensity = inventoryImages.map((value) => object(object(value).composition).density).find((value) => ["sparse", "moderate", "dense"].includes(String(value))) as "sparse" | "moderate" | "dense" | undefined;
  const semanticsById = referenceStructureSemantics(
    elements.map((element, index) => ({
      elementId: element.element_id,
      bbox: element.reference_bbox,
      structure: element.approved ? allCandidates[index]!.structure : undefined,
    })),
    compositionDensity ?? "unknown",
  );
  const elementsWithSemantics = elements.map((element) => {
    const semantics = semanticsById.get(element.element_id);
    return semantics ? { ...element, visual_semantics: semantics } : element;
  });
  elements.splice(0, elements.length, ...elementsWithSemantics);
  const elementIdsByName = new Map(elements.map((element) => [element.name.toLowerCase(), element.element_id]));
  const elementIds = new Set(elements.map((element) => element.element_id));
  for (const element of elements) {
    for (const relationship of element.relationships) {
      relationship.target_element_id = elementIdsByName.get(relationship.target_element_id.toLowerCase()) ?? relationship.target_element_id;
    }
    element.relationships = element.relationships.filter((relationship) => elementIds.has(relationship.target_element_id));
  }
  const inventoryById = new Map(inventoryImages.map((value) => { const item = object(value); return [stringValue(item.image_id, ""), item]; }));
  const sourceImages = images.map((image) => {
    const raw = inventoryById.get(image.id) ?? {};
    const suggested = stringList(raw.suggested_roles, 6).filter((role): role is ReferenceBlueprintV2["source_images"][number]["approved_roles"][number] => ["composition_reference", "element_reference", "palette_reference", "style_reference", "catalog_product_reference", "venue_base"].includes(role));
    const roles = suggested.length ? suggested : ["composition_reference", "element_reference", "palette_reference"];
    return { image_id: image.id, approved_roles: [...new Set(roles)] };
  });
  const compositions = inventoryImages.map((value) => object(object(value).composition));
  const palette = inventoryImages.flatMap((value) => { const item = object(object(value).palette); return stringList(item.observed ?? item.colors, 12); });
  const focal = compositions.map((value) => stringValue(value.focal_point ?? value.focal, "focal point not determinable", 240)).filter(Boolean)[0] ?? "focal point not determinable";
  const density = compositions.map((value) => value.density).find((value) => ["sparse", "moderate", "dense"].includes(String(value))) as "sparse" | "moderate" | "dense" | undefined;
  const symmetry = compositions.map((value) => value.symmetry).find((value) => ["symmetric", "asymmetric"].includes(String(value))) as "symmetric" | "asymmetric" | undefined;
  return ReferenceBlueprintV2Schema.parse({
    schema_version: "2.0",
    source_images: sourceImages,
    elements,
    composition: { focal_point: focal, density: density ?? "unknown", symmetry: symmetry ?? "unknown", negative_space: ["areas not occupied by approved elements"] },
    palette: { observed: [...new Set(palette)].slice(0, 12), priority: [...new Set(palette)].slice(0, 8) },
    unresolved_decisions: [],
  });
}

/** Prompts and their hash for a mode and catalog; the evaluation runner records the same hash. */
export function sistemaAnalisis(catalogo: ReferenceCatalogItem[], mode: AnalysisMode, variante: VarianteReconocedor = "v13") {
  // Candidate rules are appended only on request, so v13 prompts and hashes stay byte-identical.
  const extra = variante === "v14-candidato" ? `\n${STRUCTURE_RULES_V14_CANDIDATE}` : "";
  const inventorySystem = (mode === "perceptual" ? INVENTORY_SYSTEM_PERCEPTUAL : INVENTORY_SYSTEM) + extra;
  const auditSystem = (mode === "perceptual" ? AUDIT_SYSTEM_PERCEPTUAL : AUDIT_SYSTEM) + extra;
  // En modo perceptual nunca se manda el catálogo al modelo: no hay nada
  // válido que pueda elegir, y mandarlo solo lo tentaría a inventar un id.
  const catalogText = mode === "perceptual"
    ? "Not applicable in this mode."
    : catalogo.length
      ? catalogo.map((item) => JSON.stringify({ id: item.id, name: item.nombre, category: item.categoria, colors: item.colores, description: item.descripcion.slice(0, 180) })).join("\n")
      : "No catalog products supplied.";
  const systemPromptHash = createHash("sha256").update(ANALYSIS_PARSER_VERSION).update(mode).update(inventorySystem).update(auditSystem).update(REAR_LAYER_RULE).update(catalogText).digest("hex");
  return { inventorySystem, auditSystem, catalogText, systemPromptHash };
}

export async function analizarReferenciasV2(chat: ChatPort, referencias: ImagenEtiquetada[], catalogo: ReferenceCatalogItem[] = [], mode: AnalysisMode = "perceptual", telemetria?: ContextoTelemetriaIA, signal?: AbortSignal, opciones: OpcionesAnalisisReferencias = {}): Promise<AnalisisV2Resultado> {
  if (!referencias.length) throw new Error("At least one reference image is required.");
  const variante = opciones.variante ?? "v13";
  const { inventorySystem, auditSystem, catalogText, systemPromptHash } = sistemaAnalisis(catalogo, mode, variante);
  const key = analysisCacheKey({ model: chat.modelo, systemPromptHash, images: referencias.map((image) => ({ image_id: image.id, mime: image.mime, base64: image.base64 })) });
  // The stored gallery analyses are v13 results; a candidate variant never reuses them.
  if (!opciones.forzarNuevoAnalisis && mode === "perceptual" && variante === "v13") {
    const fijo = analisisFijoDeEjemplo(referencias, ANALYSIS_PARSER_VERSION);
    if (fijo) return fijo;
  }
  const cached = opciones.forzarNuevoAnalisis ? undefined : cache.get(key);
  if (cached) return { ...cached, metadata: { ...cached.metadata, cached: true } };
  let entry = enVuelo.get(key);
  if (!entry) {
    const controller = new AbortController();
    const nueva: AnalisisEnVuelo = {
      controller,
      waiters: 0,
      promise: ejecutarAnalisis({ chat, referencias, catalogo, mode, telemetria, signal: controller.signal, key, systemPromptHash, inventorySystem, auditSystem, catalogText, observarPase: opciones.observarPase })
        .then((result) => {
          if (cache.has(key)) cache.delete(key);
          if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!);
          cache.set(key, result);
          return result;
        })
        .finally(() => {
          if (enVuelo.get(key) === nueva) enVuelo.delete(key);
        }),
    };
    enVuelo.set(key, nueva);
    entry = nueva;
  }
  return esperarAnalisisCompartido(key, entry, signal);
}

async function ejecutarAnalisis(input: {
  chat: ChatPort;
  referencias: ImagenEtiquetada[];
  catalogo: ReferenceCatalogItem[];
  mode: AnalysisMode;
  telemetria?: ContextoTelemetriaIA;
  signal: AbortSignal;
  key: string;
  systemPromptHash: string;
  inventorySystem: string;
  auditSystem: string;
  catalogText: string;
  observarPase?: OpcionesAnalisisReferencias["observarPase"];
}): Promise<AnalisisV2Resultado> {
  const { chat, referencias, catalogo, mode, telemetria, signal, key, systemPromptHash, inventorySystem, auditSystem, catalogText, observarPase } = input;
  const ids = referencias.map((reference) => reference.id);
  const bytesImagenEntrada = referencias.reduce((total, image) => total + bytesBase64(image.base64), 0);
  const configHash = analysisConfigHash({ model: chat.modelo, thinkingLevel: chat.thinkingLevel, mode, systemPromptHash });
  const promptVersion = systemPromptHash.slice(0, 16);
  const ejecutarPaso = async (
    capacidad: "analisis_referencia_inventario" | "analisis_referencia_auditoria",
    peticion: Parameters<ChatPort["turno"]>[0],
    intento: number,
  ) => {
    const inicio = Date.now();
    try {
      const turno = await chat.turno(peticion);
      registrarGemini({
        flujo: "analisis_referencia",
        capacidad,
        modelo: turno.modelo || chat.modelo,
        inicio,
        resultado: "ok",
        contexto: { superficie: "/api/references/analyze", ...telemetria, intento },
        usage: {
          promptTokenCount: turno.uso.entrada,
          candidatesTokenCount: turno.uso.salida,
          thoughtsTokenCount: turno.uso.pensamiento,
          cachedContentTokenCount: turno.uso.cacheados,
          toolUsePromptTokenCount: turno.uso.promptHerramientas,
        },
        bytesImagenEntrada,
        promptVersion,
        thinkingLevel: chat.thinkingLevel,
        finishReason: turno.finishReason,
        configHash,
      });
      return turno;
    } catch (error) {
      registrarGemini({ flujo: "analisis_referencia", capacidad, modelo: chat.modelo, inicio, resultado: resultadoTelemetria(error), contexto: { superficie: "/api/references/analyze", ...telemetria, intento }, bytesImagenEntrada, promptVersion, thinkingLevel: chat.thinkingLevel, configHash });
      throw error;
    }
  };
  // The model sometimes answers with malformed text instead of the tool call.
  // The analysis has no side effects, so one bounded retry is safe; a second
  // malformed answer is a retryable provider failure, not a client error.
  const pasoConHerramienta = async (
    capacidad: "analisis_referencia_inventario" | "analisis_referencia_auditoria",
    peticion: Parameters<ChatPort["turno"]>[0],
    toolName: string,
  ): Promise<Record<string, unknown>> => {
    for (let intento = 1; ; intento += 1) {
      const inicio = Date.now();
      const turno = await ejecutarPaso(capacidad, peticion, intento);
      const ms = Date.now() - inicio;
      let args: Record<string, unknown> | null = null;
      let fallo: unknown;
      try {
        args = toolArgs(turno, toolName);
      } catch (error) {
        fallo = error;
      }
      // Outside the parse try: an observer error is not a malformed answer.
      observarPase?.({ capacidad, intento, ms, uso: turno.uso, ...(turno.finishReason ? { finishReason: turno.finishReason } : {}), args });
      if (args) return args;
      if (!(fallo instanceof SyntaxError) || intento >= MAX_INTENTOS_FORMATO_ANALISIS || signal?.aborted) {
        throw new ErrorIA("desconocido", chat.id, `The reference analysis returned malformed output (${capacidad}).`, true);
      }
    }
  };
  const inventoryRaw = await pasoConHerramienta("analisis_referencia_inventario", {
    sistema: mode === "perceptual" ? `${inventorySystem}\n${REAR_LAYER_RULE}` : `${inventorySystem}\n${REAR_LAYER_RULE}\n\nVALID CATALOG PRODUCTS\n${catalogText}`,
      historial: [{ rol: "usuario", texto: `Inventory these references and resolve every element automatically. Preserve exact image IDs in this order: ${ids.join(", ")}. Return one model_decision per element.`, imagenes: referencias }],
      herramientas: [TOOL],
      ...PARAMETROS_INVENTARIO,
      signal,
  }, TOOL.nombre);
  const draftJson = JSON.stringify(inventoryRaw).slice(0, 24000);
  // The audit only adds or corrects findings: when it keeps answering with
  // malformed output the inventory alone is still a valid analysis.
  const auditRaw = await pasoConHerramienta("analisis_referencia_auditoria", {
    sistema: mode === "perceptual" ? `${auditSystem}\n${REAR_LAYER_RULE}` : `${auditSystem}\n${REAR_LAYER_RULE}\n\nVALID CATALOG PRODUCTS\n${catalogText}`,
      historial: [{ rol: "usuario", texto: `Audit the draft inventory below against the same references. Keep exact image IDs. Resolve every finding automatically.\n<DRAFT_INVENTORY>${draftJson}</DRAFT_INVENTORY>`, imagenes: referencias }],
      herramientas: [AUDIT_TOOL],
      ...PARAMETROS_AUDITORIA,
      signal,
  }, AUDIT_TOOL.nombre).catch((error: unknown) => {
    if (signal?.aborted || !(error instanceof ErrorIA) || !error.message.includes("malformed output")) throw error;
    console.warn("[references/analyze] audit skipped after malformed output", { request_id: telemetria?.requestId });
    return { images: [] } as Record<string, unknown>;
  });
  const blueprint = buildBlueprint(referencias, inventoryRaw, auditRaw, mode === "perceptual" ? [] : catalogo, mode);
  return {
    blueprint,
    tieneEstructurasDeGlobos: tieneEstructurasDeGlobos(blueprint),
    tieneElementos: tieneElementosAprobados(blueprint),
    metadata: {
      passes: ["inventory", "audit"],
      cached: false,
      cache_key: key,
      system_prompt_hash: systemPromptHash,
      requires_review: false,
      unresolved_count: 0,
      default_approval_rule: mode === "perceptual"
        ? "Model only decides visual relevance (include/omit); no catalog id is ever produced here — the chat resolves real products against the validated RAG catalog."
        : "Model decides include, omit, or closest catalog substitution automatically; customer approval is never required.",
    },
  };
}
