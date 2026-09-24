import { isPythonAdapterError } from "@/lib/ia/nucleo/python-adapter";

/**
 * Stable cause reported to the browser when a plan pairs a variant with a
 * product that does not own it in the catalog snapshot of the proposal.
 *
 * Python is the single owner of the rule (`allowlist_product_mismatch`); Next
 * only translates that domain code into this error so routes and the chat tool
 * can answer with a stable cause instead of a generic backend failure.
 */
export const CAUSA_ALLOWLIST_PRODUCTO_VARIANTE = "ALLOWLIST_PRODUCTO_VARIANTE" as const;

export class AllowlistProductoVarianteError extends Error {
  readonly causa = CAUSA_ALLOWLIST_PRODUCTO_VARIANTE;

  constructor(options?: { cause?: unknown }) {
    super("La variante elegida no pertenece al producto indicado en el catálogo de esta propuesta.", options);
    this.name = "AllowlistProductoVarianteError";
  }
}

export function errorAllowlistDesdePython(error: unknown): AllowlistProductoVarianteError | null {
  return isPythonAdapterError(error) && error.domainCode === "allowlist_product_mismatch"
    ? new AllowlistProductoVarianteError({ cause: error })
    : null;
}
