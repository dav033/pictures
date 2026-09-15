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
  /** Sideways reach of the top of a vertical piece, as the model reported it. */
  topOverhang?: (typeof DETECTED_OVERHANGS)[number];
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

export const STRUCTURE_DETECTION_RULES = `For every balloon structure also return \`structure\`: structure_type (arch = one continuous curve with two feet on the floor; half_arch = a single rising side whose top clearly bends sideways, open at the top or with only one foot; column = vertical stack whose top stays roughly above its base, even if the outline is lumpy or leans slightly; always return top_overhang for vertical pieces, it decides between half_arch and column); garland = loose organic run along a surface or the floor; balloon_wall; centerpiece; ceiling_installation; cluster; sculpture = a figure built from balloons such as an animal, number or character; bouquet = balloons tied together floating or on a weight; hoop = circular frame covered in balloons), outline (symmetric or asymmetric), density (dense, medium or airy), horizontal_position, relative_height compared with the other balloon structures, curves_toward, top_overhang, grounded, and mirrors_element. Two separate pieces that leave a visible gap between them are two elements, never one arch: for example a short leaning column on the left and a tall half-arch on the right curving toward it. horizontal_position full_width is only for one continuous piece (a balloon wall, an arch, a garland that runs unbroken across the scene); two columns, half-arches, garlands or bouquets on opposite sides are two elements, one left and one right. Balloons lying loose or scattered on the floor are not a garland or any other structure: name them "loose balloons" and omit structure. Foil balloons, figures, numbers or letters fixed onto a balloon wall or another balloon structure belong to that structure: mention them in its composition instead of returning a separate structure. Only real event balloon decoration is a balloon structure; a hot air balloon, a kite or a soap bubble is not. When one element groups several identical separate pieces (for example two columns side by side), set quantity to that count.
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
    ...(vertical && overhang ? { topOverhang: overhang } : {}),
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

/** Horizontal side of a bbox by its center; the middle 20% counts as center. */
export function sideFromBBox(bbox: ReferenceBBox): "left" | "center" | "right" {
  const center = bbox.x + bbox.width / 2;
  return center < 0.4 ? "left" : center > 0.6 ? "right" : "center";
}

function placementFor(structure: DetectedStructure, bbox: ReferenceBBox): LoraPlacement {
  if (structure.type === "ceiling_installation") return "techo";
  if (structure.type === "centerpiece") return "sobre_mesa_principal";
  // A low, short run at the bottom of the frame lies on the floor even when it
  // spans the whole width; this rule used to run after `full_width` and sent
  // floor garlands to the back wall.
  const lowOnFloor = bbox.y + bbox.height >= 0.75 && bbox.height <= 0.35;
  if (structure.type === "garland" && lowOnFloor) return "piso_frontal";
  if (structure.type === "bouquet" || structure.type === "sculpture") return structure.position === "left" ? "lateral_izquierdo" : structure.position === "right" ? "lateral_derecho" : "piso_frontal";
  // A balloon arch (or hoop) is a freestanding piece: equivalent photos came
  // back as "against the back wall" or "in the center" depending on whether
  // the model called it full_width.
  if (structure.type === "arch" || structure.type === "hoop") return "arco_central";
  if (structure.type === "balloon_wall") return "fondo_pared";
  // A single vertical piece is never full-width or centered by itself when its
  // bbox sits clearly on one side (a left half-arch came back as "fondo").
  const vertical = structure.type === "half_arch" || structure.type === "column";
  const position = vertical && structure.position !== "left" && structure.position !== "right" && sideFromBBox(bbox) !== "center"
    ? sideFromBBox(bbox)
    : structure.position;
  if (position === "full_width") return "fondo_pared";
  if (position === "left") return "lateral_izquierdo";
  if (position === "right") return "lateral_derecho";
  return "arco_central";
}

export function shapeDescription(structure: DetectedStructure): string {
  const noun = structure.type === "half_arch" ? "half-arch" : structure.type === "hoop" ? "circular hoop" : structure.type.replace(/_/g, " ");
  const qualifiers = [structure.relativeHeight, structure.density === "dense" ? "dense" : structure.density === "airy" ? "airy" : "", structure.outline === "asymmetric" ? "asymmetrical" : ""].filter(Boolean).join(" ");
  const parts = [`${qualifiers} ${noun}`, structure.position === "full_width" ? "spanning the full width" : `on the ${structure.position}`];
  if (structure.curvesToward !== "none") parts.push(`curving toward the ${structure.curvesToward}`);
  if (structure.topOverhang) parts.push(structure.topOverhang === "none" ? "no top overhang" : `${structure.topOverhang} top overhang`);
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

/* ---------- Deterministic normalization of balloon detections ----------
 * The analysis model is not stable between runs of the same photo, and some
 * of its answers are wrong in ways plain text rules can catch without
 * inventing anything: a "hot air balloon" is not a balloon decoration, a
 * structure named "garland" is a garland even when the typed `structure` was
 * left out, "Left Balloon Columns" is more than one column. Each rule below
 * only uses what the model wrote (names, evidence, bbox). */

function plain(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Things called "balloon"/"bubble" that are not event balloon decoration. */
const NON_DECORATION_BALLOON = /\b(?:hot[- ]?air balloons?|air ?ships?|blimps?|zeppelins?|parachutes?|paragliders?|kites?|speech bubbles?|thought bubbles?|soap bubbles?|bubble machines?|globos? aerostaticos?|pompas? de jabon)\b|\bbubbles?\b(?!\s*balloons?)|\bburbujas?\b(?!\s*(?:de\s+)?globos?)/;

export function isNonDecorativeBalloon(text: string): boolean {
  return NON_DECORATION_BALLOON.test(plain(text));
}

/** Structural nouns in a name, most specific first. */
const STRUCTURE_NOUNS: ReadonlyArray<readonly [RegExp, DetectedStructure["type"]]> = [
  [/\b(?:half[- ]?arch(?:es)?|semi[- ]?arch(?:es)?|semiarcos?|medios? arcos?)\b/, "half_arch"],
  [/\b(?:balloon walls?|walls? of balloons|paredes? de globos|muros? de globos)\b/, "balloon_wall"],
  [/\b(?:ceiling (?:installations?|clouds?|canop(?:y|ies))|balloon clouds?|clouds? of balloons|techos? de globos)\b/, "ceiling_installation"],
  [/\b(?:centerpieces?|centros? de mesa)\b/, "centerpiece"],
  [/\b(?:arch(?:es|way|ways)?|arcos?)\b/, "arch"],
  [/\b(?:columns?|pillars?|towers?|columnas?|torres?)\b/, "column"],
  [/\b(?:garlands?|guirnaldas?)\b/, "garland"],
  [/\b(?:bouquets?|ramilletes?|ramos? de globos)\b/, "bouquet"],
  [/\b(?:clusters?|racimos?)\b/, "cluster"],
  [/\b(?:hoops?|aros?)\b/, "hoop"],
  [/\b(?:sculptures?|esculturas?)\b/, "sculpture"],
];

export function structureTypeFromName(name: string): DetectedStructure["type"] | undefined {
  const text = plain(name);
  return STRUCTURE_NOUNS.find(([pattern]) => pattern.test(text))?.[1];
}

/**
 * Typed structure for a balloon element the model named but did not type.
 * Only the name decides the type (evidence mentions neighbouring pieces);
 * side comes from the bbox. Undefined when the name has no structural noun.
 */
export function inferStructureFromName(name: string, bbox: ReferenceBBox): DetectedStructure | undefined {
  const type = structureTypeFromName(name);
  if (!type) return undefined;
  return {
    type,
    position: bbox.width >= 0.8 ? "full_width" : sideFromBBox(bbox),
    relativeHeight: "medium",
    curvesToward: "none",
    grounded: type !== "ceiling_installation",
    outline: "symmetric",
    density: "medium",
  };
}

/**
 * A single column or half-arch whose bbox sits clearly on one side takes that
 * side, so its shape text and its placement agree (F15: a left half-arch
 * reported as full_width came back "against the back wall").
 */
export function alignVerticalPosition(structure: DetectedStructure, bbox: ReferenceBBox): DetectedStructure {
  const vertical = structure.type === "half_arch" || structure.type === "column";
  if (!vertical || structure.position === "left" || structure.position === "right") return structure;
  const side = sideFromBBox(bbox);
  return side === "center" ? structure : { ...structure, position: side };
}

const LOOSE_BALLOONS = /\b(?:loose|scattered|strewn|sparse|individual)\s+(?:[a-z-]+\s+){0,2}balloons?\b|\bballoons?\s+(?:[a-z-]+\s+){0,2}(?:scattered|strewn|lying|rolling)\b|\bglobos?\s+(?:[a-z-]+\s+){0,2}(?:sueltos?|esparcidos?|regados?|tirados?)\b/;
const ON_FLOOR = /\b(?:on|across) the (?:floor|ground)\b|\ben el (?:piso|suelo)\b|\bfloor balloons?\b/;

/**
 * Balloons lying loose on the floor are not a built structure (a garland,
 * a cluster): a quote cannot build "scattered balloons". Applies only when
 * the name carries no structural noun, so "loose organic garland" stays a
 * garland.
 */
export function isLooseFloorBalloons(name: string, evidence: string): boolean {
  if (structureTypeFromName(name)) return false;
  const text = plain(`${name} ${evidence}`);
  return LOOSE_BALLOONS.test(text) || (ON_FLOOR.test(plain(name)) && /\b(?:balloons?|globos?)\b/.test(plain(name)));
}

const SPLITTABLE_TYPES = new Set<DetectedStructure["type"]>(["column", "half_arch", "garland", "bouquet", "cluster", "sculpture"]);
const BOTH_SIDES = /\b(?:left and right|right and left|on both sides|both sides|each side|either side|two separate|a pair of|izquierd[ao]s? y derech[ao]s?|derech[ao]s? y izquierd[ao]s?|ambos lados|cada lado)\b/;

/**
 * Two separate pieces reported as one `full_width` detection (two garlands
 * framing a stage came back as one). Split only with explicit left/right
 * evidence on a wide bbox: the model gives no gap geometry, so the halves
 * are the only honest boxes. Arches and walls legitimately span both sides.
 */
export function shouldSplitSidePieces(structure: DetectedStructure, bbox: ReferenceBBox, name: string, evidence: string): boolean {
  if (!SPLITTABLE_TYPES.has(structure.type)) return false;
  if (structure.position !== "full_width" && bbox.width < 0.6) return false;
  const text = plain(`${name} ${evidence}`);
  // The side words must be about this piece: "a garland with columns on both
  // sides" is one garland flanked by other pieces, not two garlands.
  return BOTH_SIDES.test(text) && OWN_PLURAL[structure.type].test(text);
}

export function splitSidePieces(structure: DetectedStructure, bbox: ReferenceBBox): Array<{ side: "left" | "right"; structure: DetectedStructure; bbox: ReferenceBBox }> {
  const half = bbox.width / 2;
  return (["left", "right"] as const).map((side) => ({
    side,
    structure: { ...structure, position: side, mirrors: `${side === "left" ? "right" : "left"} piece`, curvesToward: structure.type === "half_arch" ? (side === "left" ? "right" : "left") : structure.curvesToward },
    bbox: { x: side === "left" ? bbox.x : bbox.x + half, y: bbox.y, width: half, height: bbox.height },
  }));
}

const COUNT_WORDS: Readonly<Record<string, number>> = { two: 2, pair: 2, dos: 2, par: 2, three: 3, tres: 3, four: 4, cuatro: 4, five: 5, cinco: 5, six: 6, seis: 6 };
/** Plural nouns of each structure type (folded text). */
const OWN_PLURAL: Readonly<Record<DetectedStructure["type"], RegExp>> = {
  arch: /(?<!half[- ]?)(?<!semi[- ]?)\b(?:arches|archways|arcos)\b/,
  half_arch: /\b(?:half[- ]?arches|semi[- ]?arches|semiarcos|medios arcos)\b/,
  column: /\b(?:columns|pillars|towers|columnas|torres)\b/,
  garland: /\b(?:garlands|guirnaldas)\b/,
  balloon_wall: /\b(?:balloon walls|walls of balloons|paredes de globos|muros de globos)\b/,
  centerpiece: /\b(?:centerpieces|centros de mesa)\b/,
  ceiling_installation: /\b(?:ceiling installations|balloon clouds|clouds of balloons|techos de globos)\b/,
  cluster: /\b(?:clusters|racimos)\b/,
  sculpture: /\b(?:sculptures|esculturas)\b/,
  bouquet: /\b(?:bouquets|ramilletes|ramos de globos)\b/,
  hoop: /\b(?:hoops|aros)\b/,
};

/**
 * Number of identical pieces a structure name declares ("Left Balloon
 * Columns" → 2, "three bouquets" → 3). Only the plural of the element's own
 * type counts: "Balloon garland with columns" is one garland. Undefined for a
 * singular name.
 */
export function structureCountFromName(name: string, type: DetectedStructure["type"]): { count: number; exact: boolean } | undefined {
  const text = plain(name);
  if (!OWN_PLURAL[type].test(text)) return undefined;
  const word = /\b(two|pair|dos|par|three|tres|four|cuatro|five|cinco|six|seis|[2-9])\b/.exec(text)?.[1];
  if (word) return { count: COUNT_WORDS[word] ?? Number(word), exact: true };
  return { count: 2, exact: false };
}

const FINISH_FAMILIES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(?:pearl(?:escent|ized|ised|y)?|nacre(?:ous)?|iridescent|opalescent|satin(?:y)?|perla(?:d[oa]s?)?|perlad[oa]s?|nacarad[oa]s?|satinad[oa]s?)\b/, "pearl"],
  [/\b(?:chrome|chromed|mirror(?:ed)?|reflex|cromad[oa]s?|espejo)\b/, "chrome"],
  [/\b(?:metallic|metalizad[oa]s?|metalic[oa]s?)\b/, "metallic"],
  [/\b(?:matte|mate)\b/, "matte"],
];
const ANY_FINISH = new RegExp(FINISH_FAMILIES.map(([pattern]) => pattern.source).join("|"));
const NO_FINISH_COLOR = /\b(?:clear|transparent|transparente|confetti|not determinable)\b/;

/**
 * Balloon finish vocabulary. The chat maps pearl → satin and chrome → reflex,
 * but pearl balloons came back as plain "purple, white". Synonyms inside a
 * color collapse to the family word, and a single finish named in the
 * element's evidence/material is carried onto its plain colors. Two different
 * finishes in the text are ambiguous, so the colors stay untouched.
 */
export function normalizeFinishColors(colors: string[], text: string): string[] {
  const canonical = colors.map((color) => {
    const family = FINISH_FAMILIES.find(([pattern]) => pattern.test(plain(color)));
    if (!family) return color;
    const rest = plain(color).replace(new RegExp(family[0].source, "g"), " ").replace(/\s+/g, " ").trim();
    return rest ? `${family[1]} ${rest}` : color;
  });
  const families = FINISH_FAMILIES.filter(([pattern]) => pattern.test(plain(text)));
  if (families.length !== 1 || canonical.some((color) => ANY_FINISH.test(plain(color)))) return canonical;
  const finish = families[0]![1];
  return canonical.map((color) => NO_FINISH_COLOR.test(plain(color)) ? color : `${finish} ${color}`.slice(0, 80));
}

const ATTACHABLE_TYPES = new Set<DetectedStructure["type"]>(["sculpture", "bouquet", "cluster", "centerpiece"]);
const ATTACHED_PROP_NAME = /\b(?:foils?|mylar|figures?|characters?|numbers?|letters?|stars?|hearts?|metalizad[oa]s?|figuras?|numeros?|letras?|estrellas?|corazones?)\b/;
const WALL_LIKE_TYPES = new Set<DetectedStructure["type"]>(["balloon_wall", "garland", "ceiling_installation"]);

export type AttachmentCandidate = {
  sourceImageId: string;
  name: string;
  approved: boolean;
  bbox: ReferenceBBox;
  structure?: DetectedStructure;
};

// Local copy of `bboxContainment` (reference-blueprint.ts): this module stays
// free of runtime imports because client components reach it through
// presentacion-cliente.ts, and reference-blueprint pulls node:crypto.
function bboxContainment(inner: ReferenceBBox, outer: ReferenceBBox): number {
  const width = Math.max(0, Math.min(inner.x + inner.width, outer.x + outer.width) - Math.max(inner.x, outer.x));
  const height = Math.max(0, Math.min(inner.y + inner.height, outer.y + outer.height) - Math.max(inner.y, outer.y));
  const area = inner.width * inner.height;
  return area ? (width * height) / area : 0;
}

/**
 * Foil figures stuck on a balloon wall, or three "centerpieces" that are one
 * arrangement, used to be quoted as separate kits. An approved small piece
 * whose bbox lies inside a larger approved balloon structure is part of it
 * when the container is wall-like (wall, garland, ceiling), or the same kind
 * of arrangement, or — for foil/figure props raised off the floor — any
 * structure. Returns inner index → container index (smallest container).
 */
export function attachedStructureContainers(items: AttachmentCandidate[]): Map<number, number> {
  const result = new Map<number, number>();
  items.forEach((inner, i) => {
    if (!inner.approved || !inner.structure) return;
    const propName = ATTACHED_PROP_NAME.test(plain(inner.name));
    if (!ATTACHABLE_TYPES.has(inner.structure.type) && !propName) return;
    const innerArea = inner.bbox.width * inner.bbox.height;
    let best: { index: number; area: number } | undefined;
    items.forEach((outer, j) => {
      if (i === j || !outer.approved || !outer.structure || outer.sourceImageId !== inner.sourceImageId) return;
      const area = outer.bbox.width * outer.bbox.height;
      if (area < innerArea * 2 || bboxContainment(inner.bbox, outer.bbox) < 0.85) return;
      const fits = WALL_LIKE_TYPES.has(outer.structure.type)
        || (outer.structure.type === inner.structure!.type && ATTACHABLE_TYPES.has(inner.structure!.type))
        || (propName && !inner.structure!.grounded);
      if (fits && (!best || area < best.area)) best = { index: j, area };
    });
    if (best) result.set(i, best.index);
  });
  return result;
}

type BlueprintElements = { elements: ReadonlyArray<Pick<ReferenceBlueprintV2["elements"][number], "approved" | "category">> };

/**
 * UI/chat contract: the reference has at least one approved balloon
 * structure (the same rule `referenciaDefineComposicion` uses in the plan).
 * False for photos with no balloon decoration, or where every balloon-like
 * detection was rejected (hot air balloon, loose balloons, untyped foil).
 */
export function tieneEstructurasDeGlobos(blueprint: BlueprintElements | null | undefined): boolean {
  return Boolean(blueprint?.elements.some((element) => element.approved && element.category === "balloon_structure"));
}

/** UI contract: the analysis kept at least one element; false means "nothing usable was seen". */
export function tieneElementosAprobados(blueprint: BlueprintElements | null | undefined): boolean {
  return Boolean(blueprint?.elements.some((element) => element.approved));
}
