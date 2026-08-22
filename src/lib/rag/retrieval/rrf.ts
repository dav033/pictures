/**
 * Local, auditable Reciprocal Rank Fusion. Scores from FTS, trigram and
 * vector search are not comparable, so only branch position is fused.
 */

export type RrfBranch = {
  name: "fts" | "trigram" | "vector";
  ids: readonly string[];
  weight?: number;
};

export type RrfContribution = {
  branch: RrfBranch["name"];
  rank: number;
  contribution: number;
};

export type RrfEntry = {
  productId: string;
  score: number;
  contributions: RrfContribution[];
};

export const RRF_K = 60;

export function fusionarRankingsLocal(branches: readonly RrfBranch[], k = RRF_K): RrfEntry[] {
  if (!Number.isFinite(k) || k <= 0) throw new Error("RRF k must be positive");

  const entries = new Map<string, RrfEntry>();
  for (const branch of branches) {
    const weight = branch.weight ?? 1;
    if (!Number.isFinite(weight) || weight < 0) throw new Error(`invalid RRF weight for ${branch.name}`);
    const seen = new Set<string>();
    branch.ids.forEach((productId, index) => {
      if (seen.has(productId)) return;
      seen.add(productId);
      const rank = index + 1;
      const contribution = weight / (k + rank);
      const current = entries.get(productId) ?? { productId, score: 0, contributions: [] };
      current.score += contribution;
      current.contributions.push({ branch: branch.name, rank, contribution });
      entries.set(productId, current);
    });
  }

  return [...entries.values()].sort((left, right) => right.score - left.score || left.productId.localeCompare(right.productId));
}
