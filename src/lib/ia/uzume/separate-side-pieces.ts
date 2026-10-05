import type { LoraPlacement } from "../escena/lora-semantics";

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
  /**
   * `half_arches`: every piece is a half-arch; `half_arch_and_column`: a half-arch with at least one column;
   * `columns`: every piece is a column.
   */
  readonly kind: "half_arches" | "half_arch_and_column" | "columns";
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
 * separation must be stated and checked.
 *
 * **Two columns are included too, and used not to be.** This said «two columns alone already read apart»;
 * they do not. On 2026-10-04 a two-column plan rendered with the right one curving over the gap and closing
 * it like the leg of an arch. It is not a surprise either: `scripts/lora/recaption-v004.ts` measured that
 * **none** of the dataset's 154 captions expresses a bilateral relation, and its authors recorded that gap as
 * the one that «explains the columns merging into the arch legs». Until the LoRA is retrained, saying the gap
 * out loud is the only cure available.
 *
 * Owner of this rule, and now the only copy: `separatePiecesPhrase` in lora-caption-compiler.ts calls this
 * and maps `kind` to its phrase. It used to keep its own filter, and that is exactly what broke — the phrase
 * was added there for two columns and not here, so the caption asked for the gap and the Gemini prompt did
 * not. `test-image-qa-piezas-separadas.ts` is what caught the divergence.
 */
export function findSeparateSidePieces<T extends SidePieceCandidate>(clauses: readonly T[]): SeparateSidePieces<T> | undefined {
  const pieces = clauses.filter((clause) => (clause.structureType === "semiarco" || clause.structureType === "columna") && !clause.bilateral);
  const left = pieces.filter((piece) => piece.placement === "lateral_izquierdo");
  const right = pieces.filter((piece) => piece.placement === "lateral_derecho");
  if (!left.length || !right.length) return undefined;
  const sides = [...left, ...right];
  if (sides.every(isHalfArch)) return { kind: "half_arches", left, right };
  if (sides.some(isHalfArch)) return { kind: "half_arch_and_column", left, right };
  return { kind: "columns", left, right };
}
