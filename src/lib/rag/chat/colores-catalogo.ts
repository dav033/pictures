import { RERANK_DEADLINE_MS } from "../retrieval/search";
import type { CatalogAllowlist } from "../retrieval/types";
import { llamarPythonCatalogColors } from "@/lib/ia/nucleo/python-adapter";

export type ColorCatalogo = { valor: string; total: number };

export type OpcionesColoresCatalogo = {
  allowlist?: CatalogAllowlist;
  catalogSnapshotId?: string;
  requestId?: string;
  signal?: AbortSignal;
};

/**
 * Colors the editor's explorer offers, most stocked first, each with how many
 * available products carry it (Python owns the predicates and the counts).
 * Same snapshot pin and allowlist as `buscarCatalogoRag`: Python reads an empty
 * allowlist as "unrestricted", so a restricted mode that authorizes nothing
 * fails closed here with an empty list instead of widening to the whole catalog.
 */
export async function listarColoresCatalogo(opciones: OpcionesColoresCatalogo = {}): Promise<ColorCatalogo[]> {
  if (opciones.allowlist && opciones.allowlist.entries.length === 0) return [];
  const requestId = opciones.requestId ?? crypto.randomUUID();
  const respuesta = await llamarPythonCatalogColors({
    allowlist: opciones.allowlist
      ? opciones.allowlist.entries.map((entry) => ({ product_id: entry.productId, variant_ids: [...entry.variantIds] }))
      : [],
    ...(opciones.catalogSnapshotId === undefined ? {} : { catalogSnapshotId: opciones.catalogSnapshotId }),
    requestId,
    correlationId: requestId,
    deadlineMs: RERANK_DEADLINE_MS,
    parentSignal: opciones.signal,
  });
  return respuesta.colors.map((color) => ({ valor: color.value, total: color.total }));
}
