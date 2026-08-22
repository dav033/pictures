export type GenerationIdSources = {
  productIds: string[];
  ragVariantIds: string[];
};

/**
 * Splits ids by validated source metadata. The input order within each source
 * is retained; duplicates are removed at their first occurrence.
 */
export function classifyGenerationIds(
  ids: readonly string[],
  validatedRagVariantIds: ReadonlySet<string>,
): GenerationIdSources {
  const productIds: string[] = [];
  const ragVariantIds: string[] = [];
  const seenProductIds = new Set<string>();
  const seenRagVariantIds = new Set<string>();

  for (const id of ids) {
    if (validatedRagVariantIds.has(id)) {
      if (!seenRagVariantIds.has(id)) {
        seenRagVariantIds.add(id);
        ragVariantIds.push(id);
      }
    } else if (!seenProductIds.has(id)) {
      seenProductIds.add(id);
      productIds.push(id);
    }
  }

  return { productIds, ragVariantIds };
}
