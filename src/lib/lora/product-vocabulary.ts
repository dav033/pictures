import { z } from "zod";

/**
 * Canonical product-vocabulary schema and resolver.
 *
 * Design gate: docs/decisions/product-vocabulary-v001.md
 * Spec: writing-block.md (sections 3, 7, 8)
 *
 * This module owns:
 * - the ProductConcept schema (runtime-validated with zod);
 * - normalization for lookup keys (never for accepting a match);
 * - a deterministic resolver with a fixed precedence order;
 * - invariant checks over a whole vocabulary set;
 * - resolver diagnostics for callers (caption compiler, prompt compiler, audits).
 */

export const VOCABULARY_VERSION = "product-vocabulary.v1" as const;

export const CONCEPT_STATUS = ["active", "pending", "deprecated"] as const;
export type ConceptStatus = (typeof CONCEPT_STATUS)[number];

const nonEmptyString = z.string().trim().min(1);

const visualPatternSchema = z.object({
  kind: nonEmptyString,
  motif: nonEmptyString.optional(),
  contains_text: z.boolean().optional(),
});

const visualSchema = z.object({
  family: nonEmptyString,
  shape: nonEmptyString,
  material: nonEmptyString,
  color: nonEmptyString,
  finish: nonEmptyString,
  pattern: visualPatternSchema,
  transparency: nonEmptyString.optional(),
});

const contextualAliasSchema = z
  .object({
    value: nonEmptyString,
    product_ids: z.array(nonEmptyString).optional(),
    required_tokens: z.array(nonEmptyString).optional(),
  })
  .refine(
    (alias) =>
      (alias.product_ids !== undefined && alias.product_ids.length > 0) ||
      (alias.required_tokens !== undefined && alias.required_tokens.length > 0),
    {
      message: "A contextual alias must declare product_ids and/or required_tokens to scope its context.",
    },
  );

const aliasesSchema = z.object({
  es: z.array(nonEmptyString),
  en: z.array(nonEmptyString),
  contextual: z.array(contextualAliasSchema),
});

const sizesSchema = z.object({
  separate: z.literal(true),
  allowed_codes: z.array(nonEmptyString),
});

export const productConceptSchema = z.object({
  concept_id: nonEmptyString.regex(
    /^[a-z0-9]+(\.[a-z0-9_]+)+$/,
    "concept_id must be dot-separated lowercase segments, e.g. balloon.round.latex.reflex.rose_gold",
  ),
  canonical_label: nonEmptyString,
  catalog_titles: z.array(nonEmptyString).optional(),
  visual: visualSchema,
  aliases: aliasesSchema,
  catalog_product_ids: z.array(nonEmptyString),
  sizes: sizesSchema,
  status: z.enum(CONCEPT_STATUS),
  vocabulary_version: nonEmptyString,
});

export type ProductConcept = z.infer<typeof productConceptSchema>;

export const productVocabularySchema = z.array(productConceptSchema);
export type ProductVocabulary = ProductConcept[];

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Non-visual prefixes/suffixes that catalog titles sometimes carry and that
 * must be stripped before lookup because they never describe the product's
 * appearance. Kept intentionally small: anything not proven non-visual by
 * repo evidence stays in the string.
 */
const NON_VISUAL_TOKENS = ["B2B", "B2C"];

/**
 * Safe singular/plural collapses for tokens that are used interchangeably in
 * the real catalog data without changing meaning (e.g. "corazon"/"corazones").
 * This list must never include a discriminating color/finish token.
 */
const SAFE_PLURAL_COLLAPSES: Array<[RegExp, string]> = [
  [/\bglobos\b/g, "globo"],
  [/\bcorazones\b/g, "corazon"],
  [/\bballoons\b/g, "balloon"],
];

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Normalizes a raw title/alias into a stable lookup key.
 *
 * This function is used ONLY to build/consult lookup maps. It must never be
 * used to decide a match by itself (no substring/fuzzy acceptance) Ã¢â‚¬â€ exact
 * key equality after normalization is the only accepted comparison.
 */
export function normalizeProductText(raw: string): string {
  let value = raw.normalize("NFKC");

  // Registered/trademark symbols carry no visual meaning.
  value = value.replace(/[Ã‚Â®Ã¢â€žÂ¢Ã‚Â©]/g, "");

  value = stripAccents(value);
  value = value.toLowerCase();

  // Normalize punctuation to spaces, but keep hyphens meaningful (e.g.
  // "link-o-loon") by converting them to a single space too, since the
  // catalog itself is inconsistent about hyphenation ("Link-O-Loon" vs
  // "LINK O LOON").
  value = value.replace(/[-_/\\.,;:!Ã‚Â¡Ã‚Â¿?"'`Ã‚Â´()[\]{}]+/g, " ");

  for (const token of NON_VISUAL_TOKENS) {
    const pattern = new RegExp(`\\b${token.toLowerCase()}\\b`, "g");
    value = value.replace(pattern, " ");
  }

  value = value.replace(/\s+/g, " ").trim();

  for (const [pattern, replacement] of SAFE_PLURAL_COLLAPSES) {
    value = value.replace(pattern, replacement);
  }

  // Re-collapse whitespace in case a plural collapse changed word boundaries.
  value = value.replace(/\s+/g, " ").trim();

  return value;
}

/**
 * Sorts the significant tokens of a normalized string. Used only to detect
 * word-order-independent equality for full-title normalization (e.g.
 * "Globo Redondo Reflex Dorado Rosa" vs "Reflex Dorado Rosa Globo Redondo").
 * This is still exact-set equality, not fuzzy matching: every token must be
 * present, none may be missing or extra.
 */
function tokenSetKey(normalized: string): string {
  return normalized.split(" ").filter(Boolean).sort().join(" ");
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

export const RESOLUTION_REASONS = [
  "product_id",
  "full_title",
  "global_alias",
  "contextual_alias",
  "ambiguous",
  "unknown",
] as const;
export type ResolutionReason = (typeof RESOLUTION_REASONS)[number];

export type ResolutionInput = {
  /** Raw catalog product id, if known. Checked first. */
  productId?: string;
  /** Raw title or free-form text to resolve (ES or EN). */
  text?: string;
  /**
   * Extra tokens known to be true for this request's context (e.g. other
   * words present in the same title/order line), used to satisfy contextual
   * aliases. Must be raw, not pre-normalized.
   */
  contextTokens?: string[];
};

export type ResolvedConcept = {
  status: "resolved";
  reason: Extract<ResolutionReason, "product_id" | "full_title" | "global_alias" | "contextual_alias">;
  concept: ProductConcept;
};

export type AmbiguousResolution = {
  status: "ambiguous";
  reason: "ambiguous";
  candidates: ProductConcept[];
  matchedOn: string;
};

export type UnknownResolution = {
  status: "unknown";
  reason: "unknown";
  matchedOn?: string;
};

export type ResolutionResult = ResolvedConcept | AmbiguousResolution | UnknownResolution;

type LookupIndexes = {
  byProductId: Map<string, ProductConcept[]>;
  byFullTitleKey: Map<string, ProductConcept[]>;
  byGlobalAliasKey: Map<string, ProductConcept[]>;
  byContextualAliasKey: Map<string, Array<{ concept: ProductConcept; alias: ProductConcept["aliases"]["contextual"][number] }>>;
};

function activeConceptsOnly(vocabulary: ProductVocabulary): ProductConcept[] {
  return vocabulary.filter((concept) => concept.status === "active");
}

function pushIndex<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key);
  if (existing) {
    existing.push(value);
  } else {
    map.set(key, [value]);
  }
}

/**
 * Builds lookup indexes once per vocabulary. Only "active" concepts
 * participate in resolution; "pending" and "deprecated" concepts are never
 * matched implicitly.
 */
export function buildLookupIndexes(vocabulary: ProductVocabulary): LookupIndexes {
  const byProductId: LookupIndexes["byProductId"] = new Map();
  const byFullTitleKey: LookupIndexes["byFullTitleKey"] = new Map();
  const byGlobalAliasKey: LookupIndexes["byGlobalAliasKey"] = new Map();
  const byContextualAliasKey: LookupIndexes["byContextualAliasKey"] = new Map();

  for (const concept of activeConceptsOnly(vocabulary)) {
    for (const productId of concept.catalog_product_ids) {
      pushIndex(byProductId, productId, concept);
    }

    const titleSources = [concept.canonical_label, ...(concept.catalog_titles ?? [])];
    for (const title of titleSources) {
      const titleKey = tokenSetKey(normalizeProductText(title));
      pushIndex(byFullTitleKey, titleKey, concept);
    }

    const allGlobalAliases = [...concept.aliases.es, ...concept.aliases.en];
    for (const alias of allGlobalAliases) {
      const aliasKey = normalizeProductText(alias);
      pushIndex(byGlobalAliasKey, aliasKey, concept);
    }

    for (const alias of concept.aliases.contextual) {
      const aliasKey = normalizeProductText(alias.value);
      pushIndex(byContextualAliasKey, aliasKey, { concept, alias });
    }
  }

  return { byProductId, byFullTitleKey, byGlobalAliasKey, byContextualAliasKey };
}

function dedupeConcepts(concepts: ProductConcept[]): ProductConcept[] {
  const seen = new Set<string>();
  const result: ProductConcept[] = [];
  for (const concept of concepts) {
    if (!seen.has(concept.concept_id)) {
      seen.add(concept.concept_id);
      result.push(concept);
    }
  }
  return result;
}

function contextSatisfied(
  alias: ProductConcept["aliases"]["contextual"][number],
  input: ResolutionInput,
): boolean {
  const productIdMatches =
    alias.product_ids === undefined ||
    (input.productId !== undefined && alias.product_ids.includes(input.productId));

  if (alias.required_tokens === undefined || alias.required_tokens.length === 0) {
    return productIdMatches;
  }

  const normalizedContext = new Set(
    (input.contextTokens ?? []).map((token) => normalizeProductText(token)),
  );
  if (input.text) {
    for (const token of normalizeProductText(input.text).split(" ")) {
      if (token) normalizedContext.add(token);
    }
  }

  const tokensMatch = alias.required_tokens.every((required) =>
    normalizedContext.has(normalizeProductText(required)),
  );

  return productIdMatches && tokensMatch;
}

/**
 * Resolves a single input against the vocabulary using the frozen
 * precedence order from writing-block.md Ã‚Â§8:
 *
 * 1. Exact catalog product ID.
 * 2. Exact normalized full title (canonical_label, token-set equality).
 * 3. Exact global alias (ES or EN).
 * 4. Exact contextual alias with satisfied context.
 * 5. Explicit ambiguous.
 * 6. Explicit unknown.
 *
 * No step ever falls back to substring or fuzzy matching.
 */
export function resolveProductConcept(
  input: ResolutionInput,
  vocabulary: ProductVocabulary,
  indexes: LookupIndexes = buildLookupIndexes(vocabulary),
): ResolutionResult {
  if (input.productId) {
    const byId = indexes.byProductId.get(input.productId);
    if (byId && byId.length > 0) {
      const unique = dedupeConcepts(byId);
      if (unique.length === 1) {
        return { status: "resolved", reason: "product_id", concept: unique[0] };
      }
      return { status: "ambiguous", reason: "ambiguous", candidates: unique, matchedOn: input.productId };
    }
  }

  if (input.text) {
    const normalizedText = normalizeProductText(input.text);

    const titleKey = tokenSetKey(normalizedText);
    const byTitle = indexes.byFullTitleKey.get(titleKey);
    if (byTitle && byTitle.length > 0) {
      const unique = dedupeConcepts(byTitle);
      if (unique.length === 1) {
        return { status: "resolved", reason: "full_title", concept: unique[0] };
      }
      return { status: "ambiguous", reason: "ambiguous", candidates: unique, matchedOn: input.text };
    }

    const byGlobalAlias = indexes.byGlobalAliasKey.get(normalizedText);
    if (byGlobalAlias && byGlobalAlias.length > 0) {
      const unique = dedupeConcepts(byGlobalAlias);
      if (unique.length === 1) {
        return { status: "resolved", reason: "global_alias", concept: unique[0] };
      }
      return { status: "ambiguous", reason: "ambiguous", candidates: unique, matchedOn: input.text };
    }

    const byContextualAlias = indexes.byContextualAliasKey.get(normalizedText);
    if (byContextualAlias && byContextualAlias.length > 0) {
      const satisfied = byContextualAlias.filter((entry) => contextSatisfied(entry.alias, input));
      const unique = dedupeConcepts(satisfied.map((entry) => entry.concept));
      if (unique.length === 1) {
        return { status: "resolved", reason: "contextual_alias", concept: unique[0] };
      }
      if (unique.length > 1) {
        return { status: "ambiguous", reason: "ambiguous", candidates: unique, matchedOn: input.text };
      }
      // No candidate had a satisfied context. If more than one distinct concept declares
      // this alias, the input is genuinely ambiguous and must be surfaced as such rather
      // than silently reported as unknown. A single declaring concept without satisfied
      // context is reported as unknown (missing context, not a collision).
      const allCandidates = dedupeConcepts(byContextualAlias.map((entry) => entry.concept));
      if (allCandidates.length > 1) {
        return { status: "ambiguous", reason: "ambiguous", candidates: allCandidates, matchedOn: input.text };
      }
      return { status: "unknown", reason: "unknown", matchedOn: input.text };
    }
  }

  return { status: "unknown", reason: "unknown", matchedOn: input.text ?? input.productId };
}

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

export type InvariantViolation = {
  code: string;
  message: string;
  conceptIds: string[];
};

const BANNED_COMMERCIAL_LABEL_TOKENS = [
  "sku",
  "paquete x",
  "precio",
  "cop",
  "cop$",
  "$",
];

/**
 * Checks the required invariants from writing-block.md Ã‚Â§7 over a whole
 * vocabulary. Only "active" concepts are checked for uniqueness rules;
 * "pending"/"deprecated" concepts are exempt from collision checks but are
 * still checked for basic structural validity via the zod schema.
 */
export function checkVocabularyInvariants(vocabulary: ProductVocabulary): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const active = activeConceptsOnly(vocabulary);

  const conceptIdCounts = new Map<string, number>();
  for (const concept of vocabulary) {
    conceptIdCounts.set(concept.concept_id, (conceptIdCounts.get(concept.concept_id) ?? 0) + 1);
  }
  for (const [conceptId, count] of conceptIdCounts) {
    if (count > 1) {
      violations.push({
        code: "duplicate_concept_id",
        message: `concept_id "${conceptId}" appears ${count} times.`,
        conceptIds: [conceptId],
      });
    }
  }

  const productIdOwners = new Map<string, Set<string>>();
  for (const concept of active) {
    for (const productId of concept.catalog_product_ids) {
      const owners = productIdOwners.get(productId) ?? new Set<string>();
      owners.add(concept.concept_id);
      productIdOwners.set(productId, owners);
    }
  }
  for (const [productId, owners] of productIdOwners) {
    if (owners.size > 1) {
      violations.push({
        code: "product_id_multiple_active_concepts",
        message: `catalog product id "${productId}" maps to multiple active concepts: ${[...owners].join(", ")}.`,
        conceptIds: [...owners],
      });
    }
  }

  const globalAliasOwners = new Map<string, Set<string>>();
  for (const concept of active) {
    const allGlobalAliases = [...concept.aliases.es, ...concept.aliases.en];
    for (const alias of allGlobalAliases) {
      const key = normalizeProductText(alias);
      const owners = globalAliasOwners.get(key) ?? new Set<string>();
      owners.add(concept.concept_id);
      globalAliasOwners.set(key, owners);
    }
  }
  for (const [aliasKey, owners] of globalAliasOwners) {
    if (owners.size > 1) {
      violations.push({
        code: "global_alias_collision",
        message: `normalized global alias "${aliasKey}" maps to multiple active concepts: ${[...owners].join(", ")}.`,
        conceptIds: [...owners],
      });
    }
  }

  for (const concept of active) {
    if (!concept.canonical_label.trim()) {
      violations.push({
        code: "empty_canonical_label",
        message: `concept "${concept.concept_id}" has an empty canonical label.`,
        conceptIds: [concept.concept_id],
      });
    }

    const label = concept.canonical_label.toLowerCase();
    for (const banned of BANNED_COMMERCIAL_LABEL_TOKENS) {
      // `cop` es la moneda colombiana, pero por subcadena also matchea dentro de palabras de
      // color legÃƒÂ­timas: "copper orange" quedaba rechazado como fuga comercial. Los tokens
      // puramente alfabÃƒÂ©ticos se buscan como palabra completa (con plural opcional); los que
      // llevan sÃƒÂ­mbolo ("cop$", "$") siguen por subcadena, que ahÃƒÂ­ no da falsos positivos.
      const esPalabra = /^[a-z ]+$/.test(banned);
      const aparece = esPalabra
        ? new RegExp(`(^|[^a-z])${banned.replace(/ /g, "\\s+")}s?($|[^a-z])`).test(label)
        : label.includes(banned);
      if (aparece) {
        violations.push({
          code: "banned_commercial_term_in_label",
          message: `concept "${concept.concept_id}" canonical label contains banned commercial term "${banned}".`,
          conceptIds: [concept.concept_id],
        });
      }
    }

    if (/\br-?\d/.test(label) || /\d+\s*(cm|in|inch|inches|"|pulg)/.test(label)) {
      violations.push({
        code: "size_in_canonical_label",
        message: `concept "${concept.concept_id}" canonical label appears to embed a size.`,
        conceptIds: [concept.concept_id],
      });
    }

    if (concept.visual.finish.toLowerCase().includes("reflex") && !label.includes("reflex")) {
      violations.push({
        code: "reflex_missing_from_label",
        message: `concept "${concept.concept_id}" has finish "Reflex" but canonical label does not contain "Reflex".`,
        conceptIds: [concept.concept_id],
      });
    }

    if (/\br-?\d/i.test(concept.concept_id) || /\bpack\d*\b/i.test(concept.concept_id)) {
      violations.push({
        code: "size_or_package_in_concept_id",
        message: `concept_id "${concept.concept_id}" appears to embed a size or package quantity.`,
        conceptIds: [concept.concept_id],
      });
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export type ResolutionDiagnostic = {
  input: ResolutionInput;
  result: ResolutionResult;
};

/**
 * Resolves a batch of inputs and returns per-input diagnostics, useful for
 * caption/prompt compilers and audit scripts that need to report every
 * unresolved item explicitly rather than silently dropping it.
 */
export function resolveProductConceptsWithDiagnostics(
  inputs: ResolutionInput[],
  vocabulary: ProductVocabulary,
): ResolutionDiagnostic[] {
  const indexes = buildLookupIndexes(vocabulary);
  return inputs.map((input) => ({ input, result: resolveProductConcept(input, vocabulary, indexes) }));
}

/**
 * Parses and validates a raw vocabulary array against the schema. Throws a
 * zod error (with full path context) on the first structural violation.
 */
export function parseProductVocabulary(raw: unknown): ProductVocabulary {
  return productVocabularySchema.parse(raw);
}




