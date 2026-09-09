import "server-only";
import type { Pool } from "pg";
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
  product_id: string;
  variant_id: string;
  diam_pulg: number;
  price: number;
  unidades_paq: number;
};

type Candidato = { variantId: string; diameter: number; price: number; packageUnits: number };

export type GrupoDespiece = {
  productId: string;
  despiece: LineaDespiece[];
  whitelistVariantIds: ReadonlySet<string>;
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
  const [resultado] = await resolverVariantesPorDespieceBatch(pool, [{ productId, despiece, whitelistVariantIds }]);
  return resultado!;
}

/**
 * Fase 3.5: mismo contrato que `resolverVariantesPorDespiece`, pero para N
 * ítems `usar_despiece` de un mismo turno de `confirmar_seleccion_rag` en UNA
 * sola consulta en vez de una por ítem. El resultado preserva el orden y el
 * tamaño de `grupos` (una entrada de salida por cada entrada de entrada).
 */
export async function resolverVariantesPorDespieceBatch(
  pool: Pool,
  grupos: readonly GrupoDespiece[],
): Promise<ResultadoResolverTamanos[]> {
  const conConsulta = grupos.filter((g) => g.despiece.length > 0 && g.whitelistVariantIds.size > 0);
  const filasPorProducto = new Map<string, FilaVarianteRedonda[]>();

  if (conConsulta.length > 0) {
    const productIds = [...new Set(conConsulta.map((g) => g.productId))];
    const variantIds = [...new Set(conConsulta.flatMap((g) => [...g.whitelistVariantIds]))];
    const { rows } = await pool.query<FilaVarianteRedonda>(
      `SELECT v.product_id, v.variant_id,
              v.diam_pulg::float8 AS diam_pulg,
              v.price::float8 AS price,
              v.unidades_paq::int AS unidades_paq
         FROM catalog_variants v
         JOIN catalog_products p ON p.product_id = v.product_id
        WHERE v.product_id = ANY($1::text[])
          AND v.variant_id = ANY($2::text[])
          AND p.status = 'ACTIVE'
          AND p.available = true
          AND v.forma = 'redondo'
          AND v.diam_pulg IS NOT NULL
          AND v.price > 0
          AND v.available = true
          AND v.unidades_paq IS NOT NULL`,
      [productIds, variantIds],
    );
    for (const fila of rows) {
      const lista = filasPorProducto.get(fila.product_id) ?? [];
      lista.push(fila);
      filasPorProducto.set(fila.product_id, lista);
    }
  }

  return grupos.map((grupo) => {
    if (grupo.despiece.length === 0) return { lineas: [], sinCobertura: [] };
    if (grupo.whitelistVariantIds.size === 0) return { lineas: [], sinCobertura: grupo.despiece };

    // Segundo chequeo de whitelist en JS, redundante con el `variant_id =
    // ANY($2)` de arriba: ese `$2` es la UNIÓN de las whitelists de todos los
    // grupos del batch, así que por sí solo no basta para aislar un grupo de
    // otro. La whitelist real de ESTE grupo específico es la que decide.
    const candidates: Candidato[] = (filasPorProducto.get(grupo.productId) ?? [])
      .filter((row) => grupo.whitelistVariantIds.has(row.variant_id)
        && Number.isFinite(Number(row.diam_pulg)) && Number(row.price) > 0 && Number(row.unidades_paq) > 0)
      .map((row) => ({ variantId: row.variant_id, diameter: Number(row.diam_pulg), price: Number(row.price), packageUnits: Number(row.unidades_paq) }));

    return resolverConCandidatos(grupo.productId, grupo.despiece, candidates);
  });
}

function resolverConCandidatos(productId: string, despiece: LineaDespiece[], candidates: Candidato[]): ResultadoResolverTamanos {
  // A null/invalid package size is never replaced with an invented default.
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

    // This resolver returns package counts for the selected size. Project-wide
    // waste is allocated later from natural package surplus; it must not be
    // applied independently to every requested line here.
    const unitsNeeded = linea.cantidad;
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
