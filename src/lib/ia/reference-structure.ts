import type { ReferenceBBox, ReferenceBlueprintV2 } from "./reference-blueprint";
import type { LoraDensity, LoraDesignRole, LoraPlacement, LoraStructureType, VisualSemantics } from "./lora-semantics";

/**
 * Typed structure detection for reference images.
 *
 * The reference analysis used to return a balloon structure only as
 * `balloon_structure` plus free-text shape, so the chat guessed the plan
 * structure types (two asymmetrical half-arches became "column + half-arch +
 * garland"). Gemini now returns these fields per balloon structure; this
 * module validates them and maps them deterministically to the existing
 * `visual_semantics` contract, which the chat and the LoRA compiler already
 * understand. Pure: no provider, HTTP or environment access.
 */

export const DETECTED_STRUCTURE_TYPES = [
  "arch", "half_arch", "column", "garland", "balloon_wall", "centerpiece",
  "ceiling_installation", "cluster", "sculpture", "bouquet", "hoop",
] as const;
export const DETECTED_OUTLINES = ["symmetric", "asymmetric"] as const;
export const DETECTED_DENSITIES = ["dense", "medium", "airy"] as const;
export const DETECTED_POSITIONS = ["left", "center", "right", "full_width"] as const;
export const DETECTED_HEIGHTS = ["short", "medium", "tall"] as const;
export const DETECTED_CURVES = ["left", "right", "none"] as const;
/** How far the top of a vertical piece reaches sideways past its base, relative to its height. */
export const DETECTED_OVERHANGS = ["none", "slight", "strong"] as const;
export const COMPOSITION_RELEVANCE = ["essential", "supporting", "minor"] as const;

export type DetectedStructure = {
  type: (typeof DETECTED_STRUCTURE_TYPES)[number];
  position: (typeof DETECTED_POSITIONS)[number];
  relativeHeight: (typeof DETECTED_HEIGHTS)[number];
  curvesToward: (typeof DETECTED_CURVES)[number];
  grounded: boolean;
  /** Irregular outline or one side heavier (official "asimétrico" variants). */
  outline: (typeof DETECTED_OUTLINES)[number];
  /** Balloon packing: dense (no gaps) or airy (visible gaps). */
  density: (typeof DETECTED_DENSITIES)[number];
  /** Name of the element this one mirrors symmetrically, when there is one. */
  mirrors?: string;
};

export type CompositionRelevance = (typeof COMPOSITION_RELEVANCE)[number];

/** JSON Schema fragment sent to the analysis model, kept next to its parser. */
export const DETECTED_STRUCTURE_TOOL_SCHEMA = {
  type: "object",
  description: "Only for balloon structures. Describe the built shape as seen, not the product.",
  properties: {
    structure_type: { type: "string", enum: [...DETECTED_STRUCTURE_TYPES] },
    horizontal_position: { type: "string", enum: [...DETECTED_POSITIONS] },
    relative_height: { type: "string", enum: [...DETECTED_HEIGHTS], description: "Compared with the other balloon structures in the same image." },
    curves_toward: { type: "string", enum: [...DETECTED_CURVES], description: "Direction the top of a half-arch or arch bends toward; none for straight pieces." },
    top_overhang: { type: "string", enum: [...DETECTED_OVERHANGS], description: "Vertical pieces only: how far the top reaches sideways past the base, compared with the piece height. none = under 10%, slight = 10-35% (a leaning or lumpy column), strong = over 35% (a real bend)." },
    grounded: { type: "boolean", description: "True when it stands on the floor." },
    outline: { type: "string", enum: [...DETECTED_OUTLINES], description: "asymmetric when the outline is irregular or one side is clearly heavier or taller." },
    density: { type: "string", enum: [...DETECTED_DENSITIES], description: "dense = no gaps between balloons; airy = visible gaps." },
    mirrors_element: { type: "string", description: "Name of the element it mirrors symmetrically, or none." },
  },
} as const;

export const STRUCTURE_DETECTION_RULES = `For every balloon structure also return \`structure\`: structure_type (arch = one continuous curve with two feet on the floor; half_arch = a single rising side whose top clearly bends sideways, open at the top or with only one foot; column = vertical stack whose top stays roughly above its base, even if the outline is lumpy or leans slightly; always return top_overhang for vertical pieces, it decides between half_arch and column); garland = loose organic run along a surface or the floor; balloon_wall; centerpiece; ceiling_installation; cluster; sculpture = a figure built from balloons such as an animal, number or character; bouquet = balloons tied together floating or on a weight; hoop = circular frame covered in balloons), outline (symmetric or asymmetric), density (dense, medium or airy), horizontal_position, relative_height compared with the other balloon structures, curves_toward, top_overhang, grounded, and mirrors_element. Two separate pieces that leave a visible gap between them are two elements, never one arch: for example a short leaning column on the left and a tall half-arch on the right curving toward it.
For every element return composition_relevance: essential (defines the composition), supporting (clearly visible styling such as string lights, foliage or props next to the decoration), or minor (negligible). Minor elements must use model_decision.action "omit".`;

function oneOf<T extends readonly string[]>(values: T, value: unknown): T[number] | undefined {
  const text = typeof value === "string" ? value.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
  return (values as readonly string[]).includes(text) ? text as T[number] : undefined;
}

/** Validates the model's `structure` object; anything malformed is discarded, never guessed. */
export function parseDetectedStructure(raw: unknown): DetectedStructure | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  const type = oneOf(DETECTED_STRUCTURE_TYPES, value.structure_type ?? value.type);
  if (!type) return undefined;
  const mirrors = typeof value.mirrors_element === "string" ? value.mirrors_element.trim().slice(0, 160) : "";
  // half_arch vs column flipped between runs of the same photo. The ordinal
  // overhang decides it deterministically: only a strong sideways reach is a
  // half-arch; a slight lean is an irregular (asymmetrical) column.
  const overhang = oneOf(DETECTED_OVERHANGS, value.top_overhang);
  const vertical = type === "half_arch" || type === "column";
  const resolvedType = vertical && overhang ? (overhang === "strong" ? "half_arch" : "column") : type;
  const leaningColumn = resolvedType === "column" && overhang === "slight";
  return {
    type: resolvedType,
    position: oneOf(DETECTED_POSITIONS, value.horizontal_position ?? value.position) ?? "center",
    relativeHeight: oneOf(DETECTED_HEIGHTS, value.relative_height) ?? "medium",
    curvesToward: resolvedType === "column" && overhang ? "none" : oneOf(DETECTED_CURVES, value.curves_toward) ?? "none",
    grounded: value.grounded !== false,
    outline: leaningColumn ? "asymmetric" : oneOf(DETECTED_OUTLINES, value.outline) ?? "symmetric",
    density: oneOf(DETECTED_DENSITIES, value.density) ?? "medium",
    mirrors: mirrors && !/^(?:none|null|n\/a|no)$/i.test(mirrors) ? mirrors : undefined,
  };
}

export function parseCompositionRelevance(raw: unknown): CompositionRelevance | undefined {
  return oneOf(COMPOSITION_RELEVANCE, raw);
}

const STRUCTURE_TYPE_MAP: Record<DetectedStructure["type"], LoraStructureType> = {
  arch: "arco",
  half_arch: "semiarco",
  column: "columna",
  garland: "guirnalda",
  balloon_wall: "pared",
  centerpiece: "centro_mesa",
  ceiling_installation: "guirnalda",
  cluster: "kit",
  // Plan 1.0 has no bouquet or sculpture type: both are built as a declared kit
  // and recognized by their official name (see estructuras-oficiales.ts).
  sculpture: "kit",
  bouquet: "kit",
  hoop: "arco",
};

function placementFor(structure: DetectedStructure, bbox: ReferenceBBox): LoraPlacement {
  if (structure.type === "ceiling_installation") return "techo";
  if (structure.type === "centerpiece") return "sobre_mesa_principal";
  if (structure.type === "bouquet" || structure.type === "sculpture") return structure.position === "left" ? "lateral_izquierdo" : structure.position === "right" ? "lateral_derecho" : "piso_frontal";
  if (structure.type === "balloon_wall" || structure.position === "full_width") return "fondo_pared";
  if (structure.position === "left") return "lateral_izquierdo";
  if (structure.position === "right") return "lateral_derecho";
  const lowOnFloor = bbox.y + bbox.height >= 0.75 && bbox.height <= 0.35;
  if (structure.type === "garland" && lowOnFloor) return "piso_frontal";
  return "arco_central";
}

export function shapeDescription(structure: DetectedStructure): string {
  const noun = structure.type === "half_arch" ? "half-arch" : structure.type === "hoop" ? "circular hoop" : structure.type.replace(/_/g, " ");
  const qualifiers = [structure.relativeHeight, structure.density === "dense" ? "dense" : structure.density === "airy" ? "airy" : "", structure.outline === "asymmetric" ? "asymmetrical" : ""].filter(Boolean).join(" ");
  const parts = [`${qualifiers} ${noun}`, structure.position === "full_width" ? "spanning the full width" : `on the ${structure.position}`];
  if (structure.curvesToward !== "none") parts.push(`curving toward the ${structure.curvesToward}`);
  parts.push(structure.grounded ? "standing on the floor" : "raised off the floor");
  if (structure.mirrors) parts.push(`mirroring ${structure.mirrors}`);
  return parts.join(", ").slice(0, 160);
}

type ElementForSemantics = {
  elementId: string;
  bbox: ReferenceBBox;
  structure?: DetectedStructure;
};

/**
 * Maps detected structures to `visual_semantics`. The largest balloon
 * structure is focal; the rest support it. Elements without a detected
 * structure keep no semantics, so nothing is invented for them.
 */
export function referenceStructureSemantics(
  elements: ElementForSemantics[],
  density: ReferenceBlueprintV2["composition"]["density"],
): Map<string, VisualSemantics> {
  const structures = elements.filter((element): element is ElementForSemantics & { structure: DetectedStructure } => Boolean(element.structure));
  const focal = [...structures].sort((a, b) => b.bbox.width * b.bbox.height - a.bbox.width * a.bbox.height)[0];
  const loraDensity: LoraDensity = density === "dense" ? "lujosa" : density === "sparse" ? "sencilla" : "media";
  return new Map(structures.map((element) => {
    const role: LoraDesignRole = element === focal ? "focal" : element.structure.type === "centerpiece" ? "acento" : "soporte";
    return [element.elementId, {
      structure_type: STRUCTURE_TYPE_MAP[element.structure.type],
      placement: placementFor(element.structure, element.bbox),
      design_role: role,
      repetition_group: element.elementId,
      density: element.structure.density === "dense" ? "lujosa" : element.structure.density === "airy" ? "sencilla" : loraDensity,
    } satisfies VisualSemantics];
  }));
}

const AMBIENT_CATEGORIES = new Set(["lighting", "floral", "furniture", "plinth", "tableware", "other"]);
// Plurals count: "wooden signs" carries lettering just like "sign".
const NON_RENDERABLE_TEXT = /\b(?:signs?|signage|letters?|lettering|texts?|names?|logos?|words?|messages?|banners?|numbers?|prices?|printed|writing)\b/i;
/** The analysis answers in English; a Spanish name would leak untranslated text into the LoRA prompt. */
const SPANISH_WORDS = /\b(?:de|del|la|las|los|el|con|y|para|globos?|hojas?|luces|luz|flores?|velas?|mesa|cortina)\b/i;

/**
 * Renderable English name for a styling element, or undefined. Parenthetical
 * details ("tropical leaves (monstera)") and list punctuation are dropped
 * instead of discarding the whole element; anything that names text or
 * signage, or is not plain English, is still rejected.
 */
export function ambientDecorName(raw: string): string | undefined {
  const name = raw
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[,;/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:a|an|the|some) /, "");
  // Balloons are never ambient styling: they are quoted plan structures.
  if (!/^[a-z][a-z -]{2,48}$/.test(name) || NON_RENDERABLE_TEXT.test(raw) || SPANISH_WORDS.test(name) || /\bballoons?\b/.test(name)) return undefined;
  return name;
}

export type AmbientDecorItem = { elementId: string; name: string };

/**
 * Styling seen in the reference that the catalog does not sell (string
 * lights, foliage, props). It is rendered only when the analysis kept it as
 * relevant (approved) with enough confidence, it is not already materialized
 * by an approved plan structure, and its name is plain English without text
 * or signage (the image model would invent lettering). Never quoted.
 */
export function ambientDecorSelection(
  blueprint: ReferenceBlueprintV2,
  materializedElementIds: ReadonlySet<string>,
  limit = 3,
): AmbientDecorItem[] {
  const seen = new Set<string>();
  const items: AmbientDecorItem[] = [];
  const candidates = blueprint.elements
    .filter((element) => element.approved
      && AMBIENT_CATEGORIES.has(element.category)
      && element.detection_confidence >= 0.6
      && !materializedElementIds.has(element.element_id))
    .sort((a, b) => b.detection_confidence - a.detection_confidence || b.reference_bbox.width * b.reference_bbox.height - a.reference_bbox.width * a.reference_bbox.height);
  for (const element of candidates) {
    const name = ambientDecorName(element.name);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    items.push({ elementId: element.element_id, name });
    if (items.length >= limit) break;
  }
  return items;
}

export function ambientDecorFromReference(
  blueprint: ReferenceBlueprintV2,
  materializedElementIds: ReadonlySet<string>,
  limit = 3,
): string[] {
  return ambientDecorSelection(blueprint, materializedElementIds, limit).map((item) => item.name);
}
