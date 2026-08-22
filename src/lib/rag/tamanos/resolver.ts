import "server-only";
import type { Pool } from "pg";
import { MERMA } from "@/lib/cotizacion/constantes";
import type { LineaDespiece } from "@/lib/medidas/geometria";

export type LineaResuelta = {
  productId: string;
  variantId: string;
  /** Paquetes cerrados — mismo contrato que `SeleccionSolicitada.cantidad`. */
  cantidad: number;
  diamPulgPedido: number;
  diamPulgEntregado: number;
  /** Sustitución explícita cuando la whitelist no tiene el diámetro pedido. */
  sustitucion: { pedido: string; entregado: string; motivo: string } | null;
};

export type ResultadoResolverTamanos = {
  lineas: LineaResuelta[];
  /** Líneas que no pudieron resolverse usando exclusivamente la whitelist PG. */
  sinCobertura: LineaDespiece[];
};

type FilaVarianteRedonda = {
  variant_id: string;
  diam_pulg: number;
  price: number;
  unidades_paq: number;
};

/**
 * Resuelve un despiece únicamente contra el catálogo RAG PostgreSQL.
 *
 * `productId` y `whitelistVariantIds` son identidades PG entregadas por el
 * retrieval. No hay fallback a SQLite, SKU, producto hermano ni primer match:
 * cada fila candidate debe pertenecer simultáneamente al producto, a la
 * whitelist, ser ACTIVE/available y tener precio, diámetro y unidades de
 * paquete factuals.
 */
export async function resolverVariantesPorDespiece(
  pool: Pool,
  productId: string,
  despiece: LineaDespiece[],
  whitelistVariantIds: ReadonlySet<string>,
): Promise<ResultadoResolverTamanos> {
  if (despiece.length === 0) return { lineas: [], sinCobertura: [] };
  if (whitelistVariantIds.size === 0) return { lineas: [], sinCobertura: despiece };

  const { rows } = await pool.query<FilaVarianteRedonda>(
    `SELECT v.variant_id,
            v.diam_pulg::float8 AS diam_pulg,
            v.price::float8 AS price,
            v.unidades_paq::int AS unidades_paq
       FROM catalog_variants v
       JOIN catalog_products p ON p.product_id = v.product_id
      WHERE v.product_id = $1
        AND v.variant_id = ANY($2::text[])
        AND p.status = 'ACTIVE'
        AND p.available = true
        AND v.forma = 'redondo'
        AND v.diam_pulg IS NOT NULL
        AND v.price > 0
        AND v.available = true
        AND v.unidades_paq IS NOT NULL`,
    [productId, [...whitelistVariantIds]],
  );

  // A null/invalid package size is never replaced with an invented default.
  const candidates = rows
    .filter((row) => Number.isFinite(Number(row.diam_pulg)) && Number(row.price) > 0 && Number(row.unidades_paq) > 0)
    .map((row) => ({
      variantId: row.variant_id,
      diameter: Number(row.diam_pulg),
      price: Number(row.price),
      packageUnits: Number(row.unidades_paq),
    }));
  if (candidates.length === 0) return { lineas: [], sinCobertura: despiece };

  const lineas: LineaResuelta[] = [];
  for (const linea of despiece) {
    let best = candidates[0]!;
    let bestDistance = Math.abs(best.diameter - linea.pulgadas);
    for (const candidate of candidates.slice(1)) {
      const distance = Math.abs(candidate.diameter - linea.pulgadas);
      const bestUnitPrice = best.price / best.packageUnits;
      const candidateUnitPrice = candidate.price / candidate.packageUnits;
      if (
        distance < bestDistance ||
        (distance === bestDistance && (candidateUnitPrice < bestUnitPrice ||
          (candidateUnitPrice === bestUnitPrice && candidate.variantId < best.variantId)))
      ) {
        best = candidate;
        bestDistance = distance;
      }
    }

    const unitsNeeded = Math.ceil(linea.cantidad * (1 + MERMA));
    const packages = Math.max(1, Math.ceil(unitsNeeded / best.packageUnits));
    lineas.push({
      productId,
      variantId: best.variantId,
      cantidad: packages,
      diamPulgPedido: linea.pulgadas,
      diamPulgEntregado: best.diameter,
      sustitucion: bestDistance > 0
        ? {
            pedido: `R-${linea.pulgadas}`,
            entregado: `R-${best.diameter}`,
            motivo: `La whitelist no tiene R-${linea.pulgadas}; se usó el diámetro más cercano disponible dentro de la whitelist.`,
          }
        : null,
    });
  }

  return { lineas, sinCobertura: [] };
}
