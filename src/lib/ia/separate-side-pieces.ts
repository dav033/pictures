import type { LoraPlacement } from "./lora-semantics";

/**
 * The fields of a caption clause this rule reads. `LoraVisualClause` satisfies
 * it, so the rule runs on the compiler's grouping: `bilateral` is set only when
 * the compiler paired a left and a right structure as one mirrored instruction.
 */
export type SidePieceCandidate = {
  readonly elementIds: readonly string[];
  readonly structureType: string;
  readonly placement: LoraPlacement;
  readonly bilateral?: boolean;
};

export type SeparateSidePieces<T extends SidePieceCandidate> = {
  /** `half_arches`: every piece is a half-arch; `half_arch_and_column`: a half-arch with at least one column. */
  readonly kind: "half_arches" | "half_arch_and_column";
  readonly left: readonly T[];
  readonly right: readonly T[];
};

function isHalfArch(piece: SidePieceCandidate): boolean {
  return piece.structureType === "semiarco";
}

/**
 * Non-mirrored half-arches and columns standing on the left and on the right
 * are separate pieces with an open gap between them. The image model closed
 * them into one full arch (two half-arches with lora-run-v004-1000, and a
 * half-arch next to a column in the reference case of 2026-09-14), so the
 * separation must be stated and checked. Two columns alone already read apart
 * and are not separate pieces here.
 *
 * Owner of this rule. Pending, bounded migration: the caption compiler still
 * keeps a private copy (`separateLateralPieces`/`separatePiecesPhrase` in
 * lora-caption-compiler.ts) that should call this function and map `kind` to
 * its phrase. Until then scripts/test-image-qa-piezas-separadas.ts asserts
 * that the compiled prompt and QA agree on every fixture; that parity check
 * must stay green, and the copy is removed once the compiler calls this.
 */
export function findSeparateSidePieces<T extends SidePieceCandidate>(clauses: readonly T[]): SeparateSidePieces<T> | undefined {
  const pieces = clauses.filter((clause) => (clause.structureType === "semiarco" || clause.structureType === "columna") && !clause.bilateral);
  const left = pieces.filter((piece) => piece.placement === "lateral_izquierdo");
  const right = pieces.filter((piece) => piece.placement === "lateral_derecho");
  if (!left.length || !right.length) return undefined;
  const sides = [...left, ...right];
  if (sides.every(isHalfArch)) return { kind: "half_arches", left, right };
  return sides.some(isHalfArch) ? { kind: "half_arch_and_column", left, right } : undefined;
}
