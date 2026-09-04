import type { SceneElement, SceneSpec } from "./scene-spec";
import type { VisualContext } from "./visual-context";
import {
  compileLoraCaption,
  type LoraVisualClause,
  type ProductConceptClauseInput,
} from "./lora-caption-compiler";
import {
  buildLookupIndexes,
  resolveProductConcept,
  VOCABULARY_VERSION,
  type ProductVocabulary,
} from "@/lib/lora/product-vocabulary";
import { aDescriptorPerceptual } from "@/lib/lora/descriptor-perceptual";

/**
 * Subagent G deliverable â€” runtime prompt integration.
 *
 * Design gate: docs/decisions/product-vocabulary-v001.md
 * Spec: writing-block.md Â§11 ("Runtime prompt integration")
 *
 * This module is the ONLY place that turns a SceneSpec's `catalog_product_id`
 * / `catalog_product_ids` into resolved canonical product concepts for the
 * production LoRA prompt. It never redefines structure, placement, or
 * bilateral relationships (owned by lora-caption-compiler.ts / lora-semantics.ts)
 * and never sends a `concept_id` to the image model â€” only the frozen
 * `canonical_label` text, via lora-caption-compiler's `productConcepts` input.
 */
export const LORA_PRODUCT_RUNTIME_VERSION = "lora-product-runtime.v1" as const;

export type UnresolvedProductReason = "unknown" | "ambiguous" | "invalid";

export type UnresolvedProduct = {
  product_id?: string;
  title?: string;
  reason: UnresolvedProductReason;
};

/**
 * Runtime prompt integration contract, per writing-block.md Â§11.
 */
export type ProductPromptCompilation = {
  prompt: string;
  resolved_concepts: string[];
  unresolved_products: UnresolvedProduct[];
  vocabulary_version: string;
  compiler_version: string;
};

/**
 * A physical size confirmed for one product on one scene element (e.g. from
 * order breakdown quantities). Sizes are never inferred; only sizes passed
 * here â€” and validated against the resolved concept's `allowed_codes` â€” can
 * appear in the rendered prompt.
 */
export type ElementSizeConfirmation = {
  elementId: string;
  productId: string;
  sizeCode: string;
  /** Physical diameter from the catalog, rendered as `N-inch` for v007. */
  diameterInches?: number;
};

/**
 * Superset of `ProductPromptCompilation` with explicit legacy diagnostics.
 * `legacy` MUST be checked by any caller that needs to claim canonical
 * fidelity (training export / dataset packaging / admin validation per
 * writing-block.md Â§11) â€” a `legacy: true` result must never be presented as
 * canonical, even though `prompt` is always populated so production
 * generation is never silently blocked.
 */
export type ProductPromptRuntimeResult = ProductPromptCompilation & {
  legacy: boolean;
  legacyReason?: string;
  captionCompilerVersion: string;
  clauses: LoraVisualClause[];
  diagnostics: string[];
};

function elementProductIds(element: SceneElement): string[] {
  if (element.source_type !== "catalog_backed") return [];
  const ids = element.catalog_product_ids?.length ? element.catalog_product_ids : element.catalog_product_id ? [element.catalog_product_id] : [];
  return [...new Set(ids)];
}

type ElementResolution = {
  entries: ProductConceptClauseInput[];
  unresolved: UnresolvedProduct[];
  resolvedConceptIds: string[];
  diagnostics: string[];
};

/**
 * Resolves every product id declared on one element. Returns entries ONLY
 * when every declared product id for that element resolved successfully â€”
 * a partial match (one resolved material + one unknown material on the same
 * multi-material element) is never rendered as a canonical phrase, since
 * doing so would silently drop the unresolved material from the prompt
 * while still claiming product fidelity for that element.
 */
function resolveElement(
  element: SceneElement,
  vocabulary: ProductVocabulary,
  indexes: ReturnType<typeof buildLookupIndexes>,
  sizesByProductId: Map<string, ElementSizeConfirmation[]>,
  productIdAliases: ReadonlyMap<string, string | readonly string[]>,
): ElementResolution {
  const productIds = elementProductIds(element);
  const entries: ProductConceptClauseInput[] = [];
  const unresolved: UnresolvedProduct[] = [];
  const resolvedConceptIds: string[] = [];
  const diagnostics: string[] = [];

  for (const productId of productIds) {
    if (!productId.trim()) {
      unresolved.push({ product_id: productId, reason: "invalid" });
      continue;
    }
    const directResult = resolveProductConcept({ productId }, vocabulary, indexes);
    // The scene spec keeps the selected Shopify variant id for traceability,
    // while the vocabulary is keyed by canonical SKU or parent product/family
    // id. Resolve aliases only when the exact id is unknown; ambiguity must
    // remain a hard failure and must never be hidden by an alias.
    const aliasValue = productIdAliases.get(productId);
    const aliasIds = aliasValue === undefined ? [] : Array.isArray(aliasValue) ? aliasValue : [aliasValue];
    let result = directResult;
    for (const aliasId of aliasIds) {
      if (result.status !== "unknown" || aliasId === productId) break;
      result = resolveProductConcept({ productId: aliasId }, vocabulary, indexes);
    }
    if (result.status === "resolved") {
      resolvedConceptIds.push(result.concept.concept_id);
      const rawSizes = sizesByProductId.get(productId) ?? [];
      const allowed = new Set(result.concept.sizes.allowed_codes);
      const confirmedSizes = rawSizes
        .filter(({ sizeCode }) => allowed.has(sizeCode))
        .map(({ sizeCode, diameterInches }) => renderSize(diameterInches ?? diameterFromSizeCode(sizeCode), sizeCode));
      const invalidSizes = rawSizes.filter(({ sizeCode }) => !allowed.has(sizeCode)).map(({ sizeCode }) => sizeCode);
      if (invalidSizes.length) {
        diagnostics.push(
          `element ${element.element_id}: size(s) ${invalidSizes.join(", ")} are not in allowed_codes for ${result.concept.concept_id}; omitted from the prompt (size remains separate from concept identity, never silently accepted)`,
        );
      }
      entries.push({
        elementId: element.element_id,
        conceptId: result.concept.concept_id,
        canonicalLabel: aDescriptorPerceptual(result.concept.canonical_label),
        sizeCodes: confirmedSizes.length ? confirmedSizes : undefined,
      });
    } else if (result.status === "ambiguous") {
      unresolved.push({ product_id: productId, reason: "ambiguous" });
    } else {
      unresolved.push({ product_id: productId, reason: "unknown" });
    }
  }

  if (productIds.length > 0 && entries.length !== productIds.length) {
    // Partial resolution: keep every unresolved entry visible in diagnostics
    // but discard the resolved entries so this element falls back to the
    // legacy color/finish rendering as a whole, never a mixed half-canonical
    // half-generic phrase.
    if (entries.length > 0) {
      diagnostics.push(
        `element ${element.element_id}: only ${entries.length}/${productIds.length} declared product id(s) resolved; falling back to legacy rendering for this element rather than a partial canonical phrase`,
      );
    }
    return { entries: [], unresolved, resolvedConceptIds: [], diagnostics };
  }

  return { entries, unresolved, resolvedConceptIds, diagnostics };
}

function diameterFromSizeCode(sizeCode: string): number | undefined {
  const match = sizeCode.match(/(?:^|[-_\s])(\d+(?:\.\d+)?)\s*(?:inch|inches|in)?$/i);
  const diameter = match ? Number(match[1]) : Number.NaN;
  return Number.isFinite(diameter) && diameter > 0 ? diameter : undefined;
}

function renderSize(diameterInches: number | undefined, fallback: string): string {
  if (diameterInches === undefined) return fallback;
  const normalized = Number.isInteger(diameterInches) ? String(diameterInches) : String(Number(diameterInches.toFixed(2)));
  return `${normalized}-inch`;
}

/**
 * Compiles the production LoRA prompt with canonical product concepts
 * resolved from `vocabulary`, when available. Falls back to the legacy
 * generic color/finish compiler â€” explicitly, never silently â€” when no
 * vocabulary is supplied, when the vocabulary has no active concepts, or
 * when no catalog-backed element resolves a concept. Structure, placement,
 * and bilateral relationships are always produced by
 * `lora-caption-compiler.ts` unchanged; this function only supplies it with
 * already-resolved canonical labels per element.
 */
export function compileProductPrompt(input: {
  sceneSpec: SceneSpec;
  visualContext: VisualContext;
  vocabulary?: ProductVocabulary;
  sizeConfirmations?: ElementSizeConfirmation[];
  /** Maps selected Shopify variant ids to exact canonical SKU/family ids. */
  productIdAliases?: ReadonlyMap<string, string | readonly string[]>;
}): ProductPromptRuntimeResult {
  const vocabulary = input.vocabulary ?? [];
  const activeConcept = vocabulary.find((concept) => concept.status === "active");

  if (!activeConcept) {
    const legacy = compileLoraCaption({ sceneSpec: input.sceneSpec, visualContext: input.visualContext });
    return {
      prompt: legacy.prompt,
      resolved_concepts: [],
      unresolved_products: [],
      vocabulary_version: VOCABULARY_VERSION,
      compiler_version: LORA_PRODUCT_RUNTIME_VERSION,
      legacy: true,
      legacyReason: input.vocabulary ? "supplied vocabulary has no active concepts" : "no vocabulary supplied to the runtime compiler",
      captionCompilerVersion: legacy.compilerVersion,
      clauses: legacy.clauses,
      diagnostics: [
        "legacy fallback: canonical product vocabulary unavailable for this request; colors/finishes rendered generically, no product identity claimed",
      ],
    };
  }

  const indexes = buildLookupIndexes(vocabulary);
  const sizesByProductId = new Map<string, ElementSizeConfirmation[]>();
  for (const confirmation of input.sizeConfirmations ?? []) {
    const list = sizesByProductId.get(confirmation.productId) ?? [];
    list.push(confirmation);
    sizesByProductId.set(confirmation.productId, list);
  }

  const unresolved: UnresolvedProduct[] = [];
  const resolvedConceptIds = new Set<string>();
  const diagnostics: string[] = [];
  const productConcepts: ProductConceptClauseInput[] = [];

  for (const element of input.sceneSpec.elements) {
    const resolution = resolveElement(
      element,
      vocabulary,
      indexes,
      sizesByProductId,
      input.productIdAliases ?? new Map<string, string>(),
    );
    unresolved.push(...resolution.unresolved);
    diagnostics.push(...resolution.diagnostics);
    for (const conceptId of resolution.resolvedConceptIds) resolvedConceptIds.add(conceptId);
    productConcepts.push(...resolution.entries);
  }

  const compilation = compileLoraCaption({
    sceneSpec: input.sceneSpec,
    visualContext: input.visualContext,
    productConcepts,
  });

  const legacy = !compilation.usedProductVocabulary;
  if (legacy) {
    diagnostics.push(
      "legacy fallback: no catalog-backed element in this scene resolved a canonical concept; colors/finishes rendered generically, no product identity claimed",
    );
  }

  return {
    prompt: compilation.prompt,
    resolved_concepts: [...resolvedConceptIds].sort(),
    unresolved_products: unresolved,
    vocabulary_version: activeConcept.vocabulary_version,
    compiler_version: LORA_PRODUCT_RUNTIME_VERSION,
    legacy,
    legacyReason: legacy ? "no catalog-backed element resolved a canonical concept" : undefined,
    captionCompilerVersion: compilation.compilerVersion,
    clauses: compilation.clauses,
    diagnostics,
  };
}
