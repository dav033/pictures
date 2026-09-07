import type { SceneElement, SceneSpec } from "./scene-spec";
import { buildLoraEnvironmentCues, type VisualContext } from "./visual-context";
import { clasificarColores, PALETA_COLORES_EN_V2 } from "@/lib/rag/taxonomy/v2";
import type { LoraDensity, LoraDesignRole, LoraPlacement, LoraStructureType, VisualSemantics } from "./lora-semantics";
import type { PhysicalForm, PhysicalRelation, SceneElementKind, QuantitySemantics } from "./scene-visual-contract";

export const LORA_CAPTION_COMPILER_VERSION = "lora-caption-v2.3-product-vocabulary" as const;

/** Alias legacy que aún aparece en nombres de escenas antiguas. */
type CaptionStructureType = LoraStructureType | "bouquet";

/**
 * A single element's resolved canonical product concept, supplied by the
 * caller (see src/lib/ia/lora-product-runtime.ts). This is the ONLY channel
 * through which product identity can override the legacy color/finish
 * translation for an element â€” the compiler never resolves concepts itself
 * and never receives or renders a `concept_id`, only the already-rendered
 * `canonicalLabel` text.
 */
export type ProductConceptClauseInput = {
  elementId: string;
  conceptId: string;
  canonicalLabel: string;
  sizeCodes?: string[];
};

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
  // `visual_semantics` alone is not enough to flag here â€” inferredStructureType
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
  /** concept_id values rendered into this clause, for diagnostics only â€” never emitted into the prompt text itself. */
  canonicalConceptIds?: string[];
  elementKind: SceneElementKind;
  quantitySemantics: QuantitySemantics;
  visibleCount?: number;
  physicalForm?: PhysicalForm;
  productDescriptors: string[];
  printedMotifs: string[];
  physicalRelations: PhysicalRelation[];
};

export type LoraCaptionCompilation = {
  prompt: string;
  clauses: LoraVisualClause[];
  compilerVersion: typeof LORA_CAPTION_COMPILER_VERSION;
  /**
   * True when at least one clause used a canonical product concept supplied
   * via `productConcepts`. False (the "legacy" path) must never be silently
   * reported as canonical â€” callers that need product fidelity (see
   * lora-product-runtime.ts) must check this flag explicitly.
   */
  usedProductVocabulary: boolean;
};

type SemanticElement = {
  element: SceneElement;
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

function semanticFor(element: SceneElement, index: number, sceneSpec: SceneSpec): SemanticElement {
  if (element.visual_semantics) return { element, semantics: element.visual_semantics, fallback: false, index };
  return {
    element,
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
// color/finish list â€” so structuralKey can split off the trailing
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
  return [semantics.structure_type, elementKindFor(item.element), colors, finishes, motifKey, subjectKey, relationKey, semantics.repetition_group].join(FIELD_SEP);
}

function structuralKey(item: SemanticElement): string {
  return compatibleKey(item).split(FIELD_SEP).slice(0, 7).join(FIELD_SEP);
}

/**
 * Renders the canonical product phrase for a clause's elements, deduplicating
 * by concept_id while preserving every distinct confirmed size code attached
 * to that concept. Only concept_id and sizeCodes drive dedupe/ordering (both
 * sorted for determinism); concept_id itself is never included in the
 * returned text, only the pre-rendered canonicalLabel.
 */
function buildCanonicalPhrase(entries: ProductConceptClauseInput[]): { phrase: string; conceptIds: string[] } {
  const byConceptId = new Map<string, { canonicalLabel: string; sizeCodes: Set<string> }>();
  for (const entry of entries) {
    const existing = byConceptId.get(entry.conceptId);
    const sizeCodes = existing?.sizeCodes ?? new Set<string>();
    for (const code of entry.sizeCodes ?? []) sizeCodes.add(code);
    byConceptId.set(entry.conceptId, { canonicalLabel: entry.canonicalLabel, sizeCodes });
  }
  const conceptIds = [...byConceptId.keys()].sort();
  const parts = conceptIds.map((conceptId) => {
    const { canonicalLabel, sizeCodes } = byConceptId.get(conceptId)!;
    const sortedSizes = [...sizeCodes].sort();
    return sortedSizes.length ? `${canonicalLabel} (${joinNatural(sortedSizes)})` : canonicalLabel;
  });
  return { phrase: joinNatural(parts), conceptIds };
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
  // a concept â€” a partial match must fall back to legacy so we never mix a
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
    elementKind: elementKindFor(first.element),
    quantitySemantics,
    visibleCount,
    physicalForm,
    productDescriptors,
    printedMotifs,
    physicalRelations,
  };
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
    } else if (clause.placement === "lateral_izquierdo" && clauses.some((other) => other !== clause && other.placement === "lateral_derecho" && other.structureType === clause.structureType && other.colors.join("|") === clause.colors.join("|"))) {
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

function colorFinishPhrase(clause: LoraVisualClause): string {
  if (clause.canonicalPhrase) return clause.canonicalPhrase;
  const color = clause.colors.length ? `in ${joinNatural(clause.colors)}` : "";
  const finish = clause.finishes.length ? `with ${joinNatural(clause.finishes)} finishes` : "";
  return [color, finish].filter(Boolean).join(" ");
}

function clauseText(clause: LoraVisualClause): string {
  const hasCanonicalProduct = Boolean(clause.canonicalPhrase);
  const renderedCount = clause.visibleCount ?? clause.count;
  const qualifier = hasCanonicalProduct
    ? undefined
    : clause.structureType === "centro_mesa"
    ? "low coordinated"
    : [clause.scale].filter(Boolean).join(", ");
  const descriptor = clause.physicalForm?.descripcion_perceptual_en
    ?? (!hasCanonicalProduct ? clause.productDescriptors[0] : undefined);
  const noun = qualifier ? `${qualifier} ${clause.noun}` : clause.noun;
  const material = clause.productDescriptors.length && !hasCanonicalProduct ? "" : colorFinishPhrase(clause);
  const article = /^[aeiou]/i.test(noun) ? "an" : "a";
  const core = descriptor
    ? renderedCount === 1 ? descriptor : `${numberWord(renderedCount)} ${descriptor}`
    : renderedCount === 1 ? `${article} ${noun}` : `${numberWord(renderedCount)} ${pluralize(noun)}`;
  const colored = material ? `${core} ${material}` : core;

  if (clause.structureType === "backdrop") {
    const placement = clause.relation
      ? `${PLACEMENT_PHRASES[clause.placement]}, ${clause.relation}`
      : PLACEMENT_PHRASES[clause.placement];
    return material ? `${core} ${placement} ${material}` : `${core} ${placement}`;
  }

  if (renderedCount > 1 && clause.placement === "lateral_izquierdo" && clause.relation?.startsWith("flanking")) {
    const matching = hasCanonicalProduct ? "" : " matching one another,";
    return `${colored},${matching} one standing on the left and one on the right, ${clause.relation}`;
  }
  if (clause.relation && clause.structureType === "centro_mesa") return `${colored} ${PLACEMENT_PHRASES[clause.placement]} ${clause.relation}`;
  if (clause.relation) return `${colored} ${PLACEMENT_PHRASES[clause.placement]}, ${clause.relation}`;
  return `${colored} ${PLACEMENT_PHRASES[clause.placement]}`;
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

function groupClauses(sceneSpec: SceneSpec, productConceptsByElementId?: Map<string, ProductConceptClauseInput[]>): LoraVisualClause[] {
  const items = sceneSpec.elements.map((element, index) => semanticFor(element, index, sceneSpec));
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

function buildCaption(sceneSpec: SceneSpec, context: VisualContext, clauses: LoraVisualClause[]): string {
  resolveRelations(sceneSpec, clauses);
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

  const hasLocalColors = clauses.some((clause) => clause.colors.length > 0);
  const globalPalette = !hasLocalColors && context.palette.length
    ? `in ${joinNatural(uniqueEnglish(context.palette, translateLoraColor))}`
    : undefined;
  const eventPhrase = context.eventCue ? undefined : buildEventPhrase(context);
  const hasCanonicalProducts = clauses.some((clause) => Boolean(clause.canonicalPhrase));
  const tail = [
    eventPhrase,
    buildStylePhrase(context),
    globalPalette,
    ...dedupeEnvironment(context, eventPhrase),
    "wide photorealistic event photograph",
    hasCanonicalProducts ? "natural depth, grounded supports" : "natural depth, believable floor contact and supports",
  ].filter((part): part is string => Boolean(part));
  return `eventdecor_style_v2, ${structureSentence}. ${tail.join(", ")}.`;
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
}): LoraCaptionCompilation {
  const productConceptsByElementId = input.productConcepts?.length
    ? input.productConcepts.reduce((map, entry) => {
        const existing = map.get(entry.elementId) ?? [];
        existing.push(entry);
        map.set(entry.elementId, existing);
        return map;
      }, new Map<string, ProductConceptClauseInput[]>())
    : undefined;
  const clauses = groupClauses(input.sceneSpec, productConceptsByElementId);
  return {
    prompt: buildCaption(input.sceneSpec, input.visualContext, clauses),
    clauses,
    compilerVersion: LORA_CAPTION_COMPILER_VERSION,
    usedProductVocabulary: clauses.some((clause) => Boolean(clause.canonicalPhrase)),
  };
}

export function buildLoraImagePromptV2(input: { sceneSpec: SceneSpec; visualContext: VisualContext }): string {
  return compileLoraCaption(input).prompt;
}
