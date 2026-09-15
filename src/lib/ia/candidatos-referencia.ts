import type { ReferenceBlueprintV2, ReferenceBBox } from "./reference-blueprint";
import { bboxContainment, bboxOverlap } from "./reference-blueprint";
import {
  alignVerticalPosition,
  inferStructureFromName,
  isLooseFloorBalloons,
  isNonDecorativeBalloon,
  normalizeFinishColors,
  parseCompositionRelevance,
  parseDetectedStructure,
  shapeDescription,
  shouldSplitSidePieces,
  splitSidePieces,
  structureCountFromName,
  structureTypeFromName,
  type CompositionRelevance,
  type DetectedStructure,
} from "./reference-structure";

/**
 * Provider output of the reference analysis → candidates (#2, #8, #9, #12–#16).
 * Pure normalization of untrusted tool arguments: field aliases, bounded
 * numbers and boxes, category and layer inference, the deterministic review
 * of balloon detections, and the merge of verifier findings into the
 * inventory. No provider, cache or blueprint assembly
 * (analizar-referencias-v2.ts owns those).
 */

export type Candidate = {
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
  structure?: DetectedStructure;
  relevance?: CompositionRelevance;
  model_decision: {
    action: "include" | "omit";
    catalog_product_id?: string;
    match_type: "exact" | "closest" | "none";
    reason: string;
    adaptation: string;
    bill_of_materials?: Array<{ catalog_product_id: string; role: string; share: number }>;
  };
};

export function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function stringValue(value: unknown, fallback: string, max = 320): string {
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

export function stringList(value: unknown, max = 8): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim().slice(0, 80)).slice(0, max) : [];
}

function numberValue(value: unknown, fallback: number, min = 0, max = 1): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(",", ".")) : NaN;
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback;
}

function bbox(value: unknown): ReferenceBBox {
  const source = object(value);
  const x = numberValue(source.x, 0.1, 0, 0.99);
  const y = numberValue(source.y, 0.1, 0, 0.99);
  // Keep the box inside the image: the UI crops each piece from it.
  return {
    x,
    y,
    width: Math.min(numberValue(source.width, 0.2, 0.01), 1 - x),
    height: Math.min(numberValue(source.height, 0.2, 0.01), 1 - y),
  };
}

export function category(value: unknown): Candidate["category"] {
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
  // Whole words, and a draped table is still furniture: "Draped High Cocktail
  // Table" used to become a curtain through the substring "drape".
  if (text.includes("cortin") || /\bdrap(?:e|es|ed|ery|eries|ing)\b/.test(text) || /\btelas?\b/.test(text)) {
    return /\b(?:tables?|mesas?|chairs?|sillas?|sofas?|benches?|stools?|counters?)\b/.test(text) ? "furniture" : "curtain";
  }
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
  const fallbackCategory = rawCategory === "other" ? category(semanticText) : rawCategory;
  // Evidence often mentions neighbouring balloons ("paper bag in front of the
  // balloon arch"); that alone must not turn a named prop into a balloon
  // structure the plan would then have to build.
  const namedProp = input.name !== "unidentified decorative element" && category(input.name) !== "balloon_structure";
  const inferredCategory = rawCategory === "other" && fallbackCategory === "balloon_structure" && namedProp ? "other" : fallbackCategory;
  const text = normalize(semanticText);
  const nameText = normalize(input.name);
  // Whole words only: "led" used to match "confetti-filled" or "curled" and
  // demote a balloon structure to lighting.
  const hasLighting = /\b(?:luz|luces|leds?|foquitos?|iluminacion|iluminado)\b/.test(text);
  // Balloons wrapped in string lights are still a balloon structure: the
  // declared category wins over lighting cues in the evidence.
  if (rawCategory === "balloon_structure") return { category: rawCategory, scene_role: sceneRole(input.explicitSceneRole) };
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
  const finalRole = ["curtain", "drape", "backdrop", "panel"].includes(finalCategory) || (!hasLighting && !["furniture", "tableware", "plinth"].includes(finalCategory) && /cortin|telon|drape|tela|fondo|backdrop|muro|panel/.test(text))
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

function quantityValue(raw: unknown): Candidate["quantity"] {
  const quantity = object(raw);
  const min = Math.round(numberValue(quantity.min, 1, 0, 999));
  const max = Math.max(min, Math.round(numberValue(quantity.max, min, 0, 999)));
  return { mode: quantity.mode === "exact" ? "exact" : quantity.mode === "range" ? "range" : "approximate", min, max };
}

type BalloonReview = {
  category: Candidate["category"];
  structure?: DetectedStructure;
  /** Forces model_decision.action to omit: not a quotable structure. */
  reject: boolean;
  notes: string[];
};

/**
 * Deterministic review of a balloon detection (#2, #12). A balloon structure
 * is only approvable with a typed structure: the model's own, or one named
 * unambiguously ("guirnalda", "column"). Hot air balloons and soap bubbles
 * are not decoration; loose floor balloons and untyped foil are not a
 * structure a quote can build.
 */
function reviewBalloonDetection(category: Candidate["category"], rawStructure: unknown, name: string, evidence: string, box: ReferenceBBox): BalloonReview {
  if (category !== "balloon_structure") return { category, reject: false, notes: [] };
  if (isNonDecorativeBalloon(name) && !structureTypeFromName(name) && !/\b(?:foil|mylar|latex|metalizad[oa]s?)\b/i.test(name)) {
    return { category: "other", reject: true, notes: ["Not event balloon decoration (hot air balloon, bubble or similar)."] };
  }
  if (isLooseFloorBalloons(name, evidence)) {
    return { category, reject: true, notes: ["Loose balloons on the floor are not a built structure."] };
  }
  const parsed = parseDetectedStructure(rawStructure);
  if (parsed) return { category, structure: alignVerticalPosition(parsed, box), reject: false, notes: [] };
  const inferred = inferStructureFromName(name, box);
  if (inferred) return { category, structure: inferred, reject: false, notes: ["Structure type inferred from the element name."] };
  return { category, reject: true, notes: ["Balloon element without a structure type; not quoted as a structure."] };
}

export function parseCandidates(imageId: string, raw: unknown): Candidate[] {
  const source = object(raw);
  const elements = Array.isArray(source.elements) ? source.elements : [];
  return elements.slice(0, 40).flatMap((item): Candidate[] => {
    const value = object(item);
    const confidence = numberValue(value.detection_confidence ?? value.confidence, 0.45);
    const detectedName = firstString(value, ["name", "element", "element_name", "element_type", "object", "item", "object_name", "item_name", "label", "title", "nombre", "elemento", "tipo_elemento", "tipo", "visual_description", "element_description", "descripcion_visual", "description", "descripcion"], "unidentified decorative element", 160);
    const visibleEvidence = firstString(value, ["visible_evidence", "evidence", "visual_evidence", "observation", "observations", "visual_description", "element_description", "description", "descripcion"], "Visible decorative form; details are uncertain.", 320);
    const material = firstString(value, ["material", "material_texture", "texture", "materiales", "textura"], "material not determinable", 160);
    const shape = firstString(value, ["shape", "form", "silhouette", "forma"], "shape not determinable", 160);
    const composition = firstString(value, ["composition", "composicion", "color_mix", "mix"], "single uniform material", 240);
    const referenceBox = bbox(value.reference_bbox ?? value.bbox ?? value.bounding_box ?? value.box ?? value.location);
    // A typed balloon `structure` on an element named as balloons is a balloon
    // structure even if the model wrote another category (a half-arch wrapped in
    // fairy lights came back as "lighting" and vanished from the plan).
    const typedBalloonStructure = parseDetectedStructure(value.structure) !== undefined && /\b(?:balloons?|globos?)\b/.test(normalize(detectedName));
    const layer = inferReferenceLayer({ explicitCategory: typedBalloonStructure ? "balloon_structure" : value.category ?? value.element_category ?? value.tipo ?? value.tipo_elemento, explicitSceneRole: value.scene_role, name: detectedName, evidence: visibleEvidence, material, shape });
    // Every balloon structure must come with its typed `structure`; one without it
    // whose name is a non-balloon prop ("paper bag with plants") is misfiled.
    const misfiledProp = layer.category === "balloon_structure"
      && parseDetectedStructure(value.structure) === undefined
      && /\b(?:bags?|boxe?s?|bolsas?|cajas?|plants?|planters?|pots?|signs?|rugs?|carpets?|runners?|lights?|leaves|foliage|candles?)\b/.test(normalize(detectedName))
      && !/\b(?:balloons?|globos?|arch|arco|garland|guirnalda|column|columna)\b/.test(normalize(detectedName));
    const review = reviewBalloonDetection(misfiledProp ? "other" : layer.category, value.structure, detectedName, visibleEvidence, referenceBox);
    const detectedCategory = review.category;
    const structure = review.structure;
    const defaultInclude = ["curtain", "drape", "backdrop"].includes(detectedCategory) && confidence >= 0.5;
    const relationships = Array.isArray(value.relationships) ? value.relationships.slice(0, 8).map((relation) => {
      const rel = object(relation);
      return { type: relationType(rel.type), target_element_id: stringValue(rel.target_element_id ?? rel.target, "unknown", 80) };
    }) : [];
    const rawDecision = object(value.model_decision ?? value.decision);
    const explicitAction = rawDecision.action ?? value.action;
    const relevance = parseCompositionRelevance(value.composition_relevance ?? value.relevance);
    // A negligible element never enters the composition, whatever action the model wrote.
    const action = review.reject || relevance === "minor" ? "omit" : explicitAction === "omit" ? "omit" : explicitAction === "include" ? "include" : defaultInclude ? "include" : "omit";
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
    const rawColors = stringList(value.observed_colors ?? value.colors ?? value.colours ?? value.colores ?? value.palette, 8);
    const observedColors = detectedCategory === "balloon_structure" ? normalizeFinishColors(rawColors, `${visibleEvidence} ${material} ${composition}`) : rawColors;
    let quantity = quantityValue(value.quantity);
    const declaredCount = structure ? structureCountFromName(detectedName, structure.type) : undefined;
    if (declaredCount && quantity.max <= 1) {
      quantity = { mode: declaredCount.exact ? "exact" : "approximate", min: declaredCount.count, max: declaredCount.count };
    }
    const base: Candidate = {
      source_image_id: imageId,
      name: detectedName,
      category: detectedCategory,
      scene_role: layer.scene_role,
      detection_confidence: confidence,
      visible_evidence: visibleEvidence,
      reference_bbox: referenceBox,
      depth_layer: Math.round(numberValue(value.depth_layer, 2, 0, 99)),
      include_policy: defaultInclude ? "include" : "ask",
      source_type: "reference_only",
      quantity,
      observed_colors: observedColors,
      material,
      shape: structure ? shapeDescription(structure) : shape,
      composition,
      relationships,
      uncertainties: [...review.notes, ...stringList(value.uncertainties, 8)].slice(0, 8),
      structure,
      relevance,
      model_decision: {
        action,
        catalog_product_id: catalogProductId,
        match_type: catalogProductId ? matchType === "none" ? "closest" : matchType : "none",
        reason: stringValue(rawDecision.reason ?? value.catalog_match_reason, action === "include" ? "Modelo resolvió incluir el elemento." : "Modelo resolvió omitir el elemento.", 260),
        adaptation: stringValue(rawDecision.adaptation ?? value.adaptation, "Adaptar escala, material y color al catálogo disponible.", 260),
        bill_of_materials: billOfMaterials.length ? billOfMaterials : undefined,
      },
    };
    if (!structure || !shouldSplitSidePieces(structure, referenceBox, detectedName, visibleEvidence)) return [base];
    // #9: one full-width detection with explicit left/right evidence is two pieces.
    return splitSidePieces(structure, referenceBox).map((piece) => ({
      ...base,
      name: `${detectedName.slice(0, 150)} (${piece.side})`,
      reference_bbox: piece.bbox,
      structure: piece.structure,
      shape: shapeDescription(piece.structure),
      quantity: { mode: base.quantity.mode, min: Math.max(1, Math.floor(base.quantity.min / 2)), max: Math.max(1, Math.ceil(base.quantity.max / 2)) },
      uncertainties: [...base.uncertainties, "Split from one detection spanning both sides (left/right evidence)."].slice(0, 8),
    }));
  });
}

function extractJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(cleaned);
}

export function toolArgs(turn: { llamadas: Array<{ nombre: string; args: Record<string, unknown> }>; texto: string }, toolName: string): Record<string, unknown> {
  return turn.llamadas.find((call) => call.nombre === toolName)?.args ?? object(extractJson(turn.texto));
}

/** Verifier-only findings below this confidence are recorded but never approved (#8). */
export const VERIFIER_MIN_CONFIDENCE = 0.6;
/** Share of the smaller box covered by the other one that makes two same-kind detections one piece. */
const DUPLICATE_MIN_CONTAINMENT = 0.2;

function sameKind(a: Candidate, b: Candidate): boolean {
  return a.category === b.category && (a.structure?.type ?? null) === (b.structure?.type ?? null);
}

function duplicatesExisting(finding: Candidate, existing: Candidate[]): boolean {
  return existing.some((item) => item.source_image_id === finding.source_image_id
    && sameKind(item, finding)
    && Math.max(bboxContainment(finding.reference_bbox, item.reference_bbox), bboxContainment(item.reference_bbox, finding.reference_bbox)) >= DUPLICATE_MIN_CONTAINMENT);
}

export function mergeCandidates(inventory: Candidate[], audit: Candidate[]): Candidate[] {
  const merged = [...inventory];
  for (const finding of audit) {
    const match = merged.findIndex((item) => item.source_image_id === finding.source_image_id && bboxOverlap(item.reference_bbox, finding.reference_bbox) >= 0.35);
    if (match >= 0) {
      const current = merged[match];
      const strongerCategory = current.category === "other" && finding.category !== "other" ? finding.category : current.category;
      const strongerRole = current.scene_role === "midground" && finding.scene_role !== "midground" ? finding.scene_role : current.scene_role;
      merged[match] = { ...current, structure: finding.structure ?? current.structure, shape: finding.structure ? finding.shape : current.shape, category: strongerCategory, scene_role: strongerRole, name: current.name === "unidentified decorative element" ? finding.name : current.name, visible_evidence: finding.visible_evidence, uncertainties: [...new Set([...current.uncertainties, ...finding.uncertainties])].slice(0, 8) };
    } else {
      // A verifier-only finding is approved only when the verifier is confident
      // and it is not a second copy of a piece already in the inventory: F10
      // got a third, non-existent ceiling cloud (confidence 0.49) approved.
      const lowConfidence = finding.detection_confidence < VERIFIER_MIN_CONFIDENCE;
      const duplicate = duplicatesExisting(finding, merged);
      const approve = finding.model_decision.action === "include" && !lowConfidence && !duplicate;
      const note = duplicate
        ? "Verifier-only finding duplicates an existing element; not approved."
        : lowConfidence
          ? "Verifier-only finding below the confidence threshold; not approved."
          : "Verifier-only finding resolved automatically.";
      merged.push({
        ...finding,
        detection_confidence: Math.min(finding.detection_confidence, 0.49),
        include_policy: approve ? "include" : "exclude",
        model_decision: approve ? finding.model_decision : { ...finding.model_decision, action: "omit", catalog_product_id: undefined, match_type: "none", bill_of_materials: undefined },
        uncertainties: [note, ...finding.uncertainties].slice(0, 8),
      });
    }
  }
  return merged;
}

export function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
