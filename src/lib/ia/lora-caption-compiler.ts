import type { SceneElement, SceneSpec } from "./scene-spec";
import { buildLoraEnvironmentCues, type VisualContext } from "./visual-context";
import { clasificarColores, PALETA_COLORES_EN_V2 } from "@/lib/rag/taxonomy/v2";
import type { LoraDensity, LoraDesignRole, LoraPlacement, LoraStructureType, VisualSemantics } from "./lora-semantics";
import type { PhysicalForm, PhysicalRelation, SceneElementKind, QuantitySemantics } from "./scene-visual-contract";
import { identificarEstructuraOficial, type EstructuraOficial } from "@/lib/plan/estructuras-oficiales";

export const LORA_CAPTION_COMPILER_VERSION = "lora-caption-v2.5-compact-budget" as const;

/**
 * Budget for the experimental JSON prompt variant (trigger included). The
 * 750 bound below is the caption regime of the text prompt; a JSON object
 * with the same facts cannot fit it. The JSON variant is only sent when the
 * user selects it, and is compared against the text variant.
 */
export const LORA_JSON_PROMPT_MAX_LENGTH = 1800;

/**
 * Hard character budget for a LoRA prompt, trigger included. It is the same
 * bound the dataset caption contract enforces (`/api/lora/datasets/preview`
 * accepts captions up to 750 characters): the production LoRA was trained on
 * captions of at most 513 characters (lora-dataset-v004-154, median 344), so
 * prompts beyond this leave the caption regime the model was validated on.
 * It is not a tokenizer limit; the compiler compacts to fit it and the
 * preflight rejects anything that still does not.
 */
export const LORA_PROMPT_MAX_LENGTH = 750;

/** Trigger written by the compiler; callers replace it via `ensureLoraTriggers`. */
const CAPTION_TRIGGER = "eventdecor_style_v2";

/** Alias legacy que aún aparece en nombres de escenas antiguas. */
type CaptionStructureType = LoraStructureType | "bouquet";

/**
 * A single element's resolved canonical product concept, supplied by the
 * caller (see src/lib/ia/lora-product-runtime.ts). This is the ONLY channel
 * through which product identity can override the legacy color/finish
 * translation for an element — the compiler never resolves concepts itself
 * and never receives or renders a `concept_id`, only the already-rendered
 * `canonicalLabel` text.
 */
export type ProductConceptClauseInput = {
  elementId: string;
  conceptId: string;
  canonicalLabel: string;
  sizeCodes?: string[];
  /**
   * Short observable color of the concept (e.g. "dusty rose"), used only to
   * refer back to a concept already described in full earlier in the same
   * prompt. Without it the full label is repeated.
   */
  colorName?: string;
  /**
   * Same product in the scene-caption vocabulary of the v004 dataset
   * ("glossy chrome gold" + "balloons"). Only simple solid balloons carry it;
   * other products keep their canonical label in every dialect.
   */
  sceneTerms?: { descriptor: string; noun: string };
};

/**
 * Caption vocabulary of the LoRA that will read the prompt. A LoRA follows the
 * wording it was trained on:
 * - `product_v007`: captions of lora-dataset-v007-ordenes (trigger
 *   eventdecor_style_v3): full product labels, inch sizes, fixed placements.
 * - `scene_v004`: captions of lora-dataset-v004-154 (trigger
 *   eventdecor_style_v2, run lora-run-v004-1000): "an organic balloon garland
 *   arch of large and small matte white and glossy chrome gold balloons ...,
 *   set against a plain wall and tiled floor". None of its 154 captions
 *   contains "inch", "round latex balloon" or "stage photo area"; sending that
 *   wording to it produced incoherent compositions.
 */
export type LoraCaptionDialect = "product_v007" | "scene_v004";

/** Dialect for the trigger of the resolved LoRA; unknown triggers keep the product wording. */
export function captionDialectForTrigger(trigger: string | undefined): LoraCaptionDialect {
  return trigger?.trim() === "eventdecor_style_v2" ? "scene_v004" : "product_v007";
}

export type LoraVisualClause = {
  elementIds: string[];
  structureType: CaptionStructureType;
  noun: string;
  count: number;
  colors: string[];
  finishes: string[];
  scale?: string;
  density?: string;
  placement: LoraPlacement;
  relation?: string;
  anchorElementId?: string;
  bilateral?: boolean;
  salience: number;
  // True when at least one grouped element had no `visual_semantics` from
  // the plan AND its name didn't match any known structure keyword either,
  // so it degraded to the generic "kit"/"accesorio" bucket. A missing
  // `visual_semantics` alone is not enough to flag here — inferredStructureType
  // still resolves a specific type (e.g. "arco") from the element name in
  // that case, so nothing actually degraded.
  usedFallbackSemantics: boolean;
  /**
   * Rendered canonical product phrase (e.g. "round latex balloon in rose
   * gold with a Reflex high-shine finish (5-inch and 12-inch)"), present only when
   * every element in this clause resolved to a canonical product concept.
   * When set, it REPLACES the legacy `colorFinishPhrase` rendering for this
   * clause; structure noun/count/placement/relations are unaffected.
   */
  canonicalPhrase?: string;
  /** concept_id values rendered into this clause, for diagnostics only — never emitted into the prompt text itself. */
  canonicalConceptIds?: string[];
  /** Resolved concept entries behind `canonicalPhrase`, kept so the caption can be re-rendered compactly. */
  canonicalEntries?: ProductConceptClauseInput[];
  elementKind: SceneElementKind;
  quantitySemantics: QuantitySemantics;
  visibleCount?: number;
  physicalForm?: PhysicalForm;
  productDescriptors: string[];
  printedMotifs: string[];
  physicalRelations: PhysicalRelation[];
  /** Approved height in meters when every element of the clause shares it. */
  heightM?: number;
  /** Set while rendering when vertical structures differ clearly in height. */
  heightQualifier?: "shorter" | "taller";
  /** Official structure (variant such as asymmetrical or airy) recognized from the plan; see estructuras-oficiales.ts. */
  officialStructure?: EstructuraOficial;
};

export type LoraCaptionCompilation = {
  prompt: string;
  clauses: LoraVisualClause[];
  compilerVersion: typeof LORA_CAPTION_COMPILER_VERSION;
  /**
   * True when at least one clause used a canonical product concept supplied
   * via `productConcepts`. False (the "legacy" path) must never be silently
   * reported as canonical — callers that need product fidelity (see
   * lora-product-runtime.ts) must check this flag explicitly.
   */
  usedProductVocabulary: boolean;
  /** Same scene as a structured JSON prompt (full detail, no text budget compaction). */
  jsonPrompt: string;
  /**
   * Index of the render step that produced `prompt` (0 = full rendering).
   * Higher steps are deterministic compactions applied only because the full
   * rendering exceeded `LORA_PROMPT_MAX_LENGTH`; see `CAPTION_RENDER_STEPS`.
   */
  compactionStep: number;
};

type SemanticElement = {
  element: SceneElement;
  /** `estructura_oficial` declared by the approved plan for this element, when present. */
  declaredOfficial?: string;
  semantics: Omit<VisualSemantics, "structure_type"> & { structure_type: CaptionStructureType };
  fallback: boolean;
  index: number;
};

const STRUCTURE_NOUNS: Record<CaptionStructureType, string> = {
  arco: "organic balloon arch",
  semiarco: "asymmetrical balloon half-arch",
  guirnalda: "organic balloon garland",
  columna: "balloon column",
  bouquet: "balloon bouquet",
  pared: "balloon wall",
  centro_mesa: "balloon centerpiece",
  backdrop: "decorated backdrop",
  kit: "balloon decoration kit",
  accesorio: "decorative accessory",
  escultura: "balloon sculpture",
};

const PLACEMENT_PHRASES: Record<LoraPlacement, string> = {
  entrada: "framing the venue entrance",
  arco_central: "centered around the stage photo area",
  sobre_mesa_principal: "placed on the main table",
  lateral_izquierdo: "standing on the left side",
  lateral_derecho: "standing on the right side",
  fondo_pared: "installed against the rear wall",
  piso_frontal: "grounded across the front of the stage",
  mesas_invitados: "distributed across the guest tables",
  techo: "suspended overhead from the ceiling",
  zona_central: "in the central decoration zone",
  fachada: "against the venue facade",
  pared_lateral: "against the side wall",
  alrededor_mobiliario: "around the existing furniture",
  vegetacion: "within the approved vegetation area",
  techo_multipunto: "suspended overhead at multiple ceiling points",
  recorrido_suelo: "along the approved floor path",
  esquina: "in the architectural corner",
};

const EVENT_WORDS: Record<string, string> = {
  navidad: "Christmas celebration",
  halloween: "Halloween celebration",
  boda: "wedding celebration",
  "cumpleanos": "birthday party",
  "quinceanos": "fifteenth-birthday celebration",
  quinceanera: "fifteenth-birthday celebration",
  "baby shower": "baby shower",
  graduacion: "graduation celebration",
};

const STYLE_WORDS: Record<string, string> = {
  romantico: "romantic",
  elegante: "elegant",
  moderno: "modern",
  clasico: "classic",
  boho: "bohemian",
  bohemio: "bohemian",
  glamour: "glamorous",
  glam: "glamorous",
  rustico: "rustic",
  minimalista: "minimalist",
  vintage: "vintage",
  tropical: "tropical",
  infantil: "playful",
};

const COLOR_ALIASES: Record<string, string> = {
  rosa: "pink",
  rosado: "pink",
  rosada: "pink",
  rosadofuerte: "pink",
  "rosado fuerte": "pink",
  fucsia: "fuchsia",
  dorado: "gold",
  "dorado rosa": "rose gold",
  rosagold: "rose gold",
  plateado: "silver",
  cafe: "brown",
  marron: "brown",
  morado: "purple",
  lila: "lilac",
  violeta: "violet",
  menta: "mint",
  crema: "cream",
  nude: "nude",
  burdeos: "burgundy",
  "azul rey": "blue",
  "azul caribe": "blue",
  "azul naval": "navy blue",
  "verde esmeralda": "green",
  "verde lima": "lime green",
};

const FINISH_WORDS: Record<string, string> = {
  reflex: "glossy",
  metalizado: "metallic",
  metal: "metallic",
  satin: "satin",
  satinado: "satin",
  mate: "matte",
  perlado: "pearl",
  perlados: "pearl",
  perla: "pearl",
  reflectivo: "glossy",
  reflectante: "glossy",
  brillante: "glossy",
  translucido: "clear",
  transparentes: "clear",
  transparente: "clear",
  metalizados: "metallic",
  fashion: "fashion",
};

const NUMBER_WORDS: Record<number, string> = {
  2: "two",
  3: "three",
  4: "four",
  5: "five",
  6: "six",
  7: "seven",
  8: "eight",
  9: "nine",
  10: "ten",
  11: "eleven",
  12: "twelve",
};

function normalized(value: string | undefined): string {
  return (value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function cleanGroupName(name: string): string {
  return normalized(name)
    .replace(/\s+#?\d+\s+de\s+\d+/g, "")
    .replace(/\s+#\d+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function inferredStructureType(element: SceneElement): CaptionStructureType {
  const name = normalized(element.name);
  if (/\bsemiarco(?:s)?\b/.test(name)) return "semiarco";
  if (/\barco(?:s)?\b/.test(name)) return "arco";
  if (/\bguirnalda(?:s)?\b/.test(name)) return "guirnalda";
  if (/\bcolumna(?:s)?\b/.test(name)) return "columna";
  if (/\bpared(?:es)?\b/.test(name)) return "pared";
  if (/\bcentro(?:s)?\s+de\s+mesa\b/.test(name)) return "centro_mesa";
  if (/\bbouquet\b|\bramillete\b/.test(name)) return "bouquet";
  if (/\bkit\b|\bpaquete\b/.test(name)) return "kit";
  if (element.category === "backdrop" || element.category === "curtain" || element.category === "drape" || element.category === "panel") return "backdrop";
  return element.category === "balloon_structure" ? "kit" : "accesorio";
}

function inferredPlacement(element: SceneElement): LoraPlacement {
  const centerX = element.target_bbox.x + element.target_bbox.width / 2;
  const centerY = element.target_bbox.y + element.target_bbox.height / 2;
  if (["backdrop", "curtain", "drape", "panel"].includes(element.category)) return "fondo_pared";
  if (centerX < 0.34) return "lateral_izquierdo";
  if (centerX > 0.66) return "lateral_derecho";
  if (centerY > 0.78) return "mesas_invitados";
  if (centerY > 0.62) return "piso_frontal";
  return "arco_central";
}

function inferredRole(element: SceneElement, index: number): LoraDesignRole {
  if (index === 0) return "focal";
  if (["backdrop", "curtain", "drape", "panel"].includes(element.category)) return "soporte";
  return "acento";
}

function inferredDensity(sceneSpec: SceneSpec): LoraDensity {
  const density = sceneSpec.material_estimate?.design.visual_density;
  if (density === "low") return "sencilla";
  if (density === "high") return "lujosa";
  return "media";
}

function semanticFor(element: SceneElement, index: number, sceneSpec: SceneSpec, declaredOfficial?: string): SemanticElement {
  if (element.visual_semantics) return { element, semantics: element.visual_semantics, fallback: false, index, declaredOfficial };
  return {
    element,
    declaredOfficial,
    fallback: true,
    index,
    semantics: {
      structure_type: inferredStructureType(element),
      placement: inferredPlacement(element),
      design_role: inferredRole(element, index),
      repetition_group: cleanGroupName(element.name) || `${inferredStructureType(element)}-${index}`,
      density: inferredDensity(sceneSpec),
    },
  };
}

function elementKindFor(element: SceneElement): SceneElementKind {
  return element.element_kind ?? (element.category === "backdrop" ? "backdrop" : "balloon_structure");
}

function quantitySemanticsFor(element: SceneElement): QuantitySemantics {
  return element.quantity_semantics ?? "material_units";
}

function physicalFormFor(element: SceneElement): PhysicalForm | undefined {
  return element.physical_form;
}

function physicalRelationsFor(element: SceneElement): PhysicalRelation[] {
  return element.physical_relations ?? [];
}

export function translateLoraColor(color: string): string {
  const key = normalized(color);
  const direct = PALETA_COLORES_EN_V2[key as keyof typeof PALETA_COLORES_EN_V2] ?? COLOR_ALIASES[key];
  if (direct) return direct;

  // Resolve Spanish aliases such as "azul rey" or "verde esmeralda" to the
  // canonical catalog color before translating. Preserve already-English
  // descriptors such as "light blue" when the taxonomy has no Spanish cue.
  const spanishColor = /\b(?:dorado|oro|platead[oa]|plata|rojo|azul|rosad[oa]|rosa|verde|lima|esmeralda|blanc[oa]|negr[oa]|morado|lila|violeta|naranja|amarill[oa]|fucsia|transparente|surtido|arcoiris|turquesa|arena|cafe|marron|chocolate|champana|menta|crema|crudo|piel|burdeos|vino|borgona)\b/i.test(key);
  if (spanishColor) {
    const canonical = clasificarColores(color).values[0];
    return canonical ? PALETA_COLORES_EN_V2[canonical] : "catalog color";
  }
  return color.trim();
}

function englishFinish(finish: string): string {
  return FINISH_WORDS[normalized(finish)] ?? finish.trim();
}

function uniqueEnglish(values: string[], mapper: (value: string) => string): string[] {
  return [...new Set(values.map(mapper).map((value) => value.trim()).filter(Boolean))];
}

function joinNatural(values: string[]): string {
  if (values.length <= 1) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
}

function pluralize(noun: string): string {
  if (noun.endsWith("arch")) return `${noun}es`;
  return `${noun}s`;
}

function numberWord(count: number): string {
  return NUMBER_WORDS[count] ?? String(count);
}

function scaleFor(items: SemanticElement[]): string | undefined {
  if (items.length > 1) return undefined;
  if (items[0]?.semantics.structure_type === "centro_mesa") return undefined;
  const focal = items.some((item) => item.semantics.design_role === "focal");
  const dimensions = items.flatMap((item) => Object.values(item.semantics.dimensions_m ?? {})).filter((value): value is number => typeof value === "number");
  if (focal && (items.some((item) => item.semantics.density === "lujosa") || dimensions.some((value) => value >= 2.4))) return "grand";
  if (focal && dimensions.some((value) => value >= 1.5)) return "large";
  if (items.some((item) => item.semantics.design_role === "acento")) return "compact";
  return undefined;
}

function salienceFor(items: SemanticElement[]): number {
  const role = items[0]?.semantics.design_role;
  if (role === "focal") return 100;
  if (role === "soporte") return 75;
  return 50;
}

// Outer fields join with U+0001, a control character that never appears in
// translated color/finish names (which can themselves contain spaces, e.g.
// "rose gold") and is distinct from the "|" used to join each inner
// color/finish list — so structuralKey can split off the trailing
// repetition group by field count without guessing an index into an
// ambiguous "|"-joined string.
const FIELD_SEP = "";

function compatibleKey(item: SemanticElement): string {
  const semantics = item.semantics;
  const colors = uniqueEnglish(item.element.resolved_colors, translateLoraColor).join("|");
  const finishes = uniqueEnglish(item.element.resolved_finishes ?? [], englishFinish).join("|");
  const relationKey = physicalRelationsFor(item.element).map((relation) => JSON.stringify(relation)).sort().join("|");
  const motifKey = item.element.catalog_visual?.pattern.motif ?? "";
  const subjectKey = item.element.physical_form?.sujeto ?? "";
  // The official variant is part of the structure: an asymmetrical column never pairs with a plain one.
  return [semantics.structure_type, elementKindFor(item.element), colors, finishes, motifKey, subjectKey, relationKey, officialStructureOf(item)?.id ?? "", semantics.repetition_group].join(FIELD_SEP);
}

function officialStructureOf(item: SemanticElement): EstructuraOficial | undefined {
  return identificarEstructuraOficial({
    tipo: item.semantics.structure_type,
    densidad: item.semantics.density,
    ubicacion: item.semantics.placement,
    nombre: item.element.name,
    estructura_oficial: item.declaredOfficial,
  });
}

function structuralKey(item: SemanticElement): string {
  return compatibleKey(item).split(FIELD_SEP).slice(0, 8).join(FIELD_SEP);
}

/**
 * Renders the canonical product phrase for a clause's elements, deduplicating
 * by concept_id while preserving every distinct confirmed size code attached
 * to that concept. Only concept_id and sizeCodes drive dedupe/ordering (both
 * sorted for determinism); concept_id itself is never included in the
 * returned text, only the pre-rendered canonicalLabel.
 */
function buildCanonicalPhrase(entries: ProductConceptClauseInput[], render?: CaptionRenderState): { phrase: string; conceptIds: string[] } {
  const byConceptId = new Map<string, { canonicalLabel: string; colorName?: string; sizeCodes: Set<string> }>();
  for (const entry of entries) {
    const existing = byConceptId.get(entry.conceptId);
    const sizeCodes = existing?.sizeCodes ?? new Set<string>();
    for (const code of entry.sizeCodes ?? []) sizeCodes.add(code);
    byConceptId.set(entry.conceptId, { canonicalLabel: entry.canonicalLabel, colorName: existing?.colorName ?? entry.colorName, sizeCodes });
  }
  const conceptIds = [...byConceptId.keys()].sort();
  const sizeMode = render?.step.sizes ?? "all";
  const described: Array<{ label: string; sizes: string[] }> = [];
  const references: string[] = [];
  for (const conceptId of conceptIds) {
    const { canonicalLabel, colorName, sizeCodes } = byConceptId.get(conceptId)!;
    if (render?.step.referenceRepeatedConcepts && colorName && render.describedConceptIds.has(conceptId)) {
      references.push(colorName);
      continue;
    }
    render?.describedConceptIds.add(conceptId);
    described.push({ label: render?.step.shortLabels ? shortProductLabel(canonicalLabel) : canonicalLabel, sizes: sizeMode === "none" ? [] : [...sizeCodes] });
  }
  const fullParts = render?.step.factorLabels
    ? factorLabels(described, sizeMode)
    : described.map(({ label, sizes }) => withSizes(label, sizes, sizeMode));
  const uniqueReferences = [...new Set(references)];
  const referencePhrase = uniqueReferences.length ? `in matching ${joinNatural(uniqueReferences)}` : "";
  const phrase = fullParts.length && referencePhrase
    ? `${joinNatural(fullParts)}, with ${referencePhrase.replace(/^in /, "")}`
    : fullParts.length ? joinNatural(fullParts) : referencePhrase;
  return { phrase, conceptIds };
}

function withSizes(label: string, sizes: string[], mode: CaptionRenderStep["sizes"]): string {
  const rendered = mode === "none" ? "" : renderSizes(sizes, mode);
  return rendered ? `${label} (${rendered})` : label;
}

/**
 * Factors labels that share the object ("round latex balloon in ...") and the
 * finish ("... with a high-gloss chrome finish") into one phrase:
 * "round latex balloons in gold and silver with a high-gloss chrome finish".
 * Only the label text is regrouped; no color, finish or object is dropped.
 * Sizes of a factored group are merged into one list for that group.
 */
function factorLabels(parts: Array<{ label: string; sizes: string[] }>, mode: CaptionRenderStep["sizes"]): string[] {
  const byObject = new Map<string, Array<{ color: string; tail: string; sizes: string[] }>>();
  const standalone: string[] = [];
  const order: string[] = [];
  for (const { label, sizes } of parts) {
    const split = label.match(/^(.+?) in (.+)$/);
    const detail = split?.[2].match(/^(.+?)((?:,| with ).*)?$/);
    const color = detail?.[1];
    if (!split || !color || / and /.test(color)) {
      standalone.push(withSizes(label, sizes, mode));
      order.push(`standalone:${standalone.length - 1}`);
      continue;
    }
    const object = split[1]!;
    if (!byObject.has(object)) order.push(`object:${object}`);
    byObject.set(object, [...(byObject.get(object) ?? []), { color, tail: detail[2] ?? "", sizes }]);
  }
  return order.map((key) => {
    if (key.startsWith("standalone:")) return standalone[Number(key.slice("standalone:".length))]!;
    const object = key.slice("object:".length);
    const items = byObject.get(object)!;
    const byTail = new Map<string, string[]>();
    for (const item of items) byTail.set(item.tail, [...(byTail.get(item.tail) ?? []), item.color]);
    const colorGroups = [...byTail.entries()].map(([tail, colors]) => `${joinNatural(colors)}${tail}`);
    const noun = items.length > 1 ? pluralizeLabelObject(object) : object;
    return withSizes(`${noun} in ${colorGroups.join("; ")}`, [...new Set(items.flatMap((item) => item.sizes))], mode);
  });
}

function pluralizeLabelObject(object: string): string {
  return /balloon$/.test(object) ? `${object}s` : object;
}

function sizeValue(size: string): number {
  const match = size.match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : Number.POSITIVE_INFINITY;
}

/** Numeric order ("5-inch" before "12-inch"); a range keeps only the extremes. */
function renderSizes(sizes: string[], mode: "all" | "range"): string {
  const sorted = [...sizes].sort((a, b) => sizeValue(a) - sizeValue(b) || a.localeCompare(b));
  if (mode === "range" && sorted.length > 2) return `${sorted[0]} to ${sorted[sorted.length - 1]}`;
  return joinNatural(sorted);
}

function createClause(
  items: SemanticElement[],
  placement = items[0]!.semantics.placement,
  productConceptsByElementId?: Map<string, ProductConceptClauseInput[]>,
): LoraVisualClause {
  const first = items[0]!;
  const elementIds = items.map((item) => item.element.element_id);
  const conceptEntries = productConceptsByElementId
    ? elementIds.flatMap((elementId) => productConceptsByElementId.get(elementId) ?? [])
    : [];
  // Only render a canonical phrase when EVERY element in the clause resolved
  // a concept — a partial match must fall back to legacy so we never mix a
  // precise label for one element with a generic color/finish guess for its
  // sibling in the same clause.
  const allElementsResolved = productConceptsByElementId
    ? elementIds.every((elementId) => (productConceptsByElementId.get(elementId)?.length ?? 0) > 0)
    : false;
  const canonical = allElementsResolved && conceptEntries.length ? buildCanonicalPhrase(conceptEntries) : undefined;
  const physicalRelations = items.flatMap((item) => physicalRelationsFor(item.element));
  const productDescriptors = [...new Set(items.map((item) => item.element.catalog_visual?.descriptor_perceptual_en).filter((value): value is string => Boolean(value)))];
  const printedMotifs = [...new Set(items.map((item) => item.element.catalog_visual?.pattern.motif).filter((value): value is string => Boolean(value)))];
  const physicalForm = items.length === 1 ? physicalFormFor(first.element) : undefined;
  const quantitySemantics = quantitySemanticsFor(first.element);
  const visibleCount = quantitySemantics === "physical_instances"
    ? Math.max(1, first.element.quantity.min)
    : undefined;
  return {
    elementIds,
    structureType: first.semantics.structure_type,
    noun: STRUCTURE_NOUNS[first.semantics.structure_type],
    count: items.length,
    colors: uniqueEnglish(items.flatMap((item) => item.element.resolved_colors), translateLoraColor),
    finishes: uniqueEnglish(items.flatMap((item) => item.element.resolved_finishes ?? []), englishFinish),
    scale: scaleFor(items),
    density: first.semantics.density,
    placement,
    salience: salienceFor(items),
    usedFallbackSemantics: items.some((item) => item.fallback && (item.semantics.structure_type === "kit" || item.semantics.structure_type === "accesorio")),
    canonicalPhrase: canonical?.phrase,
    canonicalConceptIds: canonical?.conceptIds,
    canonicalEntries: canonical ? conceptEntries : undefined,
    elementKind: elementKindFor(first.element),
    quantitySemantics,
    visibleCount,
    physicalForm,
    productDescriptors,
    printedMotifs,
    physicalRelations,
    heightM: sharedHeight(items),
    officialStructure: officialStructureOf(first),
  };
}

function heightOf(item: SemanticElement): number | undefined {
  return item.semantics.dimensions_m?.height;
}

function sharedHeight(items: SemanticElement[]): number | undefined {
  const heights = [...new Set(items.map(heightOf))];
  return heights.length === 1 ? heights[0] : undefined;
}

/** Heights within 15% read as the same height; beyond that the difference is part of the design. */
function similarHeights(a: number | undefined, b: number | undefined): boolean {
  if (a === undefined || b === undefined) return true;
  return Math.max(a, b) / Math.min(a, b) < 1.15;
}

const VERTICAL_STRUCTURES = new Set<CaptionStructureType>(["arco", "semiarco", "columna"]);

/**
 * Two structures that the plan sized differently (a short half-arch and a
 * tall one) must not be drawn as a matching pair: the shortest and tallest
 * vertical structures get an explicit "shorter"/"taller".
 */
function assignHeightQualifiers(clauses: LoraVisualClause[]): void {
  for (const clause of clauses) clause.heightQualifier = undefined;
  // Compared within one structure type: a short column next to two
  // half-arches must not make the lower half-arch lose its "shorter".
  for (const type of VERTICAL_STRUCTURES) {
    const sameType = clauses.filter((clause) => clause.structureType === type && clause.heightM !== undefined);
    if (sameType.length < 2) continue;
    const heights = sameType.map((clause) => clause.heightM!);
    const min = Math.min(...heights);
    const max = Math.max(...heights);
    if (similarHeights(min, max)) continue;
    for (const clause of sameType) {
      if (clause.heightM === min) clause.heightQualifier = "shorter";
      else if (clause.heightM === max) clause.heightQualifier = "taller";
    }
  }
  // A tall half-arch on one side and a short column on the other differ in
  // type, so the pass above never compared them and both rendered at the same
  // height (reference case of 2026-09-14).
  const laterals = separateLateralPieces(clauses).filter((clause) => clause.heightM !== undefined);
  if (laterals.length !== 2 || laterals.some((clause) => clause.heightQualifier)) return;
  const [a, b] = laterals as [LoraVisualClause, LoraVisualClause];
  if (a.placement === b.placement || similarHeights(a.heightM, b.heightM)) return;
  const [shorter, taller] = a.heightM! < b.heightM! ? [a, b] : [b, a];
  shorter.heightQualifier = "shorter";
  taller.heightQualifier = "taller";
}

/** Non-mirrored half-arches and columns standing on the left or right. */
function separateLateralPieces(clauses: LoraVisualClause[]): LoraVisualClause[] {
  return clauses.filter((clause) => (clause.structureType === "semiarco" || clause.structureType === "columna")
    && !clause.bilateral
    && (clause.placement === "lateral_izquierdo" || clause.placement === "lateral_derecho"));
}

/**
 * Two half-arches on opposite sides that are not a mirrored pair are two
 * separate pieces. Without saying so the image model closed them into one
 * full arch (observed with lora-run-v004-1000).
 */
function separatePiecesPhrase(clauses: LoraVisualClause[]): string | undefined {
  const pieces = separateLateralPieces(clauses);
  const sides = new Set(pieces.map((clause) => clause.placement));
  if (!sides.has("lateral_izquierdo") || !sides.has("lateral_derecho")) return undefined;
  if (pieces.every((clause) => clause.structureType === "semiarco")) return "the two curved garlands stand apart with an open gap between them";
  // A half-arch next to a column was closed into one full arch as well: the
  // separation must be explicit for mixed pieces too. Two columns already read apart.
  return pieces.some((clause) => clause.structureType === "semiarco")
    ? "the garland and the column stand apart with an open gap between them"
    : undefined;
}

function findFocalClause(clauses: LoraVisualClause[]): LoraVisualClause | undefined {
  return clauses.find((clause) => clause.salience === 100) ?? clauses[0];
}

function focusDescription(clause: LoraVisualClause | undefined): string {
  if (!clause) return "the main arrangement";
  if (["arco", "semiarco"].includes(clause.structureType)) return "the main arch";
  return "the main arrangement";
}

const RELATION_PHRASES: Record<string, string> = {
  enmarcar: "framing",
  trepar_por: "climbing",
  envolver: "wrapping around",
  colgar_de: "suspended from",
  derramarse_sobre: "spilling onto",
  montar_sobre: "mounted on",
  apoyarse_en: "resting on",
  conectar_con: "leading toward",
  quedar_detras_de: "behind",
  quedar_debajo_de: "below",
};

const ANCHOR_PHRASES: Record<string, string> = {
  puerta: "the doorway",
  pared: "the wall",
  mesa: "the table",
  arbol: "the tree branches",
  techo: "the ceiling",
  piso: "the floor",
  fachada: "the venue facade",
  esquina: "the architectural corner",
  mobiliario_existente: "the existing furniture",
};

function targetPhrase(sceneSpec: SceneSpec, relation: PhysicalRelation): string {
  if (relation.target.kind === "ancla_espacio") {
    return ANCHOR_PHRASES[sceneSpec.venue.anchors?.find((anchor) => anchor.anchor_id === relation.target.id)?.tipo ?? ""] ?? "the approved physical anchor";
  }
  const target = sceneSpec.elements.find((element) => element.element_id === relation.target.id);
  return target?.physical_form?.sujeto ? `the balloon ${target.physical_form.sujeto} sculpture` : "the approved decoration";
}

function relationPhrase(sceneSpec: SceneSpec, relation: PhysicalRelation): string {
  const base = RELATION_PHRASES[relation.relacion] ?? relation.relacion;
  const target = targetPhrase(sceneSpec, relation);
  const distribution = relation.distribucion === "continua" ? " as one continuous installation"
    : relation.distribucion === "asimetrica" ? " asymmetrically"
      : relation.distribucion === "en_racimos" ? " in connected clusters"
        : relation.distribucion === "multipunto" ? " at multiple attachment points"
          : relation.distribucion === "alturas_escalonadas" ? " at staggered heights"
            : relation.distribucion === "recorrido" ? " forming a continuous trail" : "";
  return relation.relacion === "conectar_con" ? `${base} ${target}${distribution}` : `${base} ${target}${distribution}`;
}

function resolveRelations(sceneSpec: SceneSpec, clauses: LoraVisualClause[]): void {
  const focal = findFocalClause(clauses);
  const focalId = focal?.elementIds[0];
  const focus = focusDescription(focal);
  for (const clause of clauses) {
    if (sceneSpec.schema_version === "1.1") {
      const declared = clause.physicalRelations.find((relation) => relation.prioridad === "primaria") ?? clause.physicalRelations[0];
      if (declared) {
        clause.relation = relationPhrase(sceneSpec, declared);
        clause.anchorElementId = declared.target.id;
      }
      continue;
    }
    if (clause === focal) continue;
    if (clause.bilateral) {
      clause.relation = `flanking ${focus}`;
      clause.anchorElementId = focalId;
    } else if (clause.placement === "lateral_izquierdo" && clauses.some((other) => other !== clause && other !== focal && other.placement === "lateral_derecho" && other.structureType === clause.structureType && other.colors.join("|") === clause.colors.join("|") && other.salience === clause.salience && similarHeights(other.heightM, clause.heightM))) {
      clause.relation = `flanking ${focus}`;
      clause.anchorElementId = focalId;
    } else if (clause.structureType === "centro_mesa" && focal?.structureType === "arco") {
      clause.relation = "beneath the main arch";
      clause.anchorElementId = focalId;
    } else if (clause.structureType === "backdrop" && focalId) {
      clause.relation = "behind the main arrangement";
      clause.anchorElementId = focalId;
    }
  }
}

/**
 * One deterministic rendering of the caption. Steps are tried in order and the
 * first one that fits the budget wins, so a scene that already fits keeps the
 * full rendering. Every step keeps each structure, its placement phrase,
 * relations and every approved color; they only remove repetition and detail.
 */
type CaptionRenderStep = {
  /** Refer to a concept already described in full by its color ("in matching gold"). */
  referenceRepeatedConcepts: boolean;
  /** Merge labels sharing object and finish ("round latex balloons in gold and silver with ..."). */
  factorLabels: boolean;
  sizes: "all" | "range" | "none";
  /** Keep only the leading noun phrase of each environment cue. */
  compactEnvironment: boolean;
  /** Drop the optional style phrase and photographic qualifiers from the tail. */
  minimalTail: boolean;
  /** Drop venue environment cues from the tail; the approved decoration outranks the venue description. */
  dropEnvironment: boolean;
  /**
   * Last resort: render each product label as "object in color", dropping its
   * finish/pattern tail ("…, solid matte finish", "… with a chrome finish").
   * Object type and every approved color stay.
   */
  shortLabels: boolean;
};

const CAPTION_RENDER_STEPS: readonly CaptionRenderStep[] = [
  { referenceRepeatedConcepts: false, factorLabels: false, sizes: "all", compactEnvironment: false, minimalTail: false, dropEnvironment: false, shortLabels: false },
  { referenceRepeatedConcepts: true, factorLabels: false, sizes: "all", compactEnvironment: false, minimalTail: false, dropEnvironment: false, shortLabels: false },
  { referenceRepeatedConcepts: true, factorLabels: true, sizes: "all", compactEnvironment: false, minimalTail: false, dropEnvironment: false, shortLabels: false },
  { referenceRepeatedConcepts: true, factorLabels: true, sizes: "range", compactEnvironment: false, minimalTail: false, dropEnvironment: false, shortLabels: false },
  { referenceRepeatedConcepts: true, factorLabels: true, sizes: "range", compactEnvironment: true, minimalTail: false, dropEnvironment: false, shortLabels: false },
  { referenceRepeatedConcepts: true, factorLabels: true, sizes: "none", compactEnvironment: true, minimalTail: false, dropEnvironment: false, shortLabels: false },
  { referenceRepeatedConcepts: true, factorLabels: true, sizes: "none", compactEnvironment: true, minimalTail: true, dropEnvironment: false, shortLabels: false },
  { referenceRepeatedConcepts: true, factorLabels: true, sizes: "none", compactEnvironment: true, minimalTail: true, dropEnvironment: true, shortLabels: false },
  { referenceRepeatedConcepts: true, factorLabels: true, sizes: "none", compactEnvironment: true, minimalTail: true, dropEnvironment: true, shortLabels: true },
];

/** "round foil balloon in fuchsia with a metallic sheen hearts pattern" -> "round foil balloon in fuchsia". */
function shortProductLabel(label: string): string {
  const match = label.match(/^(.+?) in (.+?)(?:,| with ).*$/);
  return match ? `${match[1]} in ${match[2]}` : label;
}

type CaptionRenderState = {
  step: CaptionRenderStep;
  dialect: LoraCaptionDialect;
  /** Concepts already described in full earlier in the caption being rendered. */
  describedConceptIds: Set<string>;
};

const SCENE_V004_NOUNS: Partial<Record<CaptionStructureType, string>> = {
  arco: "organic balloon garland arch",
  // "arch" made the v004 LoRA close two half-arches into one full arch; the
  // dataset wording for a one-sided piece is a garland that rises and curves.
  semiarco: "one-sided curved organic balloon garland",
  guirnalda: "organic balloon garland",
  columna: "organic balloon column",
  pared: "balloon wall installation",
  centro_mesa: "small balloon cluster centerpiece",
  bouquet: "balloon bouquet",
};

const SCENE_V004_PLACEMENTS: Partial<Record<LoraPlacement, string>> = {
  entrada: "framing the entrance doorway",
  arco_central: "as the central focal piece",
  sobre_mesa_principal: "placed on the main table",
  fondo_pared: "against the rear wall",
  piso_frontal: "resting on the floor in front",
  mesas_invitados: "on the guest tables",
  techo: "hanging from the ceiling",
};

/**
 * A half-arch away from the sides: "against the rear wall" drew it as a full
 * arch or frame (tropical plan, 2026-09-14), so its one-sided shape is part of
 * the placement. Kept short for the 750-character budget.
 */
const SCENE_V004_ONE_SIDED_PLACEMENTS: Partial<Record<LoraPlacement, string>> = {
  fondo_pared: "at one side of the rear wall",
  arco_central: "off to one side of center",
  entrada: "at one side of the doorway",
};

/** Diameters of the confirmed sizes ("12-inch") as the dataset words it: large, small, or both. */
function sceneSizeWords(sizes: string[]): string {
  const diameters = sizes.map(sizeValue).filter(Number.isFinite);
  const large = diameters.some((value) => value >= 16);
  const small = diameters.some((value) => value <= 9);
  if (large && small) return "large and small";
  if (large) return "large";
  if (small) return "small";
  return "";
}

/**
 * "of large and small matte dusty rose and glossy chrome gold balloons", in the
 * v004 caption wording. Returns undefined when any product of the clause has
 * no scene terms, so the canonical label is used instead.
 */
function sceneMaterialPhrase(entries: ProductConceptClauseInput[], render: CaptionRenderState): string | undefined {
  if (!entries.every((entry) => entry.sceneTerms)) return undefined;
  const byConcept = new Map<string, { terms: { descriptor: string; noun: string }; sizes: string[] }>();
  for (const entry of entries) {
    const existing = byConcept.get(entry.conceptId);
    byConcept.set(entry.conceptId, { terms: entry.sceneTerms!, sizes: [...(existing?.sizes ?? []), ...(entry.sizeCodes ?? [])] });
  }
  const byNoun = new Map<string, { descriptors: string[]; sizes: string[] }>();
  for (const conceptId of [...byConcept.keys()].sort()) {
    const { terms, sizes } = byConcept.get(conceptId)!;
    const group = byNoun.get(terms.noun) ?? { descriptors: [], sizes: [] };
    if (!group.descriptors.includes(terms.descriptor)) group.descriptors.push(terms.descriptor);
    group.sizes.push(...sizes);
    byNoun.set(terms.noun, group);
  }
  const parts = [...byNoun.entries()].map(([noun, group]) => {
    const sizeWords = render.step.sizes === "none" ? "" : sceneSizeWords(group.sizes);
    return [sizeWords, joinNatural(group.descriptors), noun].filter(Boolean).join(" ");
  });
  return `of ${joinNatural(parts)}`;
}

/**
 * Product shades that belong to a broader approved plan color. The plan color
 * is attached to the shade itself ("dusty rose pink"), so it describes that
 * balloon only.
 */
const SHADE_FAMILIES: Record<string, readonly string[]> = {
  pink: ["dusty rose", "blush cream", "blush", "mauve", "raspberry"],
  white: ["pearl", "ivory", "cream"],
  brown: ["latte", "mocha"],
  purple: ["purple orchid", "lavender", "lilac", "violet"],
};

/**
 * A canonical label names the product's own shade ("dusty rose"), which can
 * differ from the approved plan color it was chosen for ("rosado" -> pink).
 * The approved color must still reach the model. A trailing "in pink tones"
 * was read as a global tint (pink gradients, a pink rear wall when followed
 * by "installed against the rear wall"), so the color is attached to the
 * matching shade; only an unmatched color is kept as a parenthetical.
 */
function withApprovedColorTones(material: string, colors: string[]): string {
  let result = material;
  const unmatched: string[] = [];
  for (const color of colors) {
    if (result.toLowerCase().includes(color.toLowerCase())) continue;
    const shade = (SHADE_FAMILIES[color.toLowerCase()] ?? []).find((candidate) => new RegExp(`\\b${candidate}\\b`, "i").test(result));
    if (shade) {
      result = result.replace(new RegExp(`\\b${shade}\\b`, "gi"), (match) => `${match} ${color}`);
    } else {
      unmatched.push(color);
    }
  }
  return unmatched.length ? `${result} (${joinNatural(unmatched)} tones)` : result;
}

function colorFinishPhrase(clause: LoraVisualClause, render?: CaptionRenderState): string {
  if (clause.canonicalPhrase) {
    const scenePhrase = render?.dialect === "scene_v004" && clause.canonicalEntries?.length
      ? sceneMaterialPhrase(clause.canonicalEntries, render)
      : undefined;
    const phrase = scenePhrase ?? (clause.canonicalEntries?.length && render
      ? buildCanonicalPhrase(clause.canonicalEntries, render).phrase
      : clause.canonicalPhrase);
    return withApprovedColorTones(phrase, clause.colors);
  }
  const color = clause.colors.length ? `in ${joinNatural(clause.colors)}` : "";
  const finish = clause.finishes.length ? `with ${joinNatural(clause.finishes)} finishes` : "";
  return [color, finish].filter(Boolean).join(" ");
}

/** Product-wording noun with the official variant (asymmetrical, airy, dense) and pieces that have no plan type. */
function productDialectNoun(clause: LoraVisualClause): string {
  const official = clause.officialStructure;
  if (!official) return clause.noun;
  if (official.id === "bouquet" || official.id === "figura" || official.id === "aro_circular" || official.id === "techo_globos") return official.sustantivoEn;
  const variant = official.forma === "asimetrica" ? "asymmetrical"
    : official.id.endsWith("_no_denso") || official.id.endsWith("_no_densa") ? "airy"
      : official.id === "pared_densa" ? "dense"
        : "";
  return variant && !clause.noun.includes(variant) ? `${variant} ${clause.noun}` : clause.noun;
}

function renderClauseText(clause: LoraVisualClause, render?: CaptionRenderState): string {
  const hasCanonicalProduct = Boolean(clause.canonicalPhrase);
  const renderedCount = clause.visibleCount ?? clause.count;
  const qualifier = hasCanonicalProduct
    ? undefined
    : clause.structureType === "centro_mesa"
    ? "low coordinated"
    : [clause.scale].filter(Boolean).join(", ");
  const descriptor = clause.physicalForm?.descripcion_perceptual_en
    ?? (!hasCanonicalProduct ? clause.productDescriptors[0] : undefined);
  const sceneDialect = render?.dialect === "scene_v004";
  const baseNoun = sceneDialect
    ? clause.officialStructure?.sustantivoEn ?? SCENE_V004_NOUNS[clause.structureType] ?? clause.noun
    : productDialectNoun(clause);
  const sizedNoun = clause.heightQualifier ? `${clause.heightQualifier} ${baseNoun}` : baseNoun;
  // v004 wording: a product without balloon scene terms (a foil pennant
  // garland, a sign) has no "of ... balloons" phrase; its bare label used to be
  // glued to the structure noun ("a balloon sculpture figure metallized foil
  // pennant garland ..."). A non-structure piece is named by its product; a
  // balloon structure keeps its noun and says what it carries ("with ...").
  const bareSceneLabel = sceneDialect && hasCanonicalProduct && Boolean(clause.canonicalEntries?.length) && !clause.canonicalEntries!.every((entry) => entry.sceneTerms);
  const productIsThePiece = bareSceneLabel && !clause.officialStructure && ["kit", "accesorio"].includes(clause.structureType);
  const rawMaterial = clause.productDescriptors.length && !hasCanonicalProduct ? "" : colorFinishPhrase(clause, render);
  const noun = productIsThePiece ? rawMaterial : qualifier ? `${qualifier} ${sizedNoun}` : sizedNoun;
  const material = productIsThePiece ? "" : bareSceneLabel && rawMaterial ? `with ${rawMaterial}` : rawMaterial;
  const article = /^[aeiou]/i.test(noun) && !/^one\b/i.test(noun) ? "an" : "a";
  const core = descriptor
    ? renderedCount === 1 ? descriptor : `${numberWord(renderedCount)} ${descriptor}`
    : renderedCount === 1 ? `${article} ${noun}` : `${numberWord(renderedCount)} ${pluralize(noun)}`;
  const colored = material ? `${core} ${material}` : core;
  // A lone side structure is drawn as a separate piece, not as a leg of the focal arch.
  // A half-arch elsewhere ("against the rear wall") was drawn as a full arch or
  // frame: its one-sided shape must be part of the placement.
  const oneSidedPlacement = clause.structureType === "semiarco" ? SCENE_V004_ONE_SIDED_PLACEMENTS[clause.placement] : undefined;
  const scenePlacement = clause.placement === "lateral_izquierdo" ? "standing apart on the left"
    : clause.placement === "lateral_derecho" ? "standing apart on the right"
      : oneSidedPlacement ?? SCENE_V004_PLACEMENTS[clause.placement];
  const placementPhrase = sceneDialect ? scenePlacement ?? PLACEMENT_PHRASES[clause.placement] : PLACEMENT_PHRASES[clause.placement];

  if (clause.structureType === "backdrop") {
    const placement = clause.relation ? `${placementPhrase}, ${clause.relation}` : placementPhrase;
    if (sceneDialect) return material ? `${core} ${material} ${placement}` : `${core} ${placement}`;
    return material ? `${core} ${placement} ${material}` : `${core} ${placement}`;
  }

  if (renderedCount > 1 && clause.placement === "lateral_izquierdo" && clause.relation?.startsWith("flanking")) {
    const matching = hasCanonicalProduct ? "" : " matching one another,";
    return `${colored},${matching} one standing on the left and one on the right, ${clause.relation}`;
  }
  if (clause.relation && clause.structureType === "centro_mesa") return `${colored} ${placementPhrase} ${clause.relation}`;
  if (clause.relation) return `${colored} ${placementPhrase}, ${clause.relation}`;
  return `${colored} ${placementPhrase}`;
}

function buildEventPhrase(context: VisualContext): string | undefined {
  const key = normalized(context.eventType);
  const phrase = EVENT_WORDS[key];
  if (!phrase) return undefined;
  const article = /^[aeiou]/i.test(phrase) ? "an" : "a";
  return `set up for ${article} ${phrase}`;
}

function buildStylePhrase(context: VisualContext): string | undefined {
  const style = STYLE_WORDS[normalized(context.style)];
  return style ? `${style} event decor` : undefined;
}

function dedupeEnvironment(context: VisualContext, eventPhrase?: string): string[] {
  const knownEvent = eventPhrase?.replace(/^set up for (?:a|an) /i, "").toLowerCase();
  return buildLoraEnvironmentCues(context).filter((cue) => {
    const normalizedCue = cue.toLowerCase();
    return !normalizedCue.startsWith("open event cue:") && (!knownEvent || !normalizedCue.includes(knownEvent));
  });
}

function groupClauses(sceneSpec: SceneSpec, productConceptsByElementId?: Map<string, ProductConceptClauseInput[]>, officialStructures?: ReadonlyMap<string, string>): LoraVisualClause[] {
  // Repeated plan structures materialize as `<estructura_id>#<n>` elements.
  const items = sceneSpec.elements.map((element, index) => semanticFor(element, index, sceneSpec, officialStructures?.get(element.element_id) ?? officialStructures?.get(element.element_id.split("#")[0]!)));
  const used = new Set<string>();
  const clauses: LoraVisualClause[] = [];

  // A pair of matching lateral structures is one spatial instruction, even
  // when the plan materialized them as separate physical elements.
  const leftItems = items.filter((item) => item.semantics.placement === "lateral_izquierdo");
  for (const left of leftItems) {
    const right = items.find((candidate) =>
      candidate.semantics.placement === "lateral_derecho"
      && candidate.semantics.structure_type === left.semantics.structure_type
      && structuralKey(candidate) === structuralKey(left)
      && similarHeights(heightOf(candidate), heightOf(left))
      && candidate.semantics.design_role === left.semantics.design_role
      && !used.has(candidate.element.element_id),
    );
    if (!right || used.has(left.element.element_id)) continue;
    const pair = createClause([left, right], "lateral_izquierdo", productConceptsByElementId);
    pair.bilateral = true;
    used.add(left.element.element_id);
    used.add(right.element.element_id);
    clauses.push(pair);
  }

  const groups = new Map<string, SemanticElement[]>();
  for (const item of items) {
    if (used.has(item.element.element_id)) continue;
    const key = `${compatibleKey(item)}|${item.semantics.placement}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  for (const group of groups.values()) clauses.push(createClause(group, undefined, productConceptsByElementId));
  return clauses.sort((a, b) => b.salience - a.salience || a.elementIds[0]!.localeCompare(b.elementIds[0]!));
}

/** "recognizable indoor event hall with real walls, ..." -> "recognizable indoor event hall". */
function compactEnvironmentCue(cue: string): string {
  return cue.split(/,|\s+with\s+/)[0]!.trim() || cue;
}

/**
 * Every v004 caption ends in "set against <wall> and <floor>" (154/154). The
 * venue cue becomes that setting; event and lighting cues follow it.
 */
function sceneSettingCues(context: VisualContext, eventPhrase: string | undefined, step: CaptionRenderStep): string[] {
  const cues = dedupeEnvironment(context, eventPhrase);
  const venueCue = cues.find((cue) => cue === matchVenueCue(context));
  const others = cues.filter((cue) => cue !== venueCue).map((cue) => step.compactEnvironment ? compactEnvironmentCue(cue) : cue);
  const venue = venueCue ? compactEnvironmentCue(venueCue).replace(/^(?:recognizable|clearly)\s+/i, "") : undefined;
  const setting = venue
    ? `set in ${/^[aeiou]/i.test(venue) ? "an" : "a"} ${venue}`
    : "set against a plain wall and floor";
  return step.dropEnvironment ? [setting] : [setting, ...others];
}

function matchVenueCue(context: VisualContext): string | undefined {
  return buildLoraEnvironmentCues({ ...context, lightingKind: "unspecified", eventCue: undefined })[0];
}

type CaptionParts = {
  /** One rendered phrase per clause, focal first. */
  subjects: string[];
  structureSentence: string;
  tail: string[];
  colors: string[];
};

function buildCaption(sceneSpec: SceneSpec, context: VisualContext, clauses: LoraVisualClause[], step: CaptionRenderStep = CAPTION_RENDER_STEPS[0]!, dialect: LoraCaptionDialect = "product_v007", ambientDecor: readonly string[] = [], creativeCues: readonly string[] = []): string {
  const parts = buildCaptionParts(sceneSpec, context, clauses, step, dialect, ambientDecor, creativeCues);
  return `${CAPTION_TRIGGER}, ${parts.structureSentence}. ${parts.tail.join(", ")}.`;
}

function buildCaptionParts(sceneSpec: SceneSpec, context: VisualContext, clauses: LoraVisualClause[], step: CaptionRenderStep, dialect: LoraCaptionDialect, ambientDecor: readonly string[], creativeCues: readonly string[] = []): CaptionParts {
  resolveRelations(sceneSpec, clauses);
  assignHeightQualifiers(clauses);
  const render: CaptionRenderState = { step, dialect, describedConceptIds: new Set<string>() };
  const clauseText = (clause: LoraVisualClause) => renderClauseText(clause, render);
  const focal = clauses[0];
  const hasCanonicalSemantics = sceneSpec.elements.every((element) => Boolean(element.visual_semantics));
  const conciseClause = (clause: LoraVisualClause): LoraVisualClause => {
    if (!hasCanonicalSemantics || !focal || clause === focal || !clause.colors.length) return clause;
    const focalColors = new Set(focal.colors);
    return clause.colors.every((color) => focalColors.has(color)) ? { ...clause, colors: [] } : clause;
  };
  const supports = clauses.filter((clause) => clause !== focal && clause.salience >= 70);
  const accents = clauses.filter((clause) => clause !== focal && clause.salience < 70);
  const firstClause = focal ? clauseText(focal) : "a cohesive balloon decoration";
  const supportText = supports.map((clause) => clauseText(conciseClause(clause)));
  const accentText = accents.map((clause) => clauseText(conciseClause(clause)));
  const structureParts = [firstClause, ...supportText];
  let structureSentence = structureParts.join(", ");
  if (accentText.length) structureSentence += `, with ${accentText.join(", ")}`;
  const separation = separatePiecesPhrase(clauses);
  if (separation) structureSentence += `, ${separation}`;
  // Styling from the reference that is not sold (lights, foliage): rendered, never quoted.
  if (ambientDecor.length) structureSentence += `, styled with ${joinNatural([...ambientDecor])}`;

  const hasLocalColors = clauses.some((clause) => clause.colors.length > 0);
  const globalPalette = !hasLocalColors && context.palette.length
    ? `in ${joinNatural(uniqueEnglish(context.palette, translateLoraColor))}`
    : undefined;
  const eventPhrase = context.eventCue ? undefined : buildEventPhrase(context);
  const hasCanonicalProducts = clauses.some((clause) => Boolean(clause.canonicalPhrase));
  const tail = [
    eventPhrase,
    step.minimalTail ? undefined : buildStylePhrase(context),
    // Creativity cues (creatividad.ts) are the first thing compaction drops:
    // they must never displace a structure, placement or color.
    ...(step.minimalTail ? [] : creativeCues),
    globalPalette,
    ...(dialect === "scene_v004"
      ? sceneSettingCues(context, eventPhrase, step)
      : step.dropEnvironment ? [] : dedupeEnvironment(context, eventPhrase).map((cue) => step.compactEnvironment ? compactEnvironmentCue(cue) : cue)),
    "wide photorealistic event photograph",
    step.minimalTail ? undefined : hasCanonicalProducts ? "natural depth, grounded supports" : "natural depth, believable floor contact and supports",
  ].filter((part): part is string => Boolean(part));
  return {
    subjects: [firstClause, ...supportText, ...accentText],
    structureSentence,
    tail,
    colors: [...new Set(clauses.flatMap((clause) => clause.colors))],
  };
}

/**
 * The same approved scene as a JSON object, for FLUX.2 structured prompting.
 * It carries exactly the rendered subjects, placements, relations, colors and
 * setting of the text caption (so preflight checks the same facts); only the
 * container changes. The LoRA trigger is prepended by `ensureLoraTriggers`.
 */
function buildJsonPrompt(parts: CaptionParts, ambientDecor: readonly string[]): string {
  return JSON.stringify({
    scene: parts.tail.filter((part) => !/photograph|natural depth|grounded supports|floor contact/i.test(part)).join(", "),
    subjects: parts.subjects.map((description, index) => ({ role: index === 0 ? "focal decoration" : "supporting decoration", description })),
    ...(ambientDecor.length ? { styling: [...ambientDecor] } : {}),
    color_palette: parts.colors,
    style: "wide photorealistic event photograph",
    composition: "every listed decoration appears once as a separate physical piece, natural depth, grounded supports",
  });
}

export function compileLoraCaption(input: {
  sceneSpec: SceneSpec;
  visualContext: VisualContext;
  /**
   * Optional per-element canonical product concepts (see
   * lora-product-runtime.ts). Purely additive: omitting this field preserves
   * the exact legacy color/finish rendering used by every existing caller.
   */
  productConcepts?: ProductConceptClauseInput[];
  /**
   * Trigger that will replace the compiler's own via `ensureLoraTriggers`.
   * Only used to account for its length against the budget.
   */
  trigger?: string;
  /** Defaults to `LORA_PROMPT_MAX_LENGTH`. */
  maxLength?: number;
  /** Wording of the LoRA that reads the prompt; defaults to `product_v007`. */
  dialect?: LoraCaptionDialect;
  /** `estructura_oficial` per plan `estructura_id`, from the approved plan. */
  officialStructures?: ReadonlyMap<string, string>;
  /**
   * Non-catalog styling relevant to the composition (see
   * `ambientDecorFromReference`). Plain English names; never structures,
   * never products, never quoted.
   */
  ambientDecor?: readonly string[];
  /** Plain English styling cues of the creativity level (creatividad.ts); dropped first when compacting. */
  creativeCues?: readonly string[];
}): LoraCaptionCompilation {
  const productConceptsByElementId = input.productConcepts?.length
    ? input.productConcepts.reduce((map, entry) => {
        const existing = map.get(entry.elementId) ?? [];
        existing.push(entry);
        map.set(entry.elementId, existing);
        return map;
      }, new Map<string, ProductConceptClauseInput[]>())
    : undefined;
  const clauses = groupClauses(input.sceneSpec, productConceptsByElementId, input.officialStructures);
  const triggerLengthDelta = (input.trigger?.trim().length ?? CAPTION_TRIGGER.length) - CAPTION_TRIGGER.length;
  const budget = (input.maxLength ?? LORA_PROMPT_MAX_LENGTH) - Math.max(0, triggerLengthDelta);
  let prompt = "";
  let compactionStep = 0;
  // If no step fits, the most compact rendering is returned unchanged and the
  // preflight rejects it: the compiler never truncates structures or colors.
  for (const [index, step] of CAPTION_RENDER_STEPS.entries()) {
    prompt = buildCaption(input.sceneSpec, input.visualContext, clauses, step, input.dialect, input.ambientDecor, input.creativeCues);
    compactionStep = index;
    if (prompt.length <= budget) break;
  }
  const jsonParts = buildCaptionParts(input.sceneSpec, input.visualContext, clauses, CAPTION_RENDER_STEPS[0]!, input.dialect ?? "product_v007", input.ambientDecor ?? [], input.creativeCues ?? []);
  return {
    prompt,
    clauses,
    compilerVersion: LORA_CAPTION_COMPILER_VERSION,
    usedProductVocabulary: clauses.some((clause) => Boolean(clause.canonicalPhrase)),
    jsonPrompt: buildJsonPrompt(jsonParts, input.ambientDecor ?? []),
    compactionStep,
  };
}

export function buildLoraImagePromptV2(input: { sceneSpec: SceneSpec; visualContext: VisualContext }): string {
  return compileLoraCaption(input).prompt;
}
