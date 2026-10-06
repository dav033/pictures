import type { SceneElement, SceneSpec } from "../escena/scene-spec";
import type { VisualContext } from "../escena/visual-context";
import {
  captionDialectForTrigger,
  compileLoraCaption,
  translateLoraColor,
  type LoraCaptionDialect,
  type LoraVisualClause,
  type ProductConceptClauseInput,
} from "./lora-caption-compiler";
import type { ProductConcept } from "@/lib/lora/product-vocabulary";
import {
  buildLookupIndexes,
  resolveProductConcept,
  VOCABULARY_VERSION,
  type ProductVocabulary,
} from "@/lib/lora/product-vocabulary";
import { aDescriptorPerceptual } from "@/lib/lora/descriptor-perceptual";
import { canonicalizeSku } from "@/lib/rag/catalog/canonicalize";
import { colorVisibleDelCatalogo, leerTituloCatalogo, terminosBaseDeConcepto, terminosBaseDeTitulo, type TerminosBase } from "@/lib/lora/vocabulario-base";
import type { FraseDeEstructura } from "../uzume/mezcla-color-escena";

/**
 * Subagent G deliverable — runtime prompt integration.
 *
 * Design gate: docs/decisions/product-vocabulary-v001.md
 * Spec: writing-block.md §11 ("Runtime prompt integration")
 *
 * This module is the ONLY place that turns a SceneSpec's `catalog_product_id`
 * / `catalog_product_ids` into resolved canonical product concepts for the
 * production LoRA prompt. It never redefines structure, placement, or
 * bilateral relationships (owned by lora-caption-compiler.ts / lora-semantics.ts)
 * and never sends a `concept_id` to the image model — only the frozen
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
 * Runtime prompt integration contract, per writing-block.md §11.
 */
/**
 * Una talla que el plan pidió y el prompt no puede nombrar porque el concepto
 * resuelto no la tiene en `allowed_codes` (fase 1.3).
 *
 * Existe como condición con nombre y no como cadena dentro de `diagnostics`
 * porque es lo único que distingue "la imagen no muestra el topper de 36" que
 * el cliente pidió" de "la imagen salió rara". Era la última capa capaz de
 * notarlo y la peor en la que fallar: `diagnostics` es texto libre que nadie
 * lee y que ningún consumidor puede comprobar.
 */
export type TallaOmitida = {
  element_id: string;
  concept_id: string;
  /** Códigos de talla del catálogo ("R-36"), tal como el plan los pidió. */
  size_codes: string[];
};

export type ProductPromptCompilation = {
  prompt: string;
  resolved_concepts: string[];
  unresolved_products: UnresolvedProduct[];
  /** Vacío cuando toda talla pedida cabe en el concepto. Nunca se omite el campo. */
  dropped_sizes: TallaOmitida[];
  vocabulary_version: string;
  compiler_version: string;
};

/**
 * A physical size confirmed for one product on one scene element (e.g. from
 * order breakdown quantities). Sizes are never inferred; only sizes passed
 * here — and validated against the resolved concept's `allowed_codes` — can
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
 * writing-block.md §11) — a `legacy: true` result must never be presented as
 * canonical, even though `prompt` is always populated so production
 * generation is never silently blocked.
 */
export type ProductPromptRuntimeResult = ProductPromptCompilation & {
  legacy: boolean;
  legacyReason?: string;
  captionCompilerVersion: string;
  clauses: LoraVisualClause[];
  /** Same scene as a structured JSON prompt; see `compileLoraCaption`. */
  jsonPrompt: string;
  diagnostics: string[];
};

/**
 * The ids a resolved product is also known by in the vocabulary (`productIdAliases` of `compileProductPrompt`):
 * its catalog SKU, **canonical** too, and its family product id. The vocabulary indexes canonical SKUs
 * ("20017228") and the catalog hands the original one ("B2B-20017228"), so a product whose title had no alias
 * (Fashion Coral Tropical) never resolved and the whole generation failed with LORA_PRODUCT_VOCABULARY_FAILED
 * (CASE-004, -007, -008; auditoría de propiedades huérfanas, 2026-10-06).
 */
export function aliasesDeProducto(producto: { id: string; catalogSku?: string; familiaId?: string }): string[] {
  const canonico = producto.catalogSku ? canonicalizeSku(producto.catalogSku) : undefined;
  return [...new Set([producto.catalogSku, canonico, producto.familiaId])].filter((id): id is string => Boolean(id && id !== producto.id));
}

/**
 * Builds size confirmations from the material estimate lines of an approved
 * scene. The exact selected variant owns the size; a family match is used
 * only when every candidate sibling shares one size code, so a line is never
 * labelled with the size of an arbitrary sibling variant.
 */
export function sizeConfirmationsFromMaterialLines(
  lines: ReadonlyArray<{ structure_id?: string; product_id?: string; variant_id?: string }>,
  products: ReadonlyArray<{ id: string; familiaId?: string; tamanoCodigo?: string; diamPulg?: number }>,
): ElementSizeConfirmation[] {
  return lines.flatMap((line) => {
    const elementId = line.structure_id;
    const selectedProductId = line.variant_id ?? line.product_id;
    if (!elementId || !selectedProductId) return [];
    const exact = products.find((candidate) => candidate.id === selectedProductId);
    const siblings = exact ? [] : products.filter((candidate) =>
      candidate.familiaId === line.product_id || candidate.familiaId === selectedProductId,
    );
    const product = exact ?? (new Set(siblings.map((candidate) => candidate.tamanoCodigo)).size === 1 ? siblings[0] : undefined);
    return product?.tamanoCodigo
      ? [{ elementId, productId: selectedProductId, sizeCode: product.tamanoCodigo, diameterInches: product.diamPulg }]
      : [];
  });
}

function elementProductIds(element: SceneElement): string[] {
  if (element.source_type !== "catalog_backed") return [];
  const ids = element.catalog_product_ids?.length ? element.catalog_product_ids : element.catalog_product_id ? [element.catalog_product_id] : [];
  return [...new Set(ids)];
}

type ElementResolution = {
  entries: ProductConceptClauseInput[];
  unresolved: UnresolvedProduct[];
  resolvedConceptIds: string[];
  droppedSizes: TallaOmitida[];
  diagnostics: string[];
};

/**
 * Resolves every product id declared on one element. Returns entries ONLY
 * when every declared product id for that element resolved successfully —
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
  productCatalogTitles: ReadonlyMap<string, string | readonly string[]>,
  dialect: LoraCaptionDialect,
  lineasEstimado: ReadonlyArray<{ structure_id?: string; product_id?: string; color: string | null; finish: string | null }> = [],
): ElementResolution {
  // Modo base: el color de cada globo sale de su referencia Sempertex (la que se compra, por el color y el
  // acabado de su línea del estimado), no de la palabra del vocabulario. Ver `colorDeReferencia`.
  const estructura = element.visual_semantics?.repetition_group ?? element.element_id.split("#")[0]!;
  const conColorDelCatalogo = (productId: string, terminos: TerminosBase | undefined): TerminosBase | undefined => {
    if (dialect !== "base" || !terminos || terminos.kind !== "balloon") return terminos;
    const linea = lineasEstimado.find((candidata) => candidata.product_id === productId && candidata.structure_id === estructura)
      ?? lineasEstimado.find((candidata) => candidata.product_id === productId);
    const color = colorVisibleDelCatalogo(linea?.color, linea?.finish);
    return color ? { ...terminos, color } : terminos;
  };
  const productIds = elementProductIds(element);
  const entries: ProductConceptClauseInput[] = [];
  const unresolved: UnresolvedProduct[] = [];
  const resolvedConceptIds: string[] = [];
  const diagnostics: string[] = [];
  const droppedSizes: TallaOmitida[] = [];

  for (const productId of productIds) {
    if (!productId.trim()) {
      if (dialect !== "base") unresolved.push({ product_id: productId, reason: "invalid" });
      continue;
    }
    if (dialect === "base") {
      // FLUX base, sin LoRA (2026-10-06, decisión del dueño): el vocabulario de productos del LoRA no decide
      // nada. Cada producto se describe con datos del catálogo —su título y el color y acabado de su referencia
      // Sempertex (`conColorDelCatalogo`)—; uno que el catálogo no permite describir se omite del texto y
      // queda en el diagnóstico, nunca bloquea la imagen ni arrastra a los demás de la pieza.
      const catalogTitleValue = productCatalogTitles.get(productId);
      const catalogTitles = catalogTitleValue === undefined ? [] : Array.isArray(catalogTitleValue) ? catalogTitleValue : [catalogTitleValue];
      const fromCatalog = baseEntryFromCatalog(element, productId, catalogTitles, sizesByProductId);
      if (fromCatalog) entries.push({ ...fromCatalog, baseTerms: conColorDelCatalogo(productId, fromCatalog.baseTerms) });
      else diagnostics.push(`element ${element.element_id}: product ${productId} has no catalog title the base model can describe; left out of the caption`);
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
    // A Shopify variant can be absent from the vocabulary while its trusted
    // parent title is present in catalog_titles. This is an exact title
    // lookup, never fuzzy matching and never a model-generated identity.
    const catalogTitleValue = productCatalogTitles.get(productId);
    const catalogTitles = catalogTitleValue === undefined
      ? []
      : Array.isArray(catalogTitleValue)
        ? catalogTitleValue
        : [catalogTitleValue];
    for (const catalogTitle of catalogTitles) {
      if (result.status !== "unknown" || !catalogTitle.trim()) break;
      result = resolveProductConcept({ text: catalogTitle }, vocabulary, indexes);
    }
    if (result.status === "resolved") {
      resolvedConceptIds.push(result.concept.concept_id);
      // Sizes are confirmed per structure: a product used at R-24 in the arch
      // must not add 24-inch to the columns that use it at R-12. Plan lines
      // carry the structure id, repeated instances are `<structure>#<n>`.
      const rawSizes = (sizesByProductId.get(productId) ?? []).filter(({ elementId }) =>
        elementId === element.element_id || element.element_id.startsWith(`${elementId}#`),
      );
      const allowed = new Set(result.concept.sizes.allowed_codes);
      const confirmedSizes = rawSizes
        .filter(({ sizeCode }) => allowed.has(sizeCode))
        .map(({ sizeCode, diameterInches }) => renderSize(diameterInches ?? diameterFromSizeCode(sizeCode), sizeCode));
      const invalidSizes = rawSizes.filter(({ sizeCode }) => !allowed.has(sizeCode)).map(({ sizeCode }) => sizeCode);
      if (invalidSizes.length) {
        droppedSizes.push({ element_id: element.element_id, concept_id: result.concept.concept_id, size_codes: [...new Set(invalidSizes)] });
        diagnostics.push(
          `element ${element.element_id}: size(s) ${invalidSizes.join(", ")} are not in allowed_codes for ${result.concept.concept_id}; omitted from the prompt (size remains separate from concept identity, never silently accepted)`,
        );
      }
      entries.push({
        elementId: element.element_id,
        conceptId: result.concept.concept_id,
        canonicalLabel: aDescriptorPerceptual(result.concept.canonical_label),
        sizeCodes: confirmedSizes.length ? confirmedSizes : undefined,
        colorName: referenceColorName(result.concept.visual.color),
        sceneTerms: sceneTermsFor(result.concept),
      });
    } else if (result.status === "ambiguous") {
      unresolved.push({ product_id: productId, reason: "ambiguous" });
    } else {
      // Los dialectos entrenados solo conocen su corpus: un producto fuera del vocabulario no se describe. El
      // modelo base ya salió arriba, descrito desde el catálogo.
      unresolved.push({ product_id: productId, reason: "unknown" });
    }
  }

  if (dialect !== "base" && productIds.length > 0 && entries.length !== productIds.length) {
    // Partial resolution: keep every unresolved entry visible in diagnostics
    // but discard the resolved entries so this element falls back to the
    // legacy color/finish rendering as a whole, never a mixed half-canonical
    // half-generic phrase.
    if (entries.length > 0) {
      diagnostics.push(
        `element ${element.element_id}: only ${entries.length}/${productIds.length} declared product id(s) resolved; falling back to legacy rendering for this element rather than a partial canonical phrase`,
      );
    }
    // La talla omitida sobrevive al descarte del elemento: el cliente pidió ese
    // diámetro igual, y que el elemento caiga a render legacy no lo devuelve.
    return { entries: [], unresolved, resolvedConceptIds: [], droppedSizes, diagnostics };
  }

  return { entries, unresolved, resolvedConceptIds, droppedSizes, diagnostics };
}

/**
 * Base-dialect entry for a product without a vocabulary concept, built only
 * from catalog facts: its exact catalog title (shape, material, finish
 * family, color words), the element's own catalog color when the element has
 * this single product, and its confirmed sizes. Undefined when the title is
 * not a balloon or names no color the catalog can confirm.
 */
function baseEntryFromCatalog(
  element: SceneElement,
  productId: string,
  catalogTitles: readonly string[],
  sizesByProductId: Map<string, ElementSizeConfirmation[]>,
): ProductConceptClauseInput | undefined {
  const singleProduct = elementProductIds(element).length === 1;
  for (const title of catalogTitles) {
    const read = leerTituloCatalogo(title);
    if (!read) continue;
    const titleColor = read.restoColor ? translateLoraColor(read.restoColor) : "";
    const color = titleColor && titleColor !== read.restoColor ? titleColor
      : singleProduct ? element.resolved_colors.map(translateLoraColor).join(" and ") : "";
    const terms = terminosBaseDeTitulo(read, color);
    if (!terms || terms.kind !== "balloon") continue;
    const sizes = (sizesByProductId.get(productId) ?? [])
      .filter(({ elementId }) => elementId === element.element_id || element.element_id.startsWith(`${elementId}#`))
      .map(({ sizeCode, diameterInches }) => renderSize(diameterInches ?? diameterFromSizeCode(sizeCode), sizeCode));
    return {
      elementId: element.element_id,
      // Grouping key only; never rendered (the caption only reads `baseTerms`).
      conceptId: `catalog:${productId}`,
      canonicalLabel: `${terms.finish} ${terms.color} ${terms.noun}`.trim(),
      sizeCodes: sizes.length ? [...new Set(sizes)] : undefined,
      colorName: terms.color,
      baseTerms: terms,
    };
  }
  return undefined;
}

/**
 * The product in the wording of the v004 scene captions ("glossy chrome gold"
 * + "balloons"). Only solid, single-color balloons are expressed this way;
 * printed, assorted and non-balloon products keep their canonical label.
 */
function sceneTermsFor(concept: ProductConcept): { descriptor: string; noun: string } | undefined {
  const { shape, material, color, finish, pattern } = concept.visual;
  const colorName = referenceColorName(color);
  if (!colorName || /\b(?:assorted|and)\b/i.test(colorName) || pattern.kind.trim().toLowerCase() !== "solid") return undefined;
  const nounByShape: Record<string, string> = {
    round: "balloons",
    modeling: "twisting balloons",
    heart: "heart balloons",
    star: "star balloons",
    number: "number balloons",
    link: "link balloons",
    "link-o-loon": "link balloons",
  };
  const noun = nounByShape[shape.trim().toLowerCase()];
  if (!noun) return undefined;
  const materialKey = material.trim().toLowerCase();
  if (materialKey.includes("foil")) return { descriptor: `metallic foil ${colorName}`, noun };
  if (!materialKey.includes("latex")) return undefined;
  const finishKey = finish.trim().toLowerCase();
  const finishWord = /reflex|chrome/.test(finishKey) ? "glossy chrome"
    : /pastel dusk/.test(finishKey) ? "muted matte"
      : /pastel/.test(finishKey) ? "pastel matte"
        : /silk|satin|pearl/.test(finishKey) ? "pearl"
          : /crystal|translucent/.test(finishKey) ? "clear"
            : /neon/.test(finishKey) ? "neon"
              : /metal/.test(finishKey) ? "metallic"
                : /fashion|matte/.test(finishKey) ? "matte"
                  : undefined;
  if (!finishWord) return undefined;
  return { descriptor: `${finishWord} ${colorName}`, noun };
}

/** Observable color used to refer back to an already-described concept; none for unspecified colors. */
function referenceColorName(color: string): string | undefined {
  const value = aDescriptorPerceptual(color.trim());
  return value && !/^unspecified$/i.test(value) ? value : undefined;
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
 * generic color/finish compiler — explicitly, never silently — when no
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
  /** Maps selected ids to factual Shopify parent titles for exact vocabulary lookup. */
  productCatalogTitles?: ReadonlyMap<string, string | readonly string[]>;
  /** Resolved LoRA trigger that `ensureLoraTriggers` will write; counts against the prompt budget. */
  trigger?: string;
  /** Smaller caption budget for callers that append a fixed instruction later. */
  maxLength?: number;
  /** Relevant non-catalog styling from the reference; rendered only, never resolved or quoted. */
  ambientDecor?: readonly string[];
  /** `estructura_oficial` per plan `estructura_id`. */
  officialStructures?: ReadonlyMap<string, string>;
  /** Styling cues of the creativity level (creatividad.ts); rendered only, dropped first when compacting. */
  creativeCues?: readonly string[];
  /** `plan_resuelto.patrones_color` and `armados_bouquet`, passed through untouched: the compiler inserts each applied `prompt_lora` verbatim (ADR-0028 §12, ADR-0030). */
  colorPatterns?: readonly FraseDeEstructura[];
}): ProductPromptRuntimeResult {
  // En el modelo base (sin trigger) el vocabulario no se consulta: ver `resolveElement`.
  const esBase = captionDialectForTrigger(input.trigger) === "base";
  const vocabulary = esBase ? [] : input.vocabulary ?? [];
  const activeConcept = vocabulary.find((concept) => concept.status === "active");

  if (!activeConcept && !esBase) {
    const legacy = compileLoraCaption({ sceneSpec: input.sceneSpec, visualContext: input.visualContext, trigger: input.trigger, maxLength: input.maxLength, dialect: captionDialectForTrigger(input.trigger), ambientDecor: input.ambientDecor, officialStructures: input.officialStructures, creativeCues: input.creativeCues, colorPatterns: input.colorPatterns });
    return {
      prompt: legacy.prompt,
      resolved_concepts: [],
      unresolved_products: [],
      // Sin vocabulario activo nada se resuelve contra `allowed_codes`, así que
      // no hay talla que se pueda haber caído por ese motivo.
      dropped_sizes: [],
      vocabulary_version: VOCABULARY_VERSION,
      compiler_version: LORA_PRODUCT_RUNTIME_VERSION,
      legacy: true,
      legacyReason: input.vocabulary ? "supplied vocabulary has no active concepts" : "no vocabulary supplied to the runtime compiler",
      captionCompilerVersion: legacy.compilerVersion,
      clauses: legacy.clauses,
      jsonPrompt: legacy.jsonPrompt,
      diagnostics: [
        "legacy fallback: canonical product vocabulary unavailable for this request; colors/finishes rendered generically, no product identity claimed",
      ],
    };
  }

  const indexes = buildLookupIndexes(vocabulary);
  // The resolved LoRA decides the wording: each LoRA follows its own captions.
  // No trigger is the base model (`base`).
  const dialect = captionDialectForTrigger(input.trigger);
  const sizesByProductId = new Map<string, ElementSizeConfirmation[]>();
  for (const confirmation of input.sizeConfirmations ?? []) {
    const list = sizesByProductId.get(confirmation.productId) ?? [];
    list.push(confirmation);
    sizesByProductId.set(confirmation.productId, list);
  }

  const unresolved: UnresolvedProduct[] = [];
  const resolvedConceptIds = new Set<string>();
  const droppedSizes: TallaOmitida[] = [];
  const diagnostics: string[] = [];
  const productConcepts: ProductConceptClauseInput[] = [];

  for (const element of input.sceneSpec.elements) {
    const resolution = resolveElement(
      element,
      vocabulary,
      indexes,
      sizesByProductId,
      input.productIdAliases ?? new Map<string, string>(),
      input.productCatalogTitles ?? new Map<string, string>(),
      dialect,
      input.sceneSpec.material_estimate?.balloons ?? [],
    );
    unresolved.push(...resolution.unresolved);
    droppedSizes.push(...resolution.droppedSizes);
    diagnostics.push(...resolution.diagnostics);
    for (const conceptId of resolution.resolvedConceptIds) resolvedConceptIds.add(conceptId);
    productConcepts.push(...resolution.entries);
  }

  const compilation = compileLoraCaption({
    sceneSpec: input.sceneSpec,
    visualContext: input.visualContext,
    productConcepts,
    trigger: input.trigger,
    maxLength: input.maxLength,
    dialect,
    ambientDecor: input.ambientDecor,
    officialStructures: input.officialStructures,
    creativeCues: input.creativeCues,
    colorPatterns: input.colorPatterns,
  });
  if (compilation.compactionStep > 0) {
    diagnostics.push(`prompt compacted to render step ${compilation.compactionStep} to fit the LoRA prompt budget; every structure, placement, relation and color is kept`);
  }

  // En los dialectos entrenados, una entrada descrita por su título no es un concepto del vocabulario: sin al
  // menos uno real el resultado es legacy. En el base no hay vocabulario: legacy solo si ningún producto se
  // pudo describir desde el catálogo.
  const legacy = esBase
    ? productConcepts.length === 0 || !compilation.usedProductVocabulary
    : !compilation.usedProductVocabulary || resolvedConceptIds.size === 0;
  if (legacy) {
    diagnostics.push(
      "legacy fallback: no catalog-backed element in this scene resolved a canonical concept; colors/finishes rendered generically, no product identity claimed",
    );
  }

  return {
    prompt: compilation.prompt,
    resolved_concepts: [...resolvedConceptIds].sort(),
    unresolved_products: unresolved,
    dropped_sizes: droppedSizes,
    vocabulary_version: activeConcept?.vocabulary_version ?? VOCABULARY_VERSION,
    compiler_version: LORA_PRODUCT_RUNTIME_VERSION,
    legacy,
    legacyReason: legacy ? (esBase ? "no product could be described from its catalog title" : "no catalog-backed element resolved a canonical concept") : undefined,
    captionCompilerVersion: compilation.compilerVersion,
    clauses: compilation.clauses,
    jsonPrompt: compilation.jsonPrompt,
    diagnostics,
  };
}
