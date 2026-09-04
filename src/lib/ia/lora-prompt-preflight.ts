import type { SceneSpec } from "./scene-spec";
import type { LoraVisualClause } from "./lora-caption-compiler";
import { translateLoraColor } from "./lora-caption-compiler";
import type { ProductVocabulary } from "@/lib/lora/product-vocabulary";

export type LoraPromptPreflightReport = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  structures: { expected: number; represented: number };
  locations: { expected: number; represented: number };
  relationships: { expected: number; represented: number };
  colors: { expected: number; represented: number };
  fallbacks: number;
  ambiguities: string[];
  discardedElementIds: string[];
  promptLength: number;
  triggerCount: number;
  /** Internal concept_id strings and/or commercial tokens found leaked into the prompt text. Non-empty implies `ok: false`. */
  productLeaks: string[];
};

const DEFAULT_LORA_TRIGGER = "eventdecor_style_v2";

const SPANISH_TOKENS = [
  "arco", "semiarco", "guirnalda", "columna", "pared", "centro de mesa", "sobre mesa",
  "lateral", "entrada", "fondo pared", "piso frontal", "mesas invitados", "techo", "dorado",
  "rosado", "rojo", "verde", "azul", "blanco", "negro", "plateado", "fucsia", "amarillo",
  "morado", "naranja", "marron", "cafe", "crema", "quinceaÃ±era", "quince", "aÃ±os", "evento",
  "corporativo", "celebraciÃ³n", "jardÃ­n", "salÃ³n", "esmeralda",
];

const SPANISH_DIACRITICS = /[Ã¡Ã©Ã­Ã³ÃºÃ¼Ã±Â¿Â¡]/i;

function hasWholeToken(text: string, token: string): boolean {
  return new RegExp(`\\b${token.replace(/ /g, "\\s+")}\\b`, "i").test(text);
}

export function findLoraPromptLanguageLeaks(prompt: string): string[] {
  const leaks = new Set<string>();
  if (SPANISH_DIACRITICS.test(prompt)) leaks.add("caracteres espaÃ±oles");
  for (const token of SPANISH_TOKENS) {
    if (hasWholeToken(prompt, token)) leaks.add(token);
  }
  return [...leaks];
}

function expectedBilateralPairs(sceneSpec: SceneSpec): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  const left = sceneSpec.elements.filter((element) => element.visual_semantics?.placement === "lateral_izquierdo");
  for (const leftElement of left) {
    const rightElement = sceneSpec.elements.find((element) =>
      element.visual_semantics?.placement === "lateral_derecho"
      && element.visual_semantics.structure_type === leftElement.visual_semantics?.structure_type
      && element.resolved_colors.map(translateLoraColor).join("|") === leftElement.resolved_colors.map(translateLoraColor).join("|"),
    );
    if (rightElement) pairs.push([leftElement.element_id, rightElement.element_id]);
  }
  return pairs;
}

// A concept_id has the shape `segment.segment.segment...` (writing-block.md
// Â§7 / product-vocabulary.ts productConceptSchema), e.g.
// "balloon.round.latex.reflex.rose_gold". Real prose never contains
// lowercase, dot-joined, multi-segment tokens like this, so requiring at
// least 3 segments (2 dots) keeps this check from false-positiving on
// ordinary sentences while still catching any accidental internal-ID leak.
const CONCEPT_ID_SHAPE_PATTERN = /\b[a-z0-9]+(?:\.[a-z0-9_]+){2,}\b/g;

const COMMERCIAL_LEAK_PATTERNS: Array<[RegExp, string]> = [
  [/\bsku\b/i, "sku"],
  [/paquete\s*x\s*\d+/i, "paquete x N"],
  [/\bpack\s*x\s*\d+/i, "pack x N"],
  [/\$\s?\d/, "currency amount"],
  [/\bcop\$?\b/i, "cop"],
  [/\busd\b/i, "usd"],
  [/\bprecio\b/i, "precio"],
  [/\bprice\b/i, "price"],
];

/**
 * Detects internal `concept_id` strings that leaked into a rendered prompt
 * (structurally, or literally against a known vocabulary) and commercial
 * tokens (SKU, price, package quantity) that must never reach the image
 * provider. Used by both preflight and audit tooling.
 */
export function findLoraPromptProductLeaks(prompt: string, vocabulary?: ProductVocabulary): string[] {
  const leaks = new Set<string>();

  for (const match of prompt.match(CONCEPT_ID_SHAPE_PATTERN) ?? []) {
    leaks.add(`internal concept_id-shaped token: ${match}`);
  }

  if (vocabulary) {
    const lowerPrompt = prompt.toLowerCase();
    for (const concept of vocabulary) {
      if (lowerPrompt.includes(concept.concept_id.toLowerCase())) {
        leaks.add(`internal concept_id leaked verbatim: ${concept.concept_id}`);
      }
    }
  }

  for (const [pattern, label] of COMMERCIAL_LEAK_PATTERNS) {
    if (pattern.test(prompt)) leaks.add(`commercial token leaked: ${label}`);
  }

  return [...leaks];
}

function requiredAnchorMissing(sceneSpec: SceneSpec, prompt: string): string[] {
  const missing: string[] = [];
  for (const element of sceneSpec.elements) {
    const placement = element.visual_semantics?.placement;
    if (placement === "sobre_mesa_principal" && !/main table/i.test(prompt)) missing.push(element.element_id);
    if (placement === "techo" && !/ceiling/i.test(prompt)) missing.push(element.element_id);
    if (placement === "fondo_pared" && !/rear wall/i.test(prompt)) missing.push(element.element_id);
  }
  return missing;
}

export function preflightLoraPrompt(input: {
  sceneSpec: SceneSpec;
  clauses: LoraVisualClause[];
  prompt: string;
  triggers?: string[];
  /** Optional vocabulary to check for verbatim concept_id leakage against real known concept_ids, in addition to the always-on structural shape check. */
  vocabulary?: ProductVocabulary;
}): LoraPromptPreflightReport {
  const { sceneSpec, clauses, prompt } = input;
  const triggers = [...new Set((input.triggers ?? [DEFAULT_LORA_TRIGGER]).map((trigger) => trigger.trim()).filter(Boolean))];
  const errors: string[] = [];
  const warnings: string[] = [];
  const ambiguities: string[] = [];
  const representedIds = new Set(clauses.flatMap((clause) => clause.elementIds));
  const expectedIds = sceneSpec.elements.map((element) => element.element_id);
  const discardedElementIds = expectedIds.filter((elementId) => !representedIds.has(elementId));
  const fallbacks = sceneSpec.elements.filter((element) => !element.visual_semantics).length;
  const requiresCanonicalSemantics = Boolean(sceneSpec.metadata.plan_hash) || sceneSpec.elements.some((element) => Boolean(element.visual_semantics));
  if (requiresCanonicalSemantics && fallbacks > 0) errors.push("faltan visual_semantics canÃ³nicas en elementos aprobados");
  if (!requiresCanonicalSemantics && fallbacks > 0) warnings.push(`${fallbacks} elemento(s) usan inferencia legacy`);

  const structures = { expected: sceneSpec.elements.length, represented: representedIds.size };
  const locationExpectedIds = sceneSpec.elements.filter((element) => Boolean(element.visual_semantics?.placement)).map((element) => element.element_id);
  const locationRepresented = locationExpectedIds.filter((elementId) => representedIds.has(elementId)).length;
  const locations = { expected: locationExpectedIds.length, represented: locationRepresented };
  if (discardedElementIds.length) errors.push(`estructuras descartadas: ${discardedElementIds.join(", ")}`);
  if (structures.represented !== structures.expected) errors.push(`cobertura estructural ${structures.represented}/${structures.expected}`);
  if (locations.represented !== locations.expected) errors.push(`cobertura de ubicaciones ${locations.represented}/${locations.expected}`);

  const bilateralPairs = expectedBilateralPairs(sceneSpec);
  const relationshipsRepresented = bilateralPairs.filter(([left, right]) => {
    const clause = clauses.find((candidate) => candidate.elementIds.includes(left) && candidate.elementIds.includes(right));
    return Boolean(clause?.relation?.includes("flanking") && /left and one on the right/i.test(prompt));
  }).length;
  const relationships = { expected: bilateralPairs.length, represented: relationshipsRepresented };
  if (relationshipsRepresented !== bilateralPairs.length) errors.push(`relaciones bilaterales ${relationshipsRepresented}/${bilateralPairs.length}`);

  const expectedColors = new Set(sceneSpec.elements.flatMap((element) => element.resolved_colors.map(translateLoraColor).filter(Boolean)));
  const representedColors = [...expectedColors].filter((color) => prompt.toLowerCase().includes(color.toLowerCase())).length;
  const colors = { expected: expectedColors.size, represented: representedColors };
  if (representedColors !== expectedColors.size) errors.push(`cobertura de colores ${representedColors}/${expectedColors.size}`);

  const knownTypeFallbacks = clauses.filter((clause) => clause.usedFallbackSemantics).length;
  if (knownTypeFallbacks) errors.push(`${knownTypeFallbacks} tipo(s) sin visual_semantics del plan, inferido(s) por nombre (${clauses.filter((clause) => clause.usedFallbackSemantics).map((clause) => clause.noun).join(", ")})`);

  const triggerCounts = triggers.map((trigger) => ({ trigger, count: (prompt.match(new RegExp(escapeRegExp(trigger), "gi")) ?? []).length }));
  const triggerCount = triggerCounts.reduce((total, item) => total + item.count, 0);
  const invalidTriggers = triggerCounts.filter((item) => item.count !== 1);
  if (invalidTriggers.length) errors.push(`trigger duplicado o ausente (${invalidTriggers.map((item) => `${item.trigger}:${item.count}`).join(", ")})`);
  if (/(?:EST_\d{2}|CATALOG_|EDIT_|SKU|package|paquete|precio|price|\b\d+\s*(?:COP|USD))/.test(prompt)) errors.push("aparecen IDs, precios o datos de compra");
  const untranslated = findLoraPromptLanguageLeaks(prompt);
  if (untranslated.length) errors.push(`texto espaÃ±ol sin traducir: ${untranslated.join(", ")}`);
  // Catches the compiler contradicting itself about where the focal piece
  // sits (e.g. both "framing the venue entrance" and "centered around the
  // stage photo area" in the same prompt, in either order) â€” NOT every
  // occurrence of the word "or", which shows up legitimately in unrelated
  // environment cues (e.g. "skyline or surrounding outdoor architecture")
  // and used to block every prompt that mentioned one.
  if (/\bentrance\b.*\bstage photo area\b|\bstage photo area\b.*\bentrance\b/i.test(prompt)) ambiguities.push("ubicaciones alternativas o incompatibles");
  // This heuristic can detect two valid venue cues in the same scene even
  // when they do not describe the same focal element. Keep it visible for
  // diagnostics, but do not block an otherwise valid LoRA generation.
  if (ambiguities.length) warnings.push(...ambiguities);

  const missingAnchors = requiredAnchorMissing(sceneSpec, prompt);
  if (missingAnchors.length) errors.push(`sin anclaje fÃ­sico: ${missingAnchors.join(", ")}`);
  if (prompt.length > 750) errors.push(`longitud ${prompt.length} supera lÃ­mite 750`);
  if (prompt.length < 350) warnings.push(`caption corta (${prompt.length} caracteres)`);

  const productLeaks = findLoraPromptProductLeaks(prompt, input.vocabulary);
  if (productLeaks.length) errors.push(`fuga de producto: ${productLeaks.join("; ")}`);

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    structures,
    locations,
    relationships,
    colors,
    fallbacks,
    ambiguities,
    discardedElementIds,
    promptLength: prompt.length,
    triggerCount,
    productLeaks,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

