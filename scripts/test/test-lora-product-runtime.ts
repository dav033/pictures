/**
 * Subagent G deliverable — runtime prompt integration and prompt-contract
 * tests.
 *
 * Run: npx tsx scripts/test/test-lora-product-runtime.ts
 *
 * No network access. No paid calls. Pure in-process assertions against
 * src/lib/ia/kagutsuchi/lora-product-runtime.ts, src/lib/ia/kagutsuchi/lora-caption-compiler.ts,
 * and src/lib/ia/kagutsuchi/lora-prompt-preflight.ts.
 */
import assert from "node:assert/strict";
import type { SceneSpec } from "../../src/lib/ia/escena/scene-spec";
import { readFileSync } from "node:fs";
import { compileLoraCaption, LORA_JSON_PROMPT_MAX_LENGTH, LORA_PROMPT_MAX_LENGTH } from "../../src/lib/ia/kagutsuchi/lora-caption-compiler";
import { resolveLoraPromptFormat } from "../../src/lib/ia/kagutsuchi/lora-prompt-format";
import { ReferenceBlueprintV2Schema } from "../../src/lib/ia/referencia/reference-blueprint";
import { ambientDecorFromReference, ambientDecorName, parseDetectedStructure, referenceStructureSemantics, shapeDescription } from "../../src/lib/ia/referencia/reference-structure";
import { compileProductPrompt, sizeConfirmationsFromMaterialLines, type ElementSizeConfirmation } from "../../src/lib/ia/kagutsuchi/lora-product-runtime";
import { findLoraPromptLanguageLeaks, findLoraPromptProductLeaks, preflightLoraPrompt } from "../../src/lib/ia/kagutsuchi/lora-prompt-preflight";
import { buildVisualContext } from "../../src/lib/ia/escena/visual-context";
import { PRODUCT_VOCABULARY } from "../../src/lib/lora/product-vocabulary-data";
import { aDescriptorPerceptual } from "../../src/lib/lora/descriptor-perceptual";
import { resolveProductConcept, VOCABULARY_VERSION, type ProductVocabulary } from "../../src/lib/lora/product-vocabulary";

let passCount = 0;
function pass(name: string) {
  passCount += 1;
  console.log(`  ok ${passCount}. ${name}`);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type ElementOptions = {
  id: string;
  name: string;
  type: "arco" | "semiarco" | "guirnalda" | "columna" | "pared" | "centro_mesa" | "backdrop" | "kit" | "accesorio";
  placement: "fondo_pared" | "arco_central" | "sobre_mesa_principal" | "lateral_izquierdo" | "lateral_derecho" | "piso_frontal" | "mesas_invitados" | "entrada" | "techo";
  role?: "focal" | "soporte" | "acento";
  group?: string;
  colors?: string[];
  finishes?: string[];
  productId?: string;
  productIds?: string[];
};

function element(options: ElementOptions): SceneSpec["elements"][number] {
  const catalogBacked = Boolean(options.productId || options.productIds?.length);
  return {
    element_id: options.id,
    name: options.name,
    category: options.type === "backdrop" ? "backdrop" : "balloon_structure",
    source_type: catalogBacked ? "catalog_backed" : "reference_only",
    catalog_product_id: catalogBacked ? options.productId ?? options.productIds![0] : undefined,
    catalog_product_ids: options.productIds,
    required: true,
    quantity: { mode: "exact", min: 1, max: 1 },
    target_bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.7 },
    depth_layer: 10,
    resolved_colors: options.colors ?? ["rosado"],
    resolved_finishes: options.finishes,
    visual_semantics: {
      structure_type: options.type,
      placement: options.placement,
      design_role: options.role ?? (options.type === "backdrop" ? "soporte" : "acento"),
      repetition_group: options.group ?? options.id,
      density: "media",
    },
    identity_constraints: [],
    relationships: [],
  } as SceneSpec["elements"][number];
}

function scene(elements: SceneSpec["elements"][number][]): SceneSpec {
  return {
    schema_version: "1.0",
    generation_mode: "text_to_image",
    canvas: { aspect_ratio: "3:2", content_rect: { x: 0, y: 0, width: 1, height: 1 } },
    venue: { preserve: [], protected_regions: [], editable_regions: [] },
    elements,
    positive_prompt: { required_elements: [], composition: [], venue_preservation: [], photorealistic_integration: [] },
    negative_prompt: { forbidden_elements: [], forbidden_venue_changes: [], forbidden_compositing_artifacts: [] },
    metadata: { created_by: "server_default", plan_hash: "plan-test" },
  } as SceneSpec;
}

const context = buildVisualContext({ userRequest: "cumpleaños en salón" });

const GOLD_REFLEX_ID = "7109611258049";
const ROSE_GOLD_REFLEX_ID = "7109611323585";
const SILVER_REFLEX_ID = "20014244";
const PINK_SATIN_ID = "7109612732609";
const PASTEL_MATTE_PINK_ID = "20012264";
const METAL_GOLD_ID = "20000562";
const LINKOLOON_WHITE_ID = "7109565710529";
const FOIL_FUCHSIA_ID = "7105908572353";
const SILK_CREAM_PEARL_ID = "10467043344577";
const METALLIZED_PINK_CURTAIN_ID = "7107494215873";
const DUSTY_ROSE_FASHION_ID = "20010671";

// ===========================================================================
// 1. ProductPromptCompilation contract shape.
// ===========================================================================
console.log("1. ProductPromptCompilation contract shape");
{
  const spec = scene([element({ id: "ARCH", name: "Arco Dorado Rosa", type: "arco", placement: "arco_central", role: "focal", productId: ROSE_GOLD_REFLEX_ID })]);
  const result = compileProductPrompt({ sceneSpec: spec, visualContext: context, vocabulary: PRODUCT_VOCABULARY });

  assert.equal(typeof result.prompt, "string");
  assert.ok(Array.isArray(result.resolved_concepts));
  assert.ok(Array.isArray(result.unresolved_products));
  assert.equal(typeof result.vocabulary_version, "string");
  assert.equal(typeof result.compiler_version, "string");
  pass("ProductPromptCompilation exposes prompt, resolved_concepts, unresolved_products, vocabulary_version, compiler_version");

  const unresolvedProducts = result.unresolved_products;
  const emptyUnresolved: typeof unresolvedProducts = [];
  assert.equal(result.vocabulary_version, VOCABULARY_VERSION);
  assert.deepEqual(result.resolved_concepts, ["balloon.round.latex.reflex.rose_gold"]);
  assert.deepEqual(unresolvedProducts, emptyUnresolved);
  assert.equal(result.legacy, false);
  pass("a fully resolved scene reports the resolved concept id, no unresolved products, legacy=false");

  const allowedReasons: string[] = ["unknown", "ambiguous", "invalid"];
  for (const entry of unresolvedProducts) {
    assert.ok(allowedReasons.includes(entry.reason));
  }
  pass("unresolved_products reasons are always one of unknown|ambiguous|invalid");
}

// ===========================================================================
// 2. Exact canonical_label rendering, separate sizes.
// ===========================================================================
console.log("2. Canonical label + separate size phrase");
{
  const spec = scene([element({ id: "ARCH", name: "Arco", type: "arco", placement: "arco_central", role: "focal", productId: ROSE_GOLD_REFLEX_ID })]);
  const sizeConfirmations: ElementSizeConfirmation[] = [{ elementId: "ARCH", productId: ROSE_GOLD_REFLEX_ID, sizeCode: "R-12" }];
  const result = compileProductPrompt({ sceneSpec: spec, visualContext: context, vocabulary: PRODUCT_VOCABULARY, sizeConfirmations });

  const concept = PRODUCT_VOCABULARY.find((c) => c.concept_id === "balloon.round.latex.reflex.rose_gold")!;
  // El label viaja completo, pero traducido: los nombres comerciales del catálogo
  // no significan nada para el modelo de imagen (ver descriptor-perceptual.ts).
  assert.ok(
    result.prompt.includes(aDescriptorPerceptual(concept.canonical_label)),
    "prompt must contain the whole canonical_label, in perceptual form",
  );
  pass("canonical_label appears whole in the rendered prompt");

  assert.match(result.prompt, /\(12-inch\)/, "confirmed size must appear as an English diameter, not folded into the label");
  assert.doesNotMatch(result.prompt, /R-12/, "catalog size codes must not leak into the v007 prompt");
  assert.ok(!concept.canonical_label.includes("R-12"), "size must never be embedded inside canonical_label itself");
  pass("confirmed size renders as its own separate phrase next to the canonical label");
}

// ===========================================================================
// 3. Dedupe concept across elements while keeping distinct sizes.
// ===========================================================================
console.log("3. Dedupe concept, keep distinct sizes");
{
  const spec = scene([
    element({ id: "COL_L", name: "Columna izquierda", type: "columna", placement: "lateral_izquierdo", role: "soporte", group: "cols", productId: ROSE_GOLD_REFLEX_ID }),
    element({ id: "COL_R", name: "Columna derecha", type: "columna", placement: "lateral_derecho", role: "soporte", group: "cols", productId: ROSE_GOLD_REFLEX_ID }),
  ]);
  const sizeConfirmations: ElementSizeConfirmation[] = [
    { elementId: "COL_L", productId: ROSE_GOLD_REFLEX_ID, sizeCode: "R-5" },
    { elementId: "COL_R", productId: ROSE_GOLD_REFLEX_ID, sizeCode: "R-18" },
  ];
  const result = compileProductPrompt({ sceneSpec: spec, visualContext: context, vocabulary: PRODUCT_VOCABULARY, sizeConfirmations });
  const concept = PRODUCT_VOCABULARY.find((c) => c.concept_id === "balloon.round.latex.reflex.rose_gold")!;

  assert.deepEqual(result.resolved_concepts, [concept.concept_id]);
  const occurrences = result.prompt.split(aDescriptorPerceptual(concept.canonical_label)).length - 1;
  assert.equal(occurrences, 1, "the same concept at two sizes must not duplicate its finish/color prose");
  assert.match(result.prompt, /5-inch/);
  assert.match(result.prompt, /18-inch/);
  assert.doesNotMatch(result.prompt, /R-(?:5|18)/, "catalog size codes must not leak into the v007 prompt");
  pass("same concept across two bilateral elements dedupes to one canonical phrase carrying both distinct sizes");
}

// ===========================================================================
// 4. Internal concept_id never reaches the prompt.
// ===========================================================================
console.log("4. concept_id never leaks into the prompt");
{
  const spec = scene([element({ id: "ARCH", name: "Arco", type: "arco", placement: "arco_central", role: "focal", productId: ROSE_GOLD_REFLEX_ID, colors: ["dorado rosa"] })]);
  const result = compileProductPrompt({ sceneSpec: spec, visualContext: context, vocabulary: PRODUCT_VOCABULARY });

  for (const concept of PRODUCT_VOCABULARY) {
    assert.ok(!result.prompt.toLowerCase().includes(concept.concept_id.toLowerCase()), `concept_id "${concept.concept_id}" must never appear in the prompt`);
  }
  pass("no concept_id from the vocabulary appears verbatim in the rendered prompt");

  const leaks = findLoraPromptProductLeaks(result.prompt, PRODUCT_VOCABULARY);
  assert.deepEqual(leaks, []);
  pass("findLoraPromptProductLeaks reports zero leaks for a clean canonical prompt");

  const report = preflightLoraPrompt({ sceneSpec: spec, clauses: result.clauses, prompt: result.prompt, vocabulary: PRODUCT_VOCABULARY });
  assert.equal(report.ok, true, report.errors.join("; "));
  assert.deepEqual(report.productLeaks, []);
  pass("preflightLoraPrompt passes clean for a canonical prompt with a vocabulary attached");

  // Simulate an accidental leak (structural shape + literal known id) and
  // confirm the detector actually fires — proving it is not a no-op.
  const leakedPrompt = `${result.prompt} debug: ${"balloon.round.latex.reflex.rose_gold"}`;
  const leakedReport = preflightLoraPrompt({ sceneSpec: spec, clauses: result.clauses, prompt: leakedPrompt, vocabulary: PRODUCT_VOCABULARY });
  assert.equal(leakedReport.ok, false);
  assert.ok(leakedReport.productLeaks.length > 0);
  assert.ok(leakedReport.errors.some((error) => error.includes("fuga de producto")));
  pass("preflightLoraPrompt rejects a prompt containing a literal internal concept_id");

  const structurallyLeakedPrompt = `${result.prompt} some.made.up.internal.token`;
  const shapeLeaks = findLoraPromptProductLeaks(structurallyLeakedPrompt);
  assert.ok(shapeLeaks.length > 0, "a dot-joined lowercase multi-segment token must be flagged even without a vocabulary");
  pass("the concept_id SHAPE check fires even when no vocabulary is supplied");
}

// ===========================================================================
// 5. Reflex stays literal; gold vs rose gold; Satin vs Matte vs Metallic;
//    latex vs foil — all distinguishable in the rendered text.
// ===========================================================================
console.log("5. Visual/finish distinctions preserved in the rendered prompt");
{
  const goldResult = compileProductPrompt({
    sceneSpec: scene([element({ id: "ARCH", name: "Arco", type: "arco", placement: "arco_central", role: "focal", productId: GOLD_REFLEX_ID })]),
    visualContext: context,
    vocabulary: PRODUCT_VOCABULARY,
  });
  const roseGoldResult = compileProductPrompt({
    sceneSpec: scene([element({ id: "ARCH", name: "Arco", type: "arco", placement: "arco_central", role: "focal", productId: ROSE_GOLD_REFLEX_ID })]),
    visualContext: context,
    vocabulary: PRODUCT_VOCABULARY,
  });
  // El acabado debe seguir siendo específico, pero descrito por su apariencia y
  // no por el nombre de la línea: la evaluación del v007 midió 0/6 en acabado
  // ("Fashion conservó reflejos especulares fuertes; no hubo separación mate"),
  // así que conservar la palabra "Reflex" no compraba ninguna discriminación.
  assert.match(goldResult.prompt, /high-gloss chrome/i, "Reflex must render as its observable finish, not as a catalog line name");
  assert.match(roseGoldResult.prompt, /high-gloss chrome/i);
  assert.doesNotMatch(goldResult.prompt, /\bglossy\b/i, "the finish must stay specific, never the legacy generic 'glossy'");
  assert.doesNotMatch(goldResult.prompt, /\bReflex\b/, "catalog line names mean nothing to the image model");
  assert.match(goldResult.prompt, /\bgold\b/i);
  assert.doesNotMatch(goldResult.prompt, /rose gold/i, "plain gold must not collapse into rose gold");
  assert.match(roseGoldResult.prompt, /rose gold/i);
  assert.notEqual(goldResult.prompt, roseGoldResult.prompt);
  pass("Reflex renders as observable finish; gold and rose gold stay distinct");

  const silverResult = compileProductPrompt({
    sceneSpec: scene([element({ id: "ARCH", name: "Arco", type: "arco", placement: "arco_central", role: "focal", productId: SILVER_REFLEX_ID })]),
    visualContext: context,
    vocabulary: PRODUCT_VOCABULARY,
  });
  assert.match(silverResult.prompt, /\bsilver\b/i);
  assert.doesNotMatch(silverResult.prompt, /\bgold\b/i);
  pass("silver Reflex never mentions gold");

  const satinResult = compileProductPrompt({
    sceneSpec: scene([element({ id: "ARCH", name: "Arco", type: "arco", placement: "arco_central", role: "focal", productId: PINK_SATIN_ID })]),
    visualContext: context,
    vocabulary: PRODUCT_VOCABULARY,
  });
  const matteResult = compileProductPrompt({
    sceneSpec: scene([element({ id: "ARCH", name: "Arco", type: "arco", placement: "arco_central", role: "focal", productId: PASTEL_MATTE_PINK_ID })]),
    visualContext: context,
    vocabulary: PRODUCT_VOCABULARY,
  });
  const metallicResult = compileProductPrompt({
    sceneSpec: scene([element({ id: "ARCH", name: "Arco", type: "arco", placement: "arco_central", role: "focal", productId: METAL_GOLD_ID })]),
    visualContext: context,
    vocabulary: PRODUCT_VOCABULARY,
  });
  assert.match(satinResult.prompt, /\bSatin\b/);
  assert.match(matteResult.prompt, /\bmatte\b/i);
  assert.match(metallicResult.prompt, /\bmetallic\b/i);
  assert.notEqual(satinResult.prompt, matteResult.prompt);
  assert.notEqual(matteResult.prompt, metallicResult.prompt);
  assert.notEqual(satinResult.prompt, metallicResult.prompt);
  pass("Satin, Matte, and Metallic finishes render distinguishable text from one another");

  const latexResult = goldResult;
  const foilResult = compileProductPrompt({
    sceneSpec: scene([element({ id: "ARCH", name: "Arco", type: "arco", placement: "arco_central", role: "focal", productId: FOIL_FUCHSIA_ID })]),
    visualContext: context,
    vocabulary: PRODUCT_VOCABULARY,
  });
  assert.match(latexResult.prompt, /\blatex\b/i);
  assert.match(foilResult.prompt, /\bfoil\b/i);
  assert.doesNotMatch(latexResult.prompt, /\bfoil\b/i);
  assert.doesNotMatch(foilResult.prompt, /\blatex\b/i);
  pass("latex and foil materials remain textually distinct, never conflated");

  const linkoloonResult = compileProductPrompt({
    sceneSpec: scene([element({ id: "ARCH", name: "Arco", type: "arco", placement: "arco_central", role: "focal", productId: LINKOLOON_WHITE_ID })]),
    visualContext: context,
    vocabulary: PRODUCT_VOCABULARY,
  });
  assert.match(linkoloonResult.prompt, /Link-O-Loon/i);
  pass("Link-O-Loon canonical label is preserved literally");
}

// ===========================================================================
// 6. Legacy compilation is explicit and diagnosed, never silent.
// ===========================================================================
console.log("6. Legacy fallback is explicit, not silent");
{
  const spec = scene([element({ id: "ARCH", name: "Arco Orgánico", type: "arco", placement: "arco_central", role: "focal", colors: ["rosado"] })]);

  const noVocabResult = compileProductPrompt({ sceneSpec: spec, visualContext: context });
  assert.equal(noVocabResult.legacy, true);
  assert.ok(noVocabResult.legacyReason && noVocabResult.legacyReason.length > 0);
  assert.ok(noVocabResult.diagnostics.some((line) => line.includes("legacy fallback")));
  assert.deepEqual(noVocabResult.resolved_concepts, []);
  pass("omitting the vocabulary produces an explicit legacy=true result with a non-empty diagnostic, never a silent claim of canonical fidelity");

  const emptyVocabResult = compileProductPrompt({ sceneSpec: spec, visualContext: context, vocabulary: [] });
  assert.equal(emptyVocabResult.legacy, true);
  pass("an empty vocabulary array is also treated as an explicit legacy fallback");

  const noCatalogBackedSpec = scene([element({ id: "ARCH", name: "Arco Orgánico", type: "arco", placement: "arco_central", role: "focal", colors: ["rosado"] })]);
  const noProductResult = compileProductPrompt({ sceneSpec: noCatalogBackedSpec, visualContext: context, vocabulary: PRODUCT_VOCABULARY });
  assert.equal(noProductResult.legacy, true, "a scene with zero catalog-backed elements must also fall back explicitly, even with a valid vocabulary");
  assert.ok(noProductResult.diagnostics.some((line) => line.includes("legacy fallback")));
  pass("a scene with no catalog-backed elements falls back to legacy explicitly even when a valid vocabulary is supplied");
}

// ===========================================================================
// 7. Unresolved products: unknown / ambiguous / invalid, and partial
//    multi-material resolution never renders a half-canonical phrase.
// ===========================================================================
console.log("7. unresolved_products reasons and partial-resolution safety");
{
  const unknownSpec = scene([element({ id: "ARCH", name: "Arco", type: "arco", placement: "arco_central", role: "focal", productId: "does-not-exist-in-catalog" })]);
  const unknownResult = compileProductPrompt({ sceneSpec: unknownSpec, visualContext: context, vocabulary: PRODUCT_VOCABULARY });
  assert.deepEqual(unknownResult.unresolved_products, [{ product_id: "does-not-exist-in-catalog", reason: "unknown" }]);
  assert.equal(unknownResult.legacy, true);
  pass("an unmapped product id is reported with reason 'unknown' and the scene falls back to legacy");

  // Shopify variant ids are not guaranteed to be present in the vocabulary;
  // the trusted parent title must resolve them through an exact catalog title.
  const variantId = "41264805445825";
  const parentConcept = PRODUCT_VOCABULARY.find((concept) => concept.catalog_titles?.length && concept.catalog_product_ids.includes(ROSE_GOLD_REFLEX_ID));
  assert.ok(parentConcept, "fixture must contain a concept with a catalog title");
  const variantResult = compileProductPrompt({
    sceneSpec: scene([element({ id: "VARIANT", name: "Variante Shopify", type: "arco", placement: "arco_central", role: "focal", productId: variantId })]),
    visualContext: context,
    vocabulary: PRODUCT_VOCABULARY,
    productCatalogTitles: new Map([[variantId, parentConcept.catalog_titles![0]]]),
  });
  assert.deepEqual(variantResult.unresolved_products, []);
  assert.deepEqual(variantResult.resolved_concepts, [parentConcept.concept_id]);
  pass("a variant id absent from the vocabulary resolves through its trusted parent catalog title");

  const invalidSpec = scene([element({ id: "ARCH", name: "Arco", type: "arco", placement: "arco_central", role: "focal", productId: "   " })]);
  const invalidResult = compileProductPrompt({ sceneSpec: invalidSpec, visualContext: context, vocabulary: PRODUCT_VOCABULARY });
  assert.deepEqual(invalidResult.unresolved_products, [{ product_id: "   ", reason: "invalid" }]);
  pass("a whitespace-only product id is reported with reason 'invalid'");

  // Deliberately ambiguous LOCAL fixture vocabulary: two active concepts
  // declare the same catalog_product_id. The real shipped vocabulary can
  // never do this (checkVocabularyInvariants forbids it), but the resolver's
  // "ambiguous" outcome must still be surfaced correctly when it occurs.
  const ambiguousVocabulary: ProductVocabulary = [
    {
      concept_id: "balloon.round.latex.reflex.gold",
      canonical_label: "round latex balloon in gold with a Reflex high-shine finish",
      visual: { family: "Reflex", shape: "round", material: "latex", color: "gold", finish: "Reflex high-shine", pattern: { kind: "solid" } },
      aliases: { es: [], en: [], contextual: [] },
      catalog_product_ids: ["AMBIGUOUS-ID"],
      sizes: { separate: true, allowed_codes: ["R-12"] },
      status: "active",
      vocabulary_version: "test-vocab-ambiguous.v1",
    },
    {
      concept_id: "balloon.round.latex.reflex.rose_gold",
      canonical_label: "round latex balloon in rose gold with a Reflex high-shine finish",
      visual: { family: "Reflex", shape: "round", material: "latex", color: "rose gold", finish: "Reflex high-shine", pattern: { kind: "solid" } },
      aliases: { es: [], en: [], contextual: [] },
      catalog_product_ids: ["AMBIGUOUS-ID"],
      sizes: { separate: true, allowed_codes: ["R-12"] },
      status: "active",
      vocabulary_version: "test-vocab-ambiguous.v1",
    },
  ];
  const ambiguousSpec = scene([element({ id: "ARCH", name: "Arco", type: "arco", placement: "arco_central", role: "focal", productId: "AMBIGUOUS-ID" })]);
  const ambiguousResult = compileProductPrompt({ sceneSpec: ambiguousSpec, visualContext: context, vocabulary: ambiguousVocabulary });
  assert.deepEqual(ambiguousResult.unresolved_products, [{ product_id: "AMBIGUOUS-ID", reason: "ambiguous" }]);
  assert.equal(ambiguousResult.legacy, true);
  assert.equal(ambiguousResult.vocabulary_version, "test-vocab-ambiguous.v1");
  pass("a product id mapped to two active concepts is reported with reason 'ambiguous' and never silently guessed");

  // Partial multi-material element: one material resolves, one does not.
  const partialSpec = scene([
    element({ id: "MIX", name: "Mezcla de globos", type: "kit", placement: "piso_frontal", role: "acento", productIds: [GOLD_REFLEX_ID, "unknown-material-id"] }),
  ]);
  const partialResult = compileProductPrompt({ sceneSpec: partialSpec, visualContext: context, vocabulary: PRODUCT_VOCABULARY });
  assert.deepEqual(partialResult.resolved_concepts, [], "a partially-resolved multi-material element must not contribute any concept");
  assert.ok(partialResult.unresolved_products.some((entry) => entry.product_id === "unknown-material-id" && entry.reason === "unknown"));
  assert.ok(partialResult.diagnostics.some((line) => line.includes("falling back to legacy rendering for this element")));
  const goldConcept = PRODUCT_VOCABULARY.find((c) => c.concept_id === "balloon.round.latex.reflex.gold")!;
  assert.ok(!partialResult.prompt.includes(goldConcept.canonical_label), "the resolved half of a partial multi-material element must not leak into the prompt as if it were the whole element");
  pass("an element with one resolved and one unresolved material falls back to legacy for that whole element, never a half-canonical phrase");
}

// ===========================================================================
// 8. Structural regression: structure/placement/relations text is byte-
//    identical with and without product concepts; only the color/finish
//    segment changes.
// ===========================================================================
console.log("8. Structure, placement, and bilateral relations are unaffected");
{
  const spec = scene([
    element({ id: "ARCH", name: "Arco principal", type: "arco", placement: "arco_central", role: "focal", colors: ["rosado", "dorado rosa"] }),
    element({ id: "COL_L", name: "Columna izquierda", type: "columna", placement: "lateral_izquierdo", role: "soporte", group: "cols", productId: ROSE_GOLD_REFLEX_ID, colors: ["dorado rosa"] }),
    element({ id: "COL_R", name: "Columna derecha", type: "columna", placement: "lateral_derecho", role: "soporte", group: "cols", productId: ROSE_GOLD_REFLEX_ID, colors: ["dorado rosa"] }),
  ]);

  const legacyOnly = compileLoraCaption({ sceneSpec: spec, visualContext: context });
  const withProducts = compileProductPrompt({ sceneSpec: spec, visualContext: context, vocabulary: PRODUCT_VOCABULARY });

  assert.equal(legacyOnly.clauses.length, withProducts.clauses.length, "grouping into clauses (structure/placement) must be unaffected by product concepts");
  for (let i = 0; i < legacyOnly.clauses.length; i += 1) {
    assert.deepEqual(legacyOnly.clauses[i].elementIds, withProducts.clauses[i].elementIds);
    assert.equal(legacyOnly.clauses[i].structureType, withProducts.clauses[i].structureType);
    assert.equal(legacyOnly.clauses[i].placement, withProducts.clauses[i].placement);
    assert.equal(legacyOnly.clauses[i].count, withProducts.clauses[i].count);
    assert.equal(legacyOnly.clauses[i].bilateral, withProducts.clauses[i].bilateral);
  }
  pass("clause structure/placement/count/bilateral are identical whether or not product concepts are supplied");

  assert.match(withProducts.prompt, /flanking the main arch/i);
  assert.match(withProducts.prompt, /one standing on the left and one on the right/i);
  pass("bilateral relationship language is preserved when canonical product concepts are rendered");

  const report = preflightLoraPrompt({ sceneSpec: spec, clauses: withProducts.clauses, prompt: withProducts.prompt, vocabulary: PRODUCT_VOCABULARY });
  assert.equal(report.ok, true, report.errors.join("; "));
  assert.equal(report.relationships.expected, report.relationships.represented);
  pass("preflightLoraPrompt still validates structural coverage and bilateral relationships for a canonical prompt");
}

// ===========================================================================
// 9. Determinism: identical input produces identical output.
// ===========================================================================
console.log("9. Deterministic output");
{
  const spec = scene([
    element({ id: "ARCH", name: "Arco", type: "arco", placement: "arco_central", role: "focal", productId: ROSE_GOLD_REFLEX_ID }),
    element({ id: "COL", name: "Columna", type: "columna", placement: "piso_frontal", role: "acento", productId: GOLD_REFLEX_ID }),
  ]);
  const run1 = compileProductPrompt({ sceneSpec: spec, visualContext: context, vocabulary: PRODUCT_VOCABULARY });
  const run2 = compileProductPrompt({ sceneSpec: spec, visualContext: context, vocabulary: PRODUCT_VOCABULARY });
  assert.equal(run1.prompt, run2.prompt);
  assert.deepEqual(run1.resolved_concepts, run2.resolved_concepts);
  assert.deepEqual(run1.unresolved_products, run2.unresolved_products);
  pass("compileProductPrompt is deterministic across repeated runs with identical input");
}

// ===========================================================================
// 10. Commercial-leak detection (SKU/price/package) keeps working alongside
//     the new concept_id checks.
// ===========================================================================
console.log("10. Commercial leak detection");
{
  assert.ok(findLoraPromptProductLeaks("eventdecor_style_v2, SKU 12345 balloon arch.").length > 0);
  assert.ok(findLoraPromptProductLeaks("eventdecor_style_v2, PAQUETE X 12 balloons.").length > 0);
  assert.ok(findLoraPromptProductLeaks("eventdecor_style_v2, price $45000 arch.").length > 0);
  assert.equal(findLoraPromptProductLeaks("eventdecor_style_v2, a gold Reflex balloon arch, wide photorealistic event photograph.").length, 0);
  pass("commercial tokens (SKU, package quantity, currency) are still flagged; clean canonical prose is not");
}

// ===========================================================================
// 11. Shopify variant ids resolve through their parent product/family id.
// ===========================================================================
console.log("11. Variant id -> product family resolution");
{
  const variantId = "41264994517185";
  const spec = scene([element({ id: "ARCH", name: "Arco", type: "arco", placement: "arco_central", role: "focal", productId: variantId })]);
  const result = compileProductPrompt({
    sceneSpec: spec,
    visualContext: context,
    vocabulary: PRODUCT_VOCABULARY,
    productIdAliases: new Map([[variantId, ROSE_GOLD_REFLEX_ID]]),
    sizeConfirmations: [{ elementId: "ARCH", productId: variantId, sizeCode: "R-12" }],
  });
  assert.deepEqual(result.unresolved_products, []);
  assert.deepEqual(result.resolved_concepts, ["balloon.round.latex.reflex.rose_gold"]);
  assert.match(result.prompt, /round latex balloon in rose gold with a high-gloss chrome finish/);
  assert.match(result.prompt, /12-inch/);
  pass("a Shopify variant id resolves canonically through its parent product id while preserving its confirmed size");
}

// ===========================================================================
// 12. Newly covered v007 families use source-backed canonical labels.
// ===========================================================================
console.log("12. v007 Silk and metallized-curtain coverage");
{
  const silkVariantId = "48405602074817";
  const curtainVariantId = "41259008721089";
  const spec = scene([
    element({ id: "ARCH", name: "Arco", type: "arco", placement: "arco_central", role: "focal", productId: silkVariantId }),
    element({ id: "BACKDROP", name: "Fondo", type: "backdrop", placement: "fondo_pared", role: "soporte", productId: curtainVariantId }),
  ]);
  const result = compileProductPrompt({
    sceneSpec: spec,
    visualContext: context,
    vocabulary: PRODUCT_VOCABULARY,
    productIdAliases: new Map([
      [silkVariantId, ["20018483", SILK_CREAM_PEARL_ID]],
      [curtainVariantId, ["30000993", METALLIZED_PINK_CURTAIN_ID]],
    ]),
    sizeConfirmations: [
      { elementId: "ARCH", productId: silkVariantId, sizeCode: "R-12" },
      { elementId: "BACKDROP", productId: curtainVariantId, sizeCode: "PAQUETE X 1" },
    ],
  });
  assert.deepEqual(result.unresolved_products, []);
  assert.ok(result.prompt.includes(aDescriptorPerceptual("round latex balloon in cream pearl with a Silk satin finish")));
  assert.ok(result.prompt.includes("metallized foil fringe curtain in pink"));
  assert.match(result.prompt, /12-inch/);
  assert.equal(result.legacy, false);
  pass("Silk cream-pearl and pink metallized-fringe products resolve from exact source-backed labels");
}

// ===========================================================================
// 13. Live v007 variants resolve through the families that the dataset audit
//    already approved, including the three families that previously failed
//    with LORA_PRODUCT_VOCABULARY_FAILED.
// ===========================================================================
console.log("13. Previously failing live v007 families resolve canonically");
{
  const cases = [
    {
      variantId: "42420722303169",
      familyId: "7546469318849",
      conceptId: "balloon.round.latex.pastel_dusk.pink",
      label: "round latex balloon in pink with a Pastel Dusk muted finish",
      sizeCode: "R-5",
    },
    {
      variantId: "48405600141505",
      familyId: "10467043377345",
      conceptId: "balloon.round.latex.silk.spring_pink",
      label: "round latex balloon in spring pink with a Silk satin finish",
      sizeCode: "R-12",
    },
    {
      variantId: "41264935076033",
      familyId: "7109602214081",
      conceptId: "balloon.round.latex.fashion.black.printed_unclassified_interrogacion",
      label: "round latex balloon in black with a matte Fashion finish and a printed pattern",
      sizeCode: "R-36",
    },
  ] as const;

  for (const [index, testCase] of cases.entries()) {
    const spec = scene([element({ id: `LIVE_${index}`, name: "Producto v007", type: "arco", placement: "arco_central", role: "focal", productId: testCase.variantId })]);
    const result = compileProductPrompt({
      sceneSpec: spec,
      visualContext: context,
      vocabulary: PRODUCT_VOCABULARY,
      productIdAliases: new Map([[testCase.variantId, testCase.familyId]]),
      sizeConfirmations: [{ elementId: `LIVE_${index}`, productId: testCase.variantId, sizeCode: testCase.sizeCode }],
    });
    assert.deepEqual(result.unresolved_products, [], `${testCase.variantId} must resolve through its approved family`);
    assert.deepEqual(result.resolved_concepts, [testCase.conceptId]);
    assert.match(result.prompt, new RegExp(aDescriptorPerceptual(testCase.label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  pass("Pastel Dusk pink, Silk spring pink, and Infinity Interrogacion black variants resolve from v007 evidence");
}

// ===========================================================================
// 14. Regression (LORA_PREFLIGHT_FAILED "cobertura de colores 2/3; longitud
//     845 supera límite 750"): an approved XV scene in rosa/dorado/plateado
//     must compile within the budget with every structure, placement,
//     relation and color, including a shade whose label lacks the plan color.
// ===========================================================================
console.log("14. XV scene with three approved colors fits the LoRA budget");
{
  const xvContext = buildVisualContext({
    brief: { tipo_evento: "XV años", estilo: "glamour", colores: ["rosa", "dorado", "plateado"], espacio: "salón" },
    userRequest: "Quiero decorar unos XV años en un salón, estilo glamour, colores rosa, dorado y plateado",
  });
  const spec = scene([
    element({ id: "EST_01_ARCO", name: "Arco orgánico central", type: "arco", placement: "arco_central", role: "focal", colors: ["rosado", "dorado", "plateado"], productIds: [DUSTY_ROSE_FASHION_ID, GOLD_REFLEX_ID, SILVER_REFLEX_ID] }),
    element({ id: "EST_02_COLUMNA_IZQ", name: "Columna izquierda", type: "columna", placement: "lateral_izquierdo", role: "soporte", group: "cols", colors: ["rosado", "dorado"], productIds: [DUSTY_ROSE_FASHION_ID, GOLD_REFLEX_ID] }),
    element({ id: "EST_03_COLUMNA_DER", name: "Columna derecha", type: "columna", placement: "lateral_derecho", role: "soporte", group: "cols", colors: ["rosado", "dorado"], productIds: [DUSTY_ROSE_FASHION_ID, GOLD_REFLEX_ID] }),
    element({ id: "EST_04_CENTRO_MESA", name: "Centro de mesa principal", type: "centro_mesa", placement: "sobre_mesa_principal", role: "acento", colors: ["dorado", "plateado"], productIds: [GOLD_REFLEX_ID, SILVER_REFLEX_ID] }),
  ]);
  const archSizes: ElementSizeConfirmation[] = ["R-9", "R-12", "R-18"].flatMap((sizeCode) =>
    [DUSTY_ROSE_FASHION_ID, GOLD_REFLEX_ID, SILVER_REFLEX_ID].map((productId) => ({ elementId: "EST_01_ARCO", productId, sizeCode })),
  );
  const sizeConfirmations: ElementSizeConfirmation[] = [
    ...archSizes,
    { elementId: "EST_02_COLUMNA_IZQ", productId: DUSTY_ROSE_FASHION_ID, sizeCode: "R-12" },
    { elementId: "EST_02_COLUMNA_IZQ", productId: GOLD_REFLEX_ID, sizeCode: "R-12" },
    { elementId: "EST_04_CENTRO_MESA", productId: SILVER_REFLEX_ID, sizeCode: "R-5" },
  ];
  // Product wording (v007 captions, trigger v3): this section exercises label compaction.
  const trigger = "eventdecor_style_v3";
  const result = compileProductPrompt({ sceneSpec: spec, visualContext: xvContext, vocabulary: PRODUCT_VOCABULARY, sizeConfirmations, trigger });
  // The route swaps the compiler's trigger for the resolved one (ensureLoraTriggers).
  const report = preflightLoraPrompt({ sceneSpec: spec, clauses: result.clauses, prompt: result.prompt.replace(/^eventdecor_style_v2/, trigger), triggers: [trigger], vocabulary: PRODUCT_VOCABULARY });

  assert.equal(result.legacy, false);
  assert.deepEqual(result.unresolved_products, []);
  assert.equal(report.ok, true, `${report.errors.join("; ")}\n${result.prompt}`);
  assert.deepEqual(report.colors, { expected: 3, represented: 3 });
  assert.ok(result.prompt.length <= LORA_PROMPT_MAX_LENGTH, `prompt length ${result.prompt.length}`);
  pass("three-color XV scene passes preflight (colors 3/3) within the 750-character budget");

  assert.match(result.prompt, /dusty rose/, "the product's own shade stays in the prompt");
  assert.match(result.prompt, /\bpink\b/, "the approved plan color (rosado -> pink) must still reach the model");
  assert.match(result.prompt, /\bgold\b/);
  assert.match(result.prompt, /\bsilver\b/);
  assert.match(result.prompt, /organic balloon arch/);
  assert.match(result.prompt, /two balloon columns/);
  assert.match(result.prompt, /balloon centerpiece/);
  assert.match(result.prompt, /centered around the stage photo area/);
  assert.match(result.prompt, /one standing on the left and one on the right, flanking the main arch/);
  assert.match(result.prompt, /placed on the main table/);
  assert.deepEqual(report.structures, { expected: 4, represented: 4 });
  assert.deepEqual(report.relationships, { expected: 1, represented: 1 });
  assert.deepEqual(findLoraPromptLanguageLeaks(result.prompt), []);
  pass("compaction keeps every structure, placement, bilateral relation and color, with no Spanish leak");

  assert.ok(result.diagnostics.some((line) => line.includes("prompt compacted")), "a compacted prompt must be reported in diagnostics");
  const again = compileProductPrompt({ sceneSpec: spec, visualContext: xvContext, vocabulary: PRODUCT_VOCABULARY, sizeConfirmations, trigger });
  assert.equal(again.prompt, result.prompt);
  pass("compaction is deterministic and observable in diagnostics");

  const longTrigger = "eventdecor_structure_v12";
  const withLongTrigger = compileProductPrompt({ sceneSpec: spec, visualContext: xvContext, vocabulary: PRODUCT_VOCABULARY, sizeConfirmations, trigger: longTrigger });
  const effectiveLength = withLongTrigger.prompt.length - trigger.length + longTrigger.length;
  assert.ok(effectiveLength <= LORA_PROMPT_MAX_LENGTH, `effective length with the resolved trigger: ${effectiveLength}`);
  pass("the budget accounts for the resolved LoRA trigger that replaces the compiler's own");

  const small = scene([element({ id: "ARCH", name: "Arco", type: "arco", placement: "arco_central", role: "focal", colors: ["rosado"], productId: DUSTY_ROSE_FASHION_ID })]);
  const smallResult = compileProductPrompt({ sceneSpec: small, visualContext: context, vocabulary: PRODUCT_VOCABULARY });
  const smallReport = preflightLoraPrompt({ sceneSpec: small, clauses: smallResult.clauses, prompt: smallResult.prompt, vocabulary: PRODUCT_VOCABULARY });
  assert.equal(smallReport.ok, true, smallReport.errors.join("; "));
  assert.ok(smallResult.prompt.includes("round latex balloon in dusty rose pink, solid matte finish"), "a scene that fits keeps the full label, with the plan color attached to its shade");
  assert.doesNotMatch(smallResult.prompt, /pink tones/, "the plan color must not become a global tint (it produced pink walls and gradients)");
  assert.ok(!smallResult.diagnostics.some((line) => line.includes("prompt compacted")));
  pass("a scene that already fits is rendered in full, and a shade label still carries its plan color");
}

// ===========================================================================
// 15. Regression: UTF-8 text in the vocabulary was committed as mojibake
//     (UTF-8 bytes decoded as Windows-1252), so accented catalog titles such
//     as "CUMPLEAÑOS" never resolved.
// ===========================================================================
console.log("15. Accented catalog titles resolve and sources carry no mojibake");
{
  for (const title of ["BANDEROLA METALIZADA FELIZ CUMPLEAÑOS FESTIVO", "CARTEL DE LETRAS CUMPLEAÑOS PARAISO TROPICAL"]) {
    const resolved = resolveProductConcept({ text: title }, PRODUCT_VOCABULARY);
    assert.equal(resolved.status, "resolved", `${title} must resolve by exact catalog title`);
  }
  pass("catalog titles with Ñ resolve by exact title");

  // Sequences produced when UTF-8 bytes are decoded as Windows-1252.
  const mojibake = /\u00c3[\u0080-\u00bf\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u0192\u02c6\u02dc\u2013\u2014\u2018-\u201e\u2020-\u2022\u2026\u2030\u2039\u203a\u20ac\u2122]|\u00c2[\u00a0-\u00bf]|\u00e2\u20ac/;
  // Deliberate alias for a catalog title variant imported with a mojibake "®".
  const allowed = ["LINK-O-LOON\u00c2\u00ae"];
  assert.ok(mojibake.test("quinceaÃ±era"), "the mojibake detector must flag UTF-8 decoded as Windows-1252");
  assert.ok(!mojibake.test("quinceañera celebración ®"), "correct UTF-8 text must not be flagged");
  const sources = [
    "src/lib/ia/kagutsuchi/lora-prompt-preflight.ts",
    "src/lib/ia/kagutsuchi/lora-product-runtime.ts",
    "src/lib/ia/kagutsuchi/lora-caption-compiler.ts",
    "src/lib/lora/product-vocabulary.ts",
    "src/lib/lora/product-vocabulary-data.ts",
    "src/lib/lora/product-vocabulary-catalog-data.ts",
  ];
  for (const source of sources) {
    const lines = readFileSync(new URL(`../../${source}`, import.meta.url), "utf8").split("\n");
    const offending = lines
      .map((line, index) => ({ line: allowed.reduce((text, value) => text.split(value).join(""), line), index }))
      .filter(({ line }) => mojibake.test(line))
      .map(({ index }) => `${source}:${index + 1}`);
    assert.deepEqual(offending, [], "mojibake in a LoRA source file");
  }
  pass("LoRA prompt and vocabulary sources contain no mojibake sequences");
}

// ===========================================================================
// 16. Regression: sizes belong to the exact selected variant and structure.
//     The route picked the first family sibling (an R-5 label for R-24 lines)
//     and the runtime applied a product's sizes to every structure using it.
// ===========================================================================
console.log("16. Confirmed sizes follow the exact variant and structure");
{
  const products = [
    { id: "V-GOLD-R5", familiaId: "P-GOLD", tamanoCodigo: "R-5", diamPulg: 5 },
    { id: "V-GOLD-R18", familiaId: "P-GOLD", tamanoCodigo: "R-18", diamPulg: 18 },
    { id: "V-SILVER-R12", familiaId: "P-SILVER", tamanoCodigo: "R-12", diamPulg: 12 },
  ];
  const confirmations = sizeConfirmationsFromMaterialLines([
    { structure_id: "ARCH", product_id: "P-GOLD", variant_id: "V-GOLD-R18" },
    { structure_id: "ARCH", product_id: "P-GOLD" },
    { structure_id: "ARCH", product_id: "P-SILVER" },
  ], products);
  assert.deepEqual(confirmations, [
    { elementId: "ARCH", productId: "V-GOLD-R18", sizeCode: "R-18", diameterInches: 18 },
    { elementId: "ARCH", productId: "P-SILVER", sizeCode: "R-12", diameterInches: 12 },
  ], "exact variant wins; an ambiguous family (R-5 and R-18) yields no size; a single-size family does");
  pass("size confirmations use the exact variant and never an arbitrary family sibling");

  const spec = scene([
    element({ id: "ARCH", name: "Arco", type: "arco", placement: "arco_central", role: "focal", colors: ["dorado"], productId: GOLD_REFLEX_ID }),
    element({ id: "CENTER", name: "Centro", type: "centro_mesa", placement: "sobre_mesa_principal", colors: ["plateado"], productIds: [GOLD_REFLEX_ID, SILVER_REFLEX_ID] }),
  ]);
  const result = compileProductPrompt({
    sceneSpec: spec,
    visualContext: context,
    vocabulary: PRODUCT_VOCABULARY,
    sizeConfirmations: [
      { elementId: "ARCH", productId: GOLD_REFLEX_ID, sizeCode: "R-18" },
      { elementId: "CENTER", productId: GOLD_REFLEX_ID, sizeCode: "R-5" },
    ],
  });
  assert.match(result.prompt, /centered around the stage photo area/);
  assert.doesNotMatch(result.prompt, /5-inch and 18-inch/, "one structure's size must not be attached to another structure");
  assert.match(result.prompt, /\(18-inch\) centered around the stage photo area/);
  pass("a product used by two structures keeps each structure's own confirmed size");
}

// ===========================================================================
// 17. The prompt follows the captions of the LoRA that reads it. training_1
//     runs lora-run-v004-1000 (trigger eventdecor_style_v2), trained on scene
//     captions without inches, "round latex balloon" or "stage photo area";
//     the v007 product wording produced incoherent compositions with it.
// ===========================================================================
console.log("17. Caption wording follows the resolved LoRA");
{
  const PASTEL_DUSK_BLUE = PRODUCT_VOCABULARY.find((concept) => concept.concept_id === "balloon.round.latex.pastel_dusk.blue")!;
  const WHITE_FASHION = PRODUCT_VOCABULARY.find((concept) => concept.concept_id === "balloon.round.latex.fashion.white")!;
  const blueId = PASTEL_DUSK_BLUE.catalog_product_ids[0]!;
  const whiteId = WHITE_FASHION.catalog_product_ids[0]!;
  const spec = scene([
    element({ id: "HALF_ARCH", name: "Semiarco", type: "semiarco", placement: "arco_central", role: "focal", colors: ["azul"], productId: blueId }),
    element({ id: "COLUMN", name: "Columna", type: "columna", placement: "lateral_izquierdo", role: "soporte", colors: ["azul"], productId: blueId }),
    element({ id: "GARLAND", name: "Guirnalda", type: "guirnalda", placement: "piso_frontal", role: "acento", colors: ["blanco"], productId: whiteId }),
  ]);
  const sizeConfirmations: ElementSizeConfirmation[] = ["R-5", "R-12", "R-24"].flatMap((sizeCode) => [
    { elementId: "HALF_ARCH", productId: blueId, sizeCode },
    { elementId: "COLUMN", productId: blueId, sizeCode },
    { elementId: "GARLAND", productId: whiteId, sizeCode },
  ]);

  const v004 = compileProductPrompt({ sceneSpec: spec, visualContext: context, vocabulary: PRODUCT_VOCABULARY, sizeConfirmations, trigger: "eventdecor_style_v2" });
  const v004Report = preflightLoraPrompt({ sceneSpec: spec, clauses: v004.clauses, prompt: v004.prompt, triggers: ["eventdecor_style_v2"], vocabulary: PRODUCT_VOCABULARY });
  assert.equal(v004Report.ok, true, `${v004Report.errors.join("; ")}\n${v004.prompt}`);
  assert.doesNotMatch(v004.prompt, /inch|round latex balloon|stage/i, "v004 captions never use inch sizes, catalog object labels or a stage");
  assert.match(v004.prompt, /a one-sided curved organic balloon garland of large and small muted matte blue balloons/);
  assert.match(v004.prompt, /organic balloon column of large and small muted matte blue balloons standing apart on the left/);
  // R-24 no es un tamaño permitido del blanco, así que quedan R-5 y R-12: dos
  // diámetros distintos son "large and small" en la redacción relativa de v004
  // (antes la mezcla se describía entera como "small").
  assert.match(v004.prompt, /organic balloon garland of large and small matte white balloons resting on the floor in front/);
  assert.match(v004.prompt, /\. set in an indoor event hall, birthday celebration atmosphere/, "the venue becomes the v004 \"set in/against\" setting");
  pass("eventdecor_style_v2 prompts use the v004 scene wording and still pass preflight");

  const v007 = compileProductPrompt({ sceneSpec: spec, visualContext: context, vocabulary: PRODUCT_VOCABULARY, sizeConfirmations, trigger: "eventdecor_style_v3" });
  assert.match(v007.prompt, /round latex balloon in blue/);
  assert.match(v007.prompt, /5-inch/);
  assert.deepEqual(v007.resolved_concepts, v004.resolved_concepts, "wording never changes product identity");
  pass("eventdecor_style_v3 keeps the v007 product wording with the same resolved concepts");

  const pinkShade = scene([element({ id: "ARCH", name: "Arco", type: "arco", placement: "fondo_pared", role: "focal", colors: ["rosado", "blanco"], productIds: [DUSTY_ROSE_FASHION_ID, whiteId] })]);
  const pink = compileProductPrompt({ sceneSpec: pinkShade, visualContext: context, vocabulary: PRODUCT_VOCABULARY, trigger: "eventdecor_style_v2" });
  const pinkReport = preflightLoraPrompt({ sceneSpec: pinkShade, clauses: pink.clauses, prompt: pink.prompt, triggers: ["eventdecor_style_v2"], vocabulary: PRODUCT_VOCABULARY });
  assert.equal(pinkReport.ok, true, pinkReport.errors.join("; "));
  assert.match(pink.prompt, /matte dusty rose pink and matte white balloons against the rear wall/);
  assert.doesNotMatch(pink.prompt, /tones/);
  pass("the approved color stays attached to the product shade in the v004 wording");
}

// ===========================================================================
// 18. Reference structures: typed detection, heights, non-catalog styling
//     and the JSON prompt variant.
// ===========================================================================
console.log("18. Reference structures, relative heights, styling and JSON prompt");
{
  // Two asymmetrical half-arches (a short one on the left, a tall one on the
  // right curving toward it) used to become "column + half-arch + garland".
  const left = parseDetectedStructure({ structure_type: "half_arch", horizontal_position: "left", relative_height: "short", curves_toward: "right", grounded: true, mirrors_element: "none" });
  const right = parseDetectedStructure({ structure_type: "Half-Arch", horizontal_position: "right", relative_height: "tall", curves_toward: "left", grounded: true });
  assert.ok(left && right);
  assert.equal(parseDetectedStructure({ structure_type: "spiral tower" }), undefined, "unknown structure types are discarded, never guessed");
  assert.equal(shapeDescription(right), "tall half-arch, on the right, curving toward the left, standing on the floor");
  const semantics = referenceStructureSemantics([
    { elementId: "REF_01_E01", bbox: { x: 0.02, y: 0.3, width: 0.3, height: 0.6 }, structure: left },
    { elementId: "REF_01_E02", bbox: { x: 0.4, y: 0.1, width: 0.55, height: 0.85 }, structure: right },
    { elementId: "REF_01_E03", bbox: { x: 0.4, y: 0.7, width: 0.2, height: 0.2 } },
  ], "dense");
  assert.deepEqual(semantics.get("REF_01_E01"), { structure_type: "semiarco", placement: "lateral_izquierdo", design_role: "soporte", repetition_group: "REF_01_E01", density: "lujosa" });
  assert.deepEqual(semantics.get("REF_01_E02"), { structure_type: "semiarco", placement: "lateral_derecho", design_role: "focal", repetition_group: "REF_01_E02", density: "lujosa" });
  assert.equal(semantics.has("REF_01_E03"), false, "an element without a detected structure gets no invented semantics");
  pass("detected half-arches map to typed semiarco semantics with side and focal role");

  const pairSpec = scene([
    { ...element({ id: "HALF_L", name: "Semiarco izquierdo", type: "semiarco", placement: "lateral_izquierdo", role: "soporte", colors: ["azul"], productId: GOLD_REFLEX_ID }), visual_semantics: { structure_type: "semiarco", placement: "lateral_izquierdo", design_role: "soporte", repetition_group: "HALF_L", density: "media", dimensions_m: { height: 1.5 } } },
    { ...element({ id: "HALF_R", name: "Semiarco derecho", type: "semiarco", placement: "lateral_derecho", role: "soporte", colors: ["azul"], productId: GOLD_REFLEX_ID }), visual_semantics: { structure_type: "semiarco", placement: "lateral_derecho", design_role: "soporte", repetition_group: "HALF_R", density: "media", dimensions_m: { height: 2.4 } } },
  ] as SceneSpec["elements"]);
  const pair = compileProductPrompt({ sceneSpec: pairSpec, visualContext: context, vocabulary: PRODUCT_VOCABULARY, trigger: "eventdecor_style_v2" });
  assert.equal(pair.clauses.length, 2, "structures with clearly different heights are not merged into a matching pair");
  assert.match(pair.prompt, /shorter one-sided curved organic balloon garland .* on the left/);
  assert.match(pair.prompt, /taller one-sided curved organic balloon garland .* on the right/);
  assert.doesNotMatch(pair.prompt, /matching one another|one standing on the left and one on the right/);
  assert.match(pair.prompt, /the two curved garlands stand apart with an open gap between them/);
  assert.doesNotMatch(pair.prompt, /flanking/, "a separate half-arch is not described as flanking the other one");
  const pairReport = preflightLoraPrompt({ sceneSpec: pairSpec, clauses: pair.clauses, prompt: pair.prompt, triggers: ["eventdecor_style_v2"], vocabulary: PRODUCT_VOCABULARY });
  assert.equal(pairReport.ok, true, pairReport.errors.join("; "));
  pass("different approved heights render as shorter/taller separate pieces, not a symmetric pair");

  // Regression (2026-09-14): a tall asymmetrical half-arch on the right and a
  // short asymmetrical column on the left rendered as one full arch. The
  // prompt had no gap phrase (only two half-arches got one) and no relative
  // height (only same-type structures were compared).
  const mixedSpec = scene([
    { ...element({ id: "EST_01_SEMIARCO", name: "Semiarco asimétrico derecho", type: "semiarco", placement: "lateral_derecho", role: "focal", colors: ["azul"], productId: GOLD_REFLEX_ID }), visual_semantics: { structure_type: "semiarco", placement: "lateral_derecho", design_role: "focal", repetition_group: "EST_01_SEMIARCO", density: "media", dimensions_m: { height: 2.2 } } },
    { ...element({ id: "EST_02_COLUMNA", name: "Columna asimétrica izquierda", type: "columna", placement: "lateral_izquierdo", role: "soporte", colors: ["azul"], productId: GOLD_REFLEX_ID }), visual_semantics: { structure_type: "columna", placement: "lateral_izquierdo", design_role: "soporte", repetition_group: "EST_02_COLUMNA", density: "media", dimensions_m: { height: 1.8 } } },
  ] as SceneSpec["elements"]);
  const mixed = compileProductPrompt({
    sceneSpec: mixedSpec,
    visualContext: context,
    vocabulary: PRODUCT_VOCABULARY,
    trigger: "eventdecor_style_v2",
    officialStructures: new Map([["EST_01_SEMIARCO", "semiarco_asimetrico"], ["EST_02_COLUMNA", "columna_asimetrica"]]),
  });
  assert.match(mixed.prompt, /taller asymmetrical one-sided curved organic balloon garland .* on the right/);
  assert.match(mixed.prompt, /shorter asymmetrical organic balloon column .* on the left/);
  assert.match(mixed.prompt, /the garland and the column stand apart with an open gap between them/);
  assert.doesNotMatch(mixed.prompt, /matching one another|flanking/);
  assert.ok(mixed.prompt.length <= 750, `${mixed.prompt.length} chars`);
  const mixedReport = preflightLoraPrompt({ sceneSpec: mixedSpec, clauses: mixed.clauses, prompt: mixed.prompt, triggers: ["eventdecor_style_v2"], vocabulary: PRODUCT_VOCABULARY });
  assert.equal(mixedReport.ok, true, mixedReport.errors.join("; "));
  pass("a half-arch and a column on opposite sides stay two separate pieces with relative heights");

  // Regression (tropical plan, 2026-09-14): a non-balloon product label was
  // glued to the structure noun ("a balloon sculpture figure metallized foil
  // pennant garland ..."), and a half-arch "against the rear wall" was drawn
  // as a full arch.
  const pennantLabel = "metallized foil pennant garland with printed tropical-leaf pattern";
  const tropicalSpec = scene([
    element({ id: "EST_01_SEMIARCO", name: "Semiarco asimétrico tropical", type: "semiarco", placement: "fondo_pared", role: "focal", colors: ["fucsia"], productId: "P-FUCSIA" }),
    element({ id: "EST_04_BANDEROLA", name: "Banderola tropical", type: "accesorio", placement: "entrada", role: "acento", colors: ["verde"], productId: "P-PENNANT" }),
    element({ id: "EST_05_FIGURA", name: "Figura con globos", type: "kit", placement: "entrada", role: "acento", colors: ["verde"], productId: "P-PENNANT-2" }),
  ]);
  const tropical = compileLoraCaption({
    sceneSpec: tropicalSpec,
    visualContext: context,
    dialect: "scene_v004",
    officialStructures: new Map([["EST_01_SEMIARCO", "semiarco_asimetrico"], ["EST_05_FIGURA", "figura"]]),
    productConcepts: [
      { elementId: "EST_01_SEMIARCO", conceptId: "balloon.fuchsia", canonicalLabel: "round latex balloon in fuchsia", sceneTerms: { descriptor: "matte fuchsia", noun: "balloons" } },
      { elementId: "EST_04_BANDEROLA", conceptId: "banner.pennant.tropical", canonicalLabel: pennantLabel },
      { elementId: "EST_05_FIGURA", conceptId: "banner.pennant.tropical", canonicalLabel: pennantLabel },
    ],
  });
  assert.match(tropical.prompt, /one-sided curved organic balloon garland of matte fuchsia balloons at one side of the rear wall/);
  assert.match(tropical.prompt, /with a metallized foil pennant garland with printed tropical-leaf pattern(?: \(green tones\))? framing the entrance doorway/, tropical.prompt);
  assert.match(tropical.prompt, /a balloon sculpture figure with metallized foil pennant garland/, tropical.prompt);
  assert.doesNotMatch(tropical.prompt, /figure metallized|decoration kit metallized/, tropical.prompt);
  assert.ok(tropical.prompt.length <= LORA_PROMPT_MAX_LENGTH, `${tropical.prompt.length}`);
  pass("non-balloon products are named as the piece, balloon structures say what they carry, and a half-arch stays one-sided");

  const blueprint = {
    schema_version: "2.0",
    source_images: [{ image_id: "REF_01", approved_roles: ["composition_reference"] }],
    elements: [
      ["REF_01_E01", "tall half-arch", "balloon_structure", 0.9, true],
      ["REF_01_E02", "warm fairy string lights", "lighting", 0.85, true],
      ["REF_01_E03", "tropical palm leaves", "floral", 0.7, true],
      ["REF_01_E04", "paper bag with printed text", "other", 0.9, true],
      ["REF_01_E05", "wall outlet", "other", 0.9, false],
      ["REF_01_E06", "faint candle", "tableware", 0.4, true],
      ["REF_01_E07", "hojas de palma", "floral", 0.9, true],
    ].map(([id, name, category, confidence, approved]) => ({
      element_id: id, source_image_id: "REF_01", name, category, scene_role: "midground", detection_confidence: confidence,
      visible_evidence: "visible", reference_bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, depth_layer: 2,
      include_policy: approved ? "include" : "exclude", approved, source_type: "reference_only", quantity: { mode: "approximate", min: 1, max: 1 },
      appearance: { observed_colors: ["white"], resolved_colors: [], color_policy: "adapt_to_event_palette", material: "m", shape: "s", composition: "c" },
      relationships: [], uncertainties: [],
    })),
    composition: { focal_point: "arch", density: "dense", symmetry: "asymmetric", negative_space: [] },
    palette: { observed: [], priority: [] },
    unresolved_decisions: [],
  };
  const decor = ambientDecorFromReference(ReferenceBlueprintV2Schema.parse(blueprint), new Set(["REF_01_E01"]));
  assert.deepEqual(decor, ["warm fairy string lights", "tropical palm leaves"], "only relevant, confident, text-free English styling that no structure materializes");
  // Regression (C1): parenthetical details used to discard the whole element,
  // and plural signage ("signs") slipped past the text filter.
  assert.equal(ambientDecorName("Tropical leaves (monstera, palm)"), "tropical leaves");
  assert.equal(ambientDecorName("a white faux fur rug"), "white faux fur rug");
  assert.equal(ambientDecorName("kraft paper bags with plants and signs"), undefined);
  assert.equal(ambientDecorName("small wooden signs"), undefined);
  assert.equal(ambientDecorName("hojas tropicales (monstera)"), undefined);
  assert.equal(ambientDecorName("Main Right Organic Half-Arch Balloon Structure"), undefined, "a misfiled balloon structure is never drawn as ambient styling");
  pass("non-catalog styling is selected only when relevant to the composition");

  const styled = compileProductPrompt({ sceneSpec: pairSpec, visualContext: context, vocabulary: PRODUCT_VOCABULARY, trigger: "eventdecor_style_v2", ambientDecor: decor });
  assert.match(styled.prompt, /, styled with warm fairy string lights and tropical palm leaves\./);
  assert.equal(styled.resolved_concepts.length, pair.resolved_concepts.length, "styling never adds products");
  pass("styling is rendered in the prompt without becoming a product or structure");

  const json = JSON.parse(styled.jsonPrompt) as { subjects: Array<{ description: string }>; styling?: string[]; color_palette: string[]; scene: string };
  assert.equal(json.subjects.length, 2);
  assert.deepEqual(json.styling, decor);
  assert.ok(json.color_palette.includes("blue"));
  const jsonPrompt = `eventdecor_style_v2, ${styled.jsonPrompt}`;
  const jsonReport = preflightLoraPrompt({ sceneSpec: pairSpec, clauses: styled.clauses, prompt: jsonPrompt, triggers: ["eventdecor_style_v2"], vocabulary: PRODUCT_VOCABULARY, maxLength: LORA_JSON_PROMPT_MAX_LENGTH });
  assert.equal(jsonReport.ok, true, jsonReport.errors.join("; "));
  pass("the JSON prompt carries the same subjects, colors and styling and passes the same preflight");

  // Product decision (2026-09-14): JSON by default only for eventdecor_style_v2;
  // every other trigger keeps text; an explicit choice always wins.
  assert.equal(resolveLoraPromptFormat(undefined, "eventdecor_style_v2"), "json");
  assert.equal(resolveLoraPromptFormat(null, "eventdecor_style_v2"), "json");
  assert.equal(resolveLoraPromptFormat(undefined, "eventdecor_style_v3"), "texto");
  assert.equal(resolveLoraPromptFormat(undefined, "eventdecor_structure_v1"), "texto");
  assert.equal(resolveLoraPromptFormat(undefined, undefined), "texto", "no resolved LoRA keeps text");
  assert.equal(resolveLoraPromptFormat("texto", "eventdecor_style_v2"), "texto", "explicit text wins over the style_v2 default");
  assert.equal(resolveLoraPromptFormat("ambos", "eventdecor_style_v2"), "ambos");
  assert.equal(resolveLoraPromptFormat("json", "eventdecor_style_v3"), "json", "explicit json wins on any trigger");
  assert.throws(() => resolveLoraPromptFormat("yaml", "eventdecor_style_v2"), "an unknown prompt format is a client error");
  assert.throws(() => resolveLoraPromptFormat("", "eventdecor_style_v3"), "an empty prompt format is not an omission");
  pass("prompt format defaults by trigger (style_v2 json, others texto), explicit wins, unknown values are rejected");
}

console.log(`\nAll ${passCount} assertions passed.`);
