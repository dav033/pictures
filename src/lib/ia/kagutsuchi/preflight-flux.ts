import type { SceneSpec } from "../escena/scene-spec";
import type { FluxVisualClause } from "./caption-flux";
import { BASE_PROMPT_MAX_LENGTH, translateFluxColor } from "./caption-flux";
import { palabrasSoloFlux } from "./texto-base";

export type FluxPromptPreflightReport = {
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
  /** Internal concept_id strings and/or commercial tokens found leaked into the prompt text. Non-empty implies `ok: false`. */
  productLeaks: string[];
  /**
   * True when the scene lacks the plan's canonical `visual_semantics` that the
   * LoRA caption requires (a loose catalog selection without an approved plan).
   * No compaction can fix it: the caller needs an approved plan or the
   * standard image style, never a retry of the same request.
   */
  requiresPlanSemantics: boolean;
};


const SPANISH_TOKENS = [
  "arco", "semiarco", "guirnalda", "columna", "pared", "centro de mesa", "sobre mesa",
  "lateral", "entrada", "fondo pared", "piso frontal", "mesas invitados", "techo", "dorado",
  "rosado", "rojo", "verde", "azul", "blanco", "negro", "plateado", "fucsia", "amarillo",
  "morado", "naranja", "marron", "cafe", "crema", "gris", "quinceañera", "quince", "años", "evento",
  "corporativo", "celebración", "jardín", "salón", "esmeralda",
];

const SPANISH_DIACRITICS = /[áéíóúüñ¿¡]/i;

function hasWholeToken(text: string, token: string): boolean {
  return new RegExp(`\\b${token.replace(/ /g, "\\s+")}\\b`, "i").test(text);
}

export function findFluxPromptLanguageLeaks(prompt: string): string[] {
  const leaks = new Set<string>();
  if (SPANISH_DIACRITICS.test(prompt)) leaks.add("caracteres españoles");
  for (const token of SPANISH_TOKENS) {
    if (hasWholeToken(prompt, token)) leaks.add(token);
  }
  return [...leaks];
}

function similarApprovedHeights(a: number | undefined, b: number | undefined): boolean {
  if (a === undefined || b === undefined) return true;
  return Math.max(a, b) / Math.min(a, b) < 1.15;
}

/**
 * Cada izquierda se empareja con una derecha distinta, igual que el compilador:
 * `find` sin consumir devolvía siempre la PRIMERA derecha, así que una lateral
 * repetida cuatro veces (dos por lado) producía los pares [#1,#2] y [#3,#2] y
 * solo uno tenía cláusula ("relaciones bilaterales 1/2" -> FLUX_PREFLIGHT_FAILED
 * sobre un caption correcto).
 */
function expectedBilateralPairs(sceneSpec: SceneSpec, clauses: readonly FluxVisualClause[]): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  const used = new Set<string>();
  // Same rule as the compiler's grouping key: two different color patterns (or
  // one and none) are two designed pieces, never a mirrored pair. The pattern
  // of an element is the one of the clause that represents it.
  const patternOf = (elementId: string) => clauses.find((clause) => clause.elementIds.includes(elementId))?.colorPattern ?? "";
  const left = sceneSpec.elements.filter((element) => element.visual_semantics?.placement === "lateral_izquierdo");
  for (const leftElement of left) {
    const rightElement = sceneSpec.elements.find((element) =>
      element.visual_semantics?.placement === "lateral_derecho"
      && !used.has(element.element_id)
      && element.visual_semantics.structure_type === leftElement.visual_semantics?.structure_type
      && element.resolved_colors.map(translateFluxColor).join("|") === leftElement.resolved_colors.map(translateFluxColor).join("|")
      // Same rule as the compiler: sides the plan sized clearly differently
      // (±15%) or gave different roles are two designed pieces, not a mirrored pair.
      && element.visual_semantics.design_role === leftElement.visual_semantics?.design_role
      && similarApprovedHeights(element.visual_semantics.dimensions_m?.height, leftElement.visual_semantics?.dimensions_m?.height)
      && patternOf(element.element_id) === patternOf(leftElement.element_id),
    );
    if (!rightElement) continue;
    used.add(rightElement.element_id);
    pairs.push([leftElement.element_id, rightElement.element_id]);
  }
  return pairs;
}

// A concept_id has the shape `segment.segment.segment...` (writing-block.md
// contrato de producto perceptual), e.g.
// "balloon.round.latex.reflex.rose_gold". Real prose never contains
// lowercase, dot-joined, multi-segment tokens like this, so requiring at
// least 3 segments (2 dots) keeps this check from false-positiving on
// ordinary sentences while still catching any accidental internal-ID leak.
const CONCEPT_ID_SHAPE_PATTERN = /\b[a-z0-9]+(?:\.[a-z0-9_]+){2,}\b/g;

const COMMERCIAL_LEAK_PATTERNS: Array<[RegExp, string]> = [
  [/\bsku\b/i, "sku"],
  [/\bB2B[-_ ]?\d{5,}\b/i, "SKU B2B"],
  [/\b(?:paquete|pack|package)\s*(?:x|de|of)\s*\d+/i, "package quantity"],
  [/\b\d+\s*(?:unidades?|units?)\s*(?:por|per)\s*(?:paquete|pack|package)\b/i, "package quantity"],
  [/\$\s?\d/, "currency amount"],
  [/\bcop\$?\b/i, "cop"],
  [/\busd\b/i, "usd"],
  [/\bprecio\b/i, "precio"],
  [/\bprice\b/i, "price"],
];

/**
 * Detecta identificadores internos y datos comerciales que no deben llegar al proveedor.
 */
export function findFluxPromptProductLeaks(prompt: string): string[] {
  const leaks = new Set<string>();

  for (const match of prompt.match(CONCEPT_ID_SHAPE_PATTERN) ?? []) {
    leaks.add(`internal concept_id-shaped token: ${match}`);
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

export function preflightFluxPrompt(input: {
  sceneSpec: SceneSpec;
  clauses: FluxVisualClause[];
  prompt: string;
  /** Límite de texto para el preflight. */
  maxLength?: number;
}): FluxPromptPreflightReport {
  const { sceneSpec, clauses, prompt } = input;
  const errors: string[] = [];
  const warnings: string[] = [];
  const ambiguities: string[] = [];
  const representedIds = new Set(clauses.flatMap((clause) => clause.elementIds));
  const expectedIds = sceneSpec.elements.map((element) => element.element_id);
  const discardedElementIds = expectedIds.filter((elementId) => !representedIds.has(elementId));
  const fallbacks = sceneSpec.elements.filter((element) => !element.visual_semantics).length;
  const requiresCanonicalSemantics = Boolean(sceneSpec.metadata.plan_hash) || sceneSpec.elements.some((element) => Boolean(element.visual_semantics));
  if (requiresCanonicalSemantics && fallbacks > 0) errors.push("faltan visual_semantics canónicas en elementos aprobados");
  if (!requiresCanonicalSemantics && fallbacks > 0) warnings.push(`${fallbacks} elemento(s) usan inferencia legacy`);

  const structures = { expected: sceneSpec.elements.length, represented: representedIds.size };
  const locationExpectedIds = sceneSpec.elements.filter((element) => Boolean(element.visual_semantics?.placement)).map((element) => element.element_id);
  const locationRepresented = locationExpectedIds.filter((elementId) => representedIds.has(elementId)).length;
  const locations = { expected: locationExpectedIds.length, represented: locationRepresented };
  if (discardedElementIds.length) errors.push(`estructuras descartadas: ${discardedElementIds.join(", ")}`);
  if (structures.represented !== structures.expected) errors.push(`cobertura estructural ${structures.represented}/${structures.expected}`);
  if (locations.represented !== locations.expected) errors.push(`cobertura de ubicaciones ${locations.represented}/${locations.expected}`);

  const bilateralPairs = expectedBilateralPairs(sceneSpec, clauses);
  const relationshipsRepresented = bilateralPairs.filter(([left, right]) => {
    const clause = clauses.find((candidate) => candidate.elementIds.includes(left) && candidate.elementIds.includes(right));
    // Con más de un par en el mismo grupo la frase es "two standing on each
    // side" en vez de "one on the left and one on the right" (el conteo no
    // cuadraría); ambas son la misma instrucción espejo del compilador.
    // La pareja puede ser ella misma la focal, y entonces no flanquea nada: lo
    // que hay que exigir es la frase espejo, no la palabra "flanking".
    return Boolean((clause?.bilateral || clause?.relation?.includes("flanking")) && /left and one on the right|standing on each side/i.test(prompt));
  }).length;
  const relationships = { expected: bilateralPairs.length, represented: relationshipsRepresented };
  if (relationshipsRepresented !== bilateralPairs.length) errors.push(`relaciones bilaterales ${relationshipsRepresented}/${bilateralPairs.length}`);

  const expectedColors = new Set(sceneSpec.elements.flatMap((element) => element.resolved_colors.map(translateFluxColor).filter(Boolean)));
  const representedColors = [...expectedColors].filter((color) => prompt.toLowerCase().includes(color.toLowerCase())).length;
  const colors = { expected: expectedColors.size, represented: representedColors };
  if (representedColors !== expectedColors.size) errors.push(`cobertura de colores ${representedColors}/${expectedColors.size}`);

  // A color pattern written by Python (ADR-0028 §12) reaches the model verbatim
  // or not at all: no compaction may shorten or drop it.
  const missingPatterns = clauses.filter((clause) => clause.colorPattern && !prompt.includes(clause.colorPattern));
  if (missingPatterns.length) errors.push(`patrón de color ausente o alterado: ${missingPatterns.map((clause) => clause.elementIds.join("+")).join(", ")}`);

  const knownTypeFallbacks = clauses.filter((clause) => clause.usedFallbackSemantics).length;
  if (knownTypeFallbacks) errors.push(`${knownTypeFallbacks} tipo(s) sin visual_semantics del plan, inferido(s) por nombre (${clauses.filter((clause) => clause.usedFallbackSemantics).map((clause) => clause.noun).join(", ")})`);

  errors.push(...basePromptErrors(prompt, clauses, warnings));
  if (/(?:EST_\d{2}|CATALOG_|EDIT_|SKU|package|paquete|precio|price|\b\d+\s*(?:COP|USD))/.test(prompt)) errors.push("aparecen IDs, precios o datos de compra");
  const untranslated = findFluxPromptLanguageLeaks(prompt);
  if (untranslated.length) errors.push(`texto español sin traducir: ${untranslated.join(", ")}`);
  // Catches the compiler contradicting itself about where the focal piece
  // sits (e.g. both "framing the venue entrance" and "centered around the
  // stage photo area" in the same prompt, in either order) — NOT every
  // occurrence of the word "or", which shows up legitimately in unrelated
  // environment cues (e.g. "skyline or surrounding outdoor architecture")
  // and used to block every prompt that mentioned one.
  if (/\bentrance\b.*\bstage photo area\b|\bstage photo area\b.*\bentrance\b/i.test(prompt)) ambiguities.push("ubicaciones alternativas o incompatibles");
  // This heuristic can detect two valid venue cues in the same scene even
  // when they do not describe the same focal element. Keep it visible for
  // diagnostics, but do not block an otherwise valid LoRA generation.
  if (ambiguities.length) warnings.push(...ambiguities);

  const missingAnchors = requiredAnchorMissing(sceneSpec, prompt);
  if (missingAnchors.length) errors.push(`sin anclaje físico: ${missingAnchors.join(", ")}`);
  const maxLength = input.maxLength ?? BASE_PROMPT_MAX_LENGTH;
  if (prompt.length > maxLength) errors.push(`longitud ${prompt.length} supera límite ${maxLength}`);
  if (prompt.length < 350) warnings.push(`caption corta (${prompt.length} caracteres)`);

  const productLeaks = findFluxPromptProductLeaks(prompt);
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
    productLeaks,
    // Only a scene without an approved plan: a plan scene missing semantics is
    // a mapping defect, and telling that client to "request a plan" is wrong.
    requiresPlanSemantics: !sceneSpec.metadata.plan_hash && fallbacks > 0 && (knownTypeFallbacks > 0 || requiresCanonicalSemantics),
  };
}

function basePromptErrors(prompt: string, clauses: readonly FluxVisualClause[], warnings: string[]): string[] {
  // El compilador ya quita estas palabras (`limpiarTextoBase`): aquí son un invariante.
  const errors = palabrasSoloFlux(prompt).map((etiqueta) => `prompt base con ${etiqueta}`);
  // Python's pattern phrases travel verbatim (ADR-0028 §12); only the
  // compiler's own wording is held to the plain-sentence shape.
  const ownWording = clauses.reduce((text, clause) => clause.colorPattern ? text.split(clause.colorPattern).join(" ") : text, prompt);
  if (/[();]/.test(ownWording)) warnings.push("prompt base con paréntesis o punto y coma");
  return errors;
}

