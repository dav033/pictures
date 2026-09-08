import "server-only";
import { createHash } from "node:crypto";
import type { ChatPort, Herramienta, ImagenEtiquetada } from "./tipos";
import type { Producto } from "@/lib/types";
import { bytesBase64, registrarGemini, resultadoTelemetria, type ContextoTelemetriaIA } from "./telemetria-llamadas";
import {
  analysisCacheKey,
  bboxOverlap,
  ReferenceBlueprintV2Schema,
  stableElementId,
  type ReferenceBlueprintV2,
  type ReferenceBBox,
} from "./reference-blueprint";

type AnalisisV2Resultado = {
  blueprint: ReferenceBlueprintV2;
  metadata: {
    passes: ["inventory", "audit"];
    cache_key: string;
    system_prompt_hash: string;
    requires_review: boolean;
    unresolved_count: number;
    default_approval_rule: string;
  };
};

type Candidate = {
  source_image_id: string;
  name: string;
  category: ReferenceBlueprintV2["elements"][number]["category"];
  scene_role: ReferenceBlueprintV2["elements"][number]["scene_role"];
  detection_confidence: number;
  visible_evidence: string;
  reference_bbox: ReferenceBBox;
  depth_layer: number;
  include_policy: "include" | "exclude" | "ask";
  source_type: "catalog_backed" | "reference_only";
  quantity: { mode: "exact" | "approximate" | "range"; min: number; max: number };
  observed_colors: string[];
  material: string;
  shape: string;
  composition: string;
  relationships: Array<{ type: "behind" | "in_front_of" | "overlaps" | "aligned_with" | "supports"; target_element_id: string }>;
  uncertainties: string[];
  model_decision: {
    action: "include" | "omit";
    catalog_product_id?: string;
    match_type: "exact" | "closest" | "none";
    reason: string;
    adaptation: string;
    bill_of_materials?: Array<{ catalog_product_id: string; role: string; share: number }>;
  };
};

export type ReferenceCatalogItem = Pick<Producto, "id" | "nombre" | "categoria" | "colores" | "descripcion">;

/**
 * `legacy`: matches elements against a supplied catalog and emits
 * `model_decision.catalog_product_id`/`bill_of_materials` — the original
 * behavior, used when no decoration plan bridges the reference into RAG.
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
Describe only visible evidence. Use low confidence when uncertain. Each item needs a normalized reference_bbox with x/y/width/height from 0 to 1.
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
Describe only visible evidence. Use low confidence when uncertain. Each item needs a normalized reference_bbox with x/y/width/height from 0 to 1.
For every detected element, set model_decision.action to "include" when it is a meaningful, decorator-relevant part of the composition, or "omit" when it is negligible background clutter (e.g. an unrelated wall outlet, a stray chair leg) — base this purely on visual relevance, never on whether a matching product might exist. Always set model_decision.match_type to "none" and leave catalog_product_id and bill_of_materials unset.
For every element, also detect its color mix and physical composition: what proportion of it is each observed color, and how those parts are arranged (base vs. tip, background vs. accent, size gradient, clustering pattern). Put this in \`composition\` as one short sentence, for example "60% red round balloons at the base, 30% green climbing the sides, 10% gold metallic accents near the top".`;

const REAR_LAYER_RULE = "Rear-layer rule: any visible curtain, telon, drape, fabric backdrop, black cloth background, shimmer wall, or panel must be classified as curtain/drape/backdrop/panel and scene_role backdrop, never other or midground. If string lights are separately visible, classify them as lighting behind the decoration; do not move them to the ceiling.";

const AUDIT_SYSTEM = `You are a strict verifier and catalog-resolution reviewer of an event-design reference inventory. Inspect the image and draft inventory. Report only visible event-design elements that were missed, misclassified, or lack evidence. For every new finding, decide include or omit and select the closest valid catalog product when useful. Do not ask the customer. Include normalized reference_bbox, visible_evidence, and the complete model_decision object.`;
const AUDIT_SYSTEM_PERCEPTUAL = `You are a strict verifier of an event-design reference inventory. Inspect the image and draft inventory. Report only visible event-design elements that were missed, misclassified, or lack evidence. You have no catalog access — never propose a catalog_product_id or bill_of_materials; set match_type to "none" and decide include/omit purely on visual relevance. Do not ask the customer. Include normalized reference_bbox, visible_evidence, and the complete model_decision object.`;
const ANALYSIS_PARSER_VERSION = "semantic-layers-v7-bill-of-materials";

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
              required: ["name", "category", "scene_role", "detection_confidence", "visible_evidence", "reference_bbox", "model_decision"],
              properties: {
                name: { type: "string" },
                category: { type: "string" },
                scene_role: { type: "string" },
                detection_confidence: { type: "number" },
                visible_evidence: { type: "string" },
                reference_bbox: {
                  type: "object",
                  required: ["x", "y", "width", "height"],
                  properties: {
                    x: { type: "number" },
                    y: { type: "number" },
                    width: { type: "number" },
                    height: { type: "number" },
                  },
                },
                composition: { type: "string" },
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
            composition: { type: "object", additionalProperties: true },
            palette: { type: "object", additionalProperties: true },
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

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown, fallback: string, max = 320): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : fallback;
}

function firstString(source: Record<string, unknown>, keys: string[], fallback: string, max = 320): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, max);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = object(value);
      const nestedValue = firstString(nested, ["name", "label", "title", "type"], "", max);
      if (nestedValue) return nestedValue;
    }
  }
  return fallback;
}

function stringList(value: unknown, max = 8): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim().slice(0, 80)).slice(0, max) : [];
}

function numberValue(value: unknown, fallback: number, min = 0, max = 1): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(",", ".")) : NaN;
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback;
}

function bbox(value: unknown): ReferenceBBox {
  const source = object(value);
  return {
    x: numberValue(source.x, 0.1),
    y: numberValue(source.y, 0.1),
    width: numberValue(source.width, 0.2, 0.01),
    height: numberValue(source.height, 0.2, 0.01),
  };
}

function category(value: unknown): Candidate["category"] {
  const text = normalize(typeof value === "string" ? value : "");
  const direct: Record<string, Candidate["category"]> = {
    curtain: "curtain", curtains: "curtain", cortina: "curtain", cortinas: "curtain", tela: "drape", drape: "drape", drapes: "drape",
    backdrop: "backdrop", fondo: "backdrop", wall: "backdrop", muro: "backdrop", panel: "panel", paneles: "panel",
    balloon_structure: "balloon_structure", balloons: "balloon_structure", balloon: "balloon_structure", arco: "balloon_structure", globos: "balloon_structure", globo: "balloon_structure", guirnalda: "balloon_structure", garland: "balloon_structure",
    plinth: "plinth", pedestal: "plinth", furniture: "furniture", mobiliario: "furniture", mueble: "furniture", mesa: "furniture", silla: "furniture",
    floral: "floral", flores: "floral", flor: "floral", foliage: "floral", follaje: "floral", signage: "signage", sign: "signage", signs: "signage", letrero: "signage", cartel: "signage", banner: "signage", lettering: "signage", text: "signage", texto: "signage", mensaje: "signage",
    lighting: "lighting", light: "lighting", luces: "lighting", luz: "lighting", iluminacion: "lighting", tableware: "tableware", vajilla: "tableware", velas: "tableware", centro_mesa: "tableware", manteleria: "drape",
  };
  if (direct[text]) return direct[text];
  if (text.includes("cortin") || text.includes("drape") || text.includes("tela")) return "curtain";
  if (text.includes("globo") || text.includes("balloon") || text.includes("arco") || text.includes("guirnalda")) return "balloon_structure";
  if (text.includes("luz") || text.includes("light") || text.includes("foquito") || text.includes("ilumin")) return "lighting";
  if (text.includes("flor") || text.includes("follaje") || text.includes("floral")) return "floral";
  if (text.includes("letrero") || text.includes("cartel") || text.includes("banner") || text.includes("lettering") || text.includes("signage") || text.includes("mensaje") || text.includes("happy birthday")) return "signage";
  if (text.includes("panel") || text.includes("fondo") || text.includes("backdrop") || text.includes("muro")) return "backdrop";
  if (text.includes("mesa") || text.includes("silla") || text.includes("mueble")) return "furniture";
  return "other";
}

function sceneRole(value: unknown): Candidate["scene_role"] {
  const valid = ["backdrop", "midground", "foreground", "accent", "lighting"] as const;
  return valid.includes(value as Candidate["scene_role"]) ? value as Candidate["scene_role"] : "midground";
}

export function inferReferenceLayer(input: { explicitCategory?: unknown; explicitSceneRole?: unknown; name: string; evidence: string; material: string; shape: string }): { category: Candidate["category"]; scene_role: Candidate["scene_role"] } {
  const rawCategory = category(input.explicitCategory ?? input.name);
  const semanticText = [input.name, input.evidence, input.material, input.shape].join(" ");
  const inferredCategory = rawCategory === "other" ? category(semanticText) : rawCategory;
  const text = normalize(semanticText);
  const nameText = normalize(input.name);
  const hasLighting = /luz|luces|led|foquito|ilumin/.test(text);
  // A backdrop can carry string lights. Treating any lighting cue as the
  // whole element used to demote "cortina con luces" to lighting and lose
  // the rear surface from the plan. A named rear surface wins; lights stay a
  // separate element only when no backdrop surface is present.
  const hasNamedBackdropSurface = /cortin|telon|drape|tela|backdrop|fondo|muro|panel/.test(nameText);
  const hasBackdropSurface = hasNamedBackdropSurface || /cortin|telon|drape|tela|backdrop|fondo|muro|panel/.test(text);
  const finalCategory = hasLighting && !hasBackdropSurface
    ? "lighting"
    : inferredCategory === "other" && /cortin|telon|drape|tela|fondo|backdrop|muro|panel/.test(text)
      ? "backdrop"
      : inferredCategory;
  const finalRole = ["curtain", "drape", "backdrop", "panel"].includes(finalCategory) || (!hasLighting && /cortin|telon|drape|tela|fondo|backdrop|muro|panel/.test(text))
    ? "backdrop"
    : finalCategory === "lighting" || hasLighting
      ? "lighting"
      : sceneRole(input.explicitSceneRole);
  return { category: finalCategory, scene_role: finalRole };
}

function relationType(value: unknown): Candidate["relationships"][number]["type"] {
  const valid = ["behind", "in_front_of", "overlaps", "aligned_with", "supports"] as const;
  return valid.includes(value as Candidate["relationships"][number]["type"]) ? value as Candidate["relationships"][number]["type"] : "overlaps";
}

function parseCandidates(imageId: string, raw: unknown): Candidate[] {
  const source = object(raw);
  const elements = Array.isArray(source.elements) ? source.elements : [];
  return elements.slice(0, 40).map((item) => {
    const value = object(item);
    const confidence = numberValue(value.detection_confidence ?? value.confidence, 0.45);
    const detectedName = firstString(value, ["name", "element", "element_name", "element_type", "object", "item", "object_name", "item_name", "label", "title", "nombre", "elemento", "tipo_elemento", "tipo", "visual_description", "element_description", "descripcion_visual", "description", "descripcion"], "unidentified decorative element", 160);
    const visibleEvidence = firstString(value, ["visible_evidence", "evidence", "visual_evidence", "observation", "observations", "visual_description", "element_description", "description", "descripcion"], "Visible decorative form; details are uncertain.", 320);
    const material = firstString(value, ["material", "material_texture", "texture", "materiales", "textura"], "material not determinable", 160);
    const shape = firstString(value, ["shape", "form", "silhouette", "forma"], "shape not determinable", 160);
    const composition = firstString(value, ["composition", "composicion", "color_mix", "mix"], "single uniform material", 240);
    const layer = inferReferenceLayer({ explicitCategory: value.category ?? value.element_category ?? value.tipo ?? value.tipo_elemento, explicitSceneRole: value.scene_role, name: detectedName, evidence: visibleEvidence, material, shape });
    const detectedCategory = layer.category;
    const defaultInclude = ["curtain", "drape", "backdrop"].includes(detectedCategory) && confidence >= 0.5;
    const quantity = object(value.quantity);
    const min = Math.round(numberValue(quantity.min, 1, 0, 999));
    const max = Math.max(min, Math.round(numberValue(quantity.max, min, 0, 999)));
    const relationships = Array.isArray(value.relationships) ? value.relationships.slice(0, 8).map((relation) => {
      const rel = object(relation);
      return { type: relationType(rel.type), target_element_id: stringValue(rel.target_element_id ?? rel.target, "unknown", 80) };
    }) : [];
    const rawDecision = object(value.model_decision ?? value.decision);
    const explicitAction = rawDecision.action ?? value.action;
    const action = explicitAction === "omit" ? "omit" : explicitAction === "include" ? "include" : defaultInclude ? "include" : "omit";
    const matchType = rawDecision.match_type === "exact" || rawDecision.match_type === "closest" || rawDecision.match_type === "none"
      ? rawDecision.match_type
      : "none";
    const catalogProductId = stringValue(rawDecision.catalog_product_id ?? value.catalog_product_id, "", 160) || undefined;
    const rawBillOfMaterials = Array.isArray(rawDecision.bill_of_materials) ? rawDecision.bill_of_materials : [];
    const billOfMaterials = rawBillOfMaterials.slice(0, 24).map((line) => {
      const item = object(line);
      return {
        catalog_product_id: stringValue(item.catalog_product_id, "", 160),
        role: stringValue(item.role, "material", 160),
        share: numberValue(item.share, 0, 0, 1),
      };
    }).filter((line) => line.catalog_product_id);
    return {
      source_image_id: imageId,
      name: detectedName,
      category: detectedCategory,
      scene_role: layer.scene_role,
      detection_confidence: confidence,
      visible_evidence: visibleEvidence,
      reference_bbox: bbox(value.reference_bbox ?? value.bbox ?? value.bounding_box ?? value.box ?? value.location),
      depth_layer: Math.round(numberValue(value.depth_layer, 2, 0, 99)),
      include_policy: defaultInclude ? "include" : "ask",
      source_type: "reference_only",
      quantity: { mode: quantity.mode === "exact" ? "exact" : quantity.mode === "range" ? "range" : "approximate", min, max },
      observed_colors: stringList(value.observed_colors ?? value.colors ?? value.colours ?? value.colores ?? value.palette, 8),
      material,
      shape,
      composition,
      relationships,
      uncertainties: stringList(value.uncertainties, 8),
      model_decision: {
        action,
        catalog_product_id: catalogProductId,
        match_type: catalogProductId ? matchType === "none" ? "closest" : matchType : "none",
        reason: stringValue(rawDecision.reason ?? value.catalog_match_reason, action === "include" ? "Modelo resolvió incluir el elemento." : "Modelo resolvió omitir el elemento.", 260),
        adaptation: stringValue(rawDecision.adaptation ?? value.adaptation, "Adaptar escala, material y color al catálogo disponible.", 260),
        bill_of_materials: billOfMaterials.length ? billOfMaterials : undefined,
      },
    };
  });
}

function extractJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(cleaned);
}

function toolArgs(turn: { llamadas: Array<{ nombre: string; args: Record<string, unknown> }>; texto: string }, toolName: string): Record<string, unknown> {
  return turn.llamadas.find((call) => call.nombre === toolName)?.args ?? object(extractJson(turn.texto));
}

function mergeCandidates(inventory: Candidate[], audit: Candidate[]): Candidate[] {
  const merged = [...inventory];
  for (const finding of audit) {
    const match = merged.findIndex((item) => item.source_image_id === finding.source_image_id && bboxOverlap(item.reference_bbox, finding.reference_bbox) >= 0.35);
    if (match >= 0) {
      const current = merged[match];
      const strongerCategory = current.category === "other" && finding.category !== "other" ? finding.category : current.category;
      const strongerRole = current.scene_role === "midground" && finding.scene_role !== "midground" ? finding.scene_role : current.scene_role;
      merged[match] = { ...current, category: strongerCategory, scene_role: strongerRole, name: current.name === "unidentified decorative element" ? finding.name : current.name, visible_evidence: finding.visible_evidence, uncertainties: [...new Set([...current.uncertainties, ...finding.uncertainties])].slice(0, 8) };
    } else {
      merged.push({ ...finding, detection_confidence: Math.min(finding.detection_confidence, 0.49), include_policy: finding.model_decision.action === "include" ? "include" : "exclude", uncertainties: [...finding.uncertainties, "Verifier-only finding resolved automatically."].slice(0, 8) });
    }
  }
  return merged;
}

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
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
    const action = mode === "perceptual"
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

export async function analizarReferenciasV2(chat: ChatPort, referencias: ImagenEtiquetada[], catalogo: ReferenceCatalogItem[] = [], mode: AnalysisMode = "legacy", telemetria?: ContextoTelemetriaIA): Promise<AnalisisV2Resultado> {
  if (!referencias.length) throw new Error("At least one reference image is required.");
  const inventorySystem = mode === "perceptual" ? INVENTORY_SYSTEM_PERCEPTUAL : INVENTORY_SYSTEM;
  const auditSystem = mode === "perceptual" ? AUDIT_SYSTEM_PERCEPTUAL : AUDIT_SYSTEM;
  // En modo perceptual nunca se manda el catálogo al modelo: no hay nada
  // válido que pueda elegir, y mandarlo solo lo tentaría a inventar un id.
  const catalogText = mode === "perceptual"
    ? "Not applicable in this mode."
    : catalogo.length
      ? catalogo.map((item) => JSON.stringify({ id: item.id, name: item.nombre, category: item.categoria, colors: item.colores, description: item.descripcion.slice(0, 180) })).join("\n")
      : "No catalog products supplied.";
  const systemPromptHash = createHash("sha256").update(ANALYSIS_PARSER_VERSION).update(mode).update(inventorySystem).update(auditSystem).update(REAR_LAYER_RULE).update(catalogText).digest("hex");
  const key = analysisCacheKey({ model: chat.modelo, systemPromptHash, images: referencias.map((image) => ({ image_id: image.id, mime: image.mime, base64: image.base64 })) });
  const cached = cache.get(key);
  if (cached) return cached;
  const ids = referencias.map((reference) => reference.id);
  const bytesImagenEntrada = referencias.reduce((total, image) => total + bytesBase64(image.base64), 0);
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
        promptVersion: systemPromptHash.slice(0, 16),
      });
      return turno;
    } catch (error) {
      registrarGemini({ flujo: "analisis_referencia", capacidad, modelo: chat.modelo, inicio, resultado: resultadoTelemetria(error), contexto: { superficie: "/api/references/analyze", ...telemetria, intento }, bytesImagenEntrada, promptVersion: systemPromptHash.slice(0, 16) });
      throw error;
    }
  };
  const inventoryTurn = await ejecutarPaso("analisis_referencia_inventario", {
    sistema: mode === "perceptual" ? `${inventorySystem}\n${REAR_LAYER_RULE}` : `${inventorySystem}\n${REAR_LAYER_RULE}\n\nVALID CATALOG PRODUCTS\n${catalogText}`,
    historial: [{ rol: "usuario", texto: `Inventory these references and resolve every element automatically. Preserve exact image IDs in this order: ${ids.join(", ")}. Return one model_decision per element.`, imagenes: referencias }],
    herramientas: [TOOL],
    temperatura: 0,
    maxTokens: 6000,
  }, 1);
  const inventoryRaw = toolArgs(inventoryTurn, TOOL.nombre);
  const draftJson = JSON.stringify(inventoryRaw).slice(0, 24000);
  const auditTurn = await ejecutarPaso("analisis_referencia_auditoria", {
    sistema: mode === "perceptual" ? `${auditSystem}\n${REAR_LAYER_RULE}` : `${auditSystem}\n${REAR_LAYER_RULE}\n\nVALID CATALOG PRODUCTS\n${catalogText}`,
    historial: [{ rol: "usuario", texto: `Audit the draft inventory below against the same references. Keep exact image IDs. Resolve every finding automatically.\n<DRAFT_INVENTORY>${draftJson}</DRAFT_INVENTORY>`, imagenes: referencias }],
    herramientas: [AUDIT_TOOL],
    temperatura: 0,
    maxTokens: 4000,
  }, 1);
  const auditRaw = toolArgs(auditTurn, AUDIT_TOOL.nombre);
  const blueprint = buildBlueprint(referencias, inventoryRaw, auditRaw, mode === "perceptual" ? [] : catalogo, mode);
  const result: AnalisisV2Resultado = {
    blueprint,
    metadata: {
      passes: ["inventory", "audit"],
      cache_key: key,
      system_prompt_hash: systemPromptHash,
      requires_review: false,
      unresolved_count: 0,
      default_approval_rule: mode === "perceptual"
        ? "Model only decides visual relevance (include/omit); no catalog id is ever produced here — the chat resolves real products against the validated RAG catalog."
        : "Model decides include, omit, or closest catalog substitution automatically; customer approval is never required.",
    },
  };
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!);
  cache.set(key, result);
  return result;
}
