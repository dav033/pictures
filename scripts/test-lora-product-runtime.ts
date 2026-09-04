/**
 * Subagent G deliverable â€” runtime prompt integration and prompt-contract
 * tests.
 *
 * Run: npx tsx scripts/test-lora-product-runtime.ts
 *
 * No network access. No paid calls. Pure in-process assertions against
 * src/lib/ia/lora-product-runtime.ts, src/lib/ia/lora-caption-compiler.ts,
 * and src/lib/ia/lora-prompt-preflight.ts.
 */
import assert from "node:assert/strict";
import type { SceneSpec } from "../src/lib/ia/scene-spec";
import { compileLoraCaption } from "../src/lib/ia/lora-caption-compiler";
import { compileProductPrompt, type ElementSizeConfirmation } from "../src/lib/ia/lora-product-runtime";
import { findLoraPromptProductLeaks, preflightLoraPrompt } from "../src/lib/ia/lora-prompt-preflight";
import { buildVisualContext } from "../src/lib/ia/visual-context";
import { PRODUCT_VOCABULARY } from "../src/lib/lora/product-vocabulary-data";
import { VOCABULARY_VERSION, type ProductVocabulary } from "../src/lib/lora/product-vocabulary";

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

const context = buildVisualContext({ userRequest: "cumpleaÃ±os en salÃ³n" });

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
  assert.ok(result.prompt.includes(concept.canonical_label), "prompt must contain the exact canonical_label string");
  pass("canonical_label appears exactly in the rendered prompt");

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
  const occurrences = result.prompt.split(concept.canonical_label).length - 1;
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
  // confirm the detector actually fires â€” proving it is not a no-op.
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
//    latex vs foil â€” all distinguishable in the rendered text.
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
  assert.match(goldResult.prompt, /\bReflex\b/, "Reflex must remain a literal word, never reduced to generic 'glossy'");
  assert.match(roseGoldResult.prompt, /\bReflex\b/);
  assert.doesNotMatch(goldResult.prompt, /\bglossy\b/i, "Reflex canonical rendering must not fall back to the legacy 'glossy' translation");
  assert.match(goldResult.prompt, /\bgold\b/i);
  assert.doesNotMatch(goldResult.prompt, /rose gold/i, "plain gold must not collapse into rose gold");
  assert.match(roseGoldResult.prompt, /rose gold/i);
  assert.notEqual(goldResult.prompt, roseGoldResult.prompt);
  pass("Reflex is preserved literally; gold and rose gold render distinct, non-colliding text");

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
  const spec = scene([element({ id: "ARCH", name: "Arco OrgÃ¡nico", type: "arco", placement: "arco_central", role: "focal", colors: ["rosado"] })]);

  const noVocabResult = compileProductPrompt({ sceneSpec: spec, visualContext: context });
  assert.equal(noVocabResult.legacy, true);
  assert.ok(noVocabResult.legacyReason && noVocabResult.legacyReason.length > 0);
  assert.ok(noVocabResult.diagnostics.some((line) => line.includes("legacy fallback")));
  assert.deepEqual(noVocabResult.resolved_concepts, []);
  pass("omitting the vocabulary produces an explicit legacy=true result with a non-empty diagnostic, never a silent claim of canonical fidelity");

  const emptyVocabResult = compileProductPrompt({ sceneSpec: spec, visualContext: context, vocabulary: [] });
  assert.equal(emptyVocabResult.legacy, true);
  pass("an empty vocabulary array is also treated as an explicit legacy fallback");

  const noCatalogBackedSpec = scene([element({ id: "ARCH", name: "Arco OrgÃ¡nico", type: "arco", placement: "arco_central", role: "focal", colors: ["rosado"] })]);
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
  assert.match(result.prompt, /round latex balloon in rose gold with a Reflex high-shine finish/);
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
  assert.ok(result.prompt.includes("round latex balloon in cream pearl with a Silk satin finish"));
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
    assert.match(result.prompt, new RegExp(testCase.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  pass("Pastel Dusk pink, Silk spring pink, and Infinity Interrogacion black variants resolve from v007 evidence");
}

console.log(`\nAll ${passCount} assertions passed.`);
