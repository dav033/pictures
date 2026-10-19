import type { CatalogAllowlist, CatalogAllowlistEntry } from "./types";

export type FilaCatalogAllowlist = {
  readonly productId: string;
  /** null = the row only authorizes the product (no variant information). */
  readonly variantId: string | null;
};

function compararIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Single constructor of `CatalogAllowlist`. It keeps the real product→variant
 * association (every row comes from a joined catalog row) and derives the flat
 * arrays existing consumers read.
 *
 * - Entries and variant ids are sorted, so equal inputs give equal allowlists.
 * - A product gets an empty-variants entry only when none of its rows carries
 *   a variant.
 * - A variant listed under two different products is rejected: the catalog has
 *   exactly one owner per variant, so such input is corrupt, not ambiguous.
 */
export function crearCatalogAllowlist(filas: ReadonlyArray<FilaCatalogAllowlist>): CatalogAllowlist {
  const porProducto = new Map<string, Set<string>>();
  const duenoPorVariante = new Map<string, string>();
  for (const fila of filas) {
    if (!fila.productId) throw new Error("CATALOG_ALLOWLIST_INVALID: product_id vacío");
    const variantes = porProducto.get(fila.productId) ?? new Set<string>();
    porProducto.set(fila.productId, variantes);
    if (fila.variantId === null) continue;
    if (!fila.variantId) throw new Error("CATALOG_ALLOWLIST_INVALID: variant_id vacío");
    const dueno = duenoPorVariante.get(fila.variantId);
    if (dueno !== undefined && dueno !== fila.productId) {
      throw new Error(`CATALOG_ALLOWLIST_INVALID: la variante ${fila.variantId} aparece bajo ${dueno} y ${fila.productId}`);
    }
    duenoPorVariante.set(fila.variantId, fila.productId);
    variantes.add(fila.variantId);
  }

  const entries: CatalogAllowlistEntry[] = [...porProducto.entries()]
    .sort(([a], [b]) => compararIds(a, b))
    .map(([productId, variantes]) => ({ productId, variantIds: [...variantes].sort(compararIds) }));
  return {
    entries,
    productIds: entries.map((entry) => entry.productId),
    variantIds: entries.flatMap((entry) => entry.variantIds),
  };
}
