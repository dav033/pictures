import type { Pool } from "pg";
import { coloresRealesProducto } from "@/lib/plan/colores-producto";
import type { ProductoColorDisponible } from "@/lib/plan/colores-referencia";
import { colorCatalogoMasCercano } from "@/lib/rag/catalog/similitud-color";

type FilaGloboColor = { product_id: string; titulo: string; color: string; diametros?: unknown };
type FilaColorPresente = { color: string };

const MAX_PRODUCTOS_POR_COLOR = 3;

/**
 * Round latex balloon colors truly present in the active pool: the derived
 * color(s) of each variant, or the product's single declared color when the
 * variant has none. Same commercial scope (status, availability, LoRA pool,
 * snapshot) `buscarGlobosPorColor`'s product query already used, minus the
 * color match itself -- this is what decides which colors exist to match
 * against, not which products a specific color has.
 */
async function coloresPresentesEnElPool(
  pool: Pick<Pool, "query">,
  variantIds: readonly string[] | null,
  catalogSnapshotId: string | null,
): Promise<string[]> {
  const { rows } = await pool.query<FilaColorPresente>(
    `SELECT DISTINCT color
       FROM catalog_variants v
       JOIN catalog_products p ON p.product_id = v.product_id
      CROSS JOIN LATERAL unnest(
        CASE WHEN cardinality(COALESCE(v.derived_colors, ARRAY[]::text[])) > 0 THEN v.derived_colors
             WHEN jsonb_array_length(COALESCE(p.derived->'colors', '[]'::jsonb)) = 1
                  THEN ARRAY[p.derived->'colors'->>0]
             ELSE ARRAY[]::text[]
        END
      ) AS color
      WHERE p.status = 'ACTIVE'
        AND p.available = true
        AND v.available = true
        AND v.forma = 'redondo'
        AND p.derived->>'category' = 'globo_latex'
        AND ($1::text[] IS NULL OR v.variant_id = ANY($1::text[]))
        AND ($2::text IS NULL OR (p.source_snapshot_id = $2 AND v.source_snapshot_id = $2))`,
    [variantIds, catalogSnapshotId],
  );
  return [...new Set(rows.map((fila) => fila.color).filter((color): color is string => typeof color === "string" && color.length > 0))];
}

/**
 * Read-only lookup: which available round latex balloons of the published
 * catalog offer each color, or the nearest color the pool actually stocks
 * when the literal one is not sold (bug: a photo's dominant color -- "burdeos",
 * "gris" -- had no exact product and disappeared from the plan without a
 * notice, because this lookup only ever checked for an exact string match).
 * The catalog decides the substitute by chromatic distance
 * (`colorCatalogoMasCercano`, the same table `catalog.py` reads from the
 * `catalog-search.v1` contract), never by a hand-kept synonym table. It only
 * informs the model that a photo color is covered (`coloresReferenciaOmitidos`);
 * it never adds a product to the turn whitelist, so prices and variants still
 * come from `buscar_catalogo_rag`. The model must declare the color the chosen
 * product really has, not the photo's word, so the reference-color audit
 * (`_reference_color_substitutions` / `sustitucionesColorReferencia`) still
 * catches and reports the substitution instead of it being relabelled away
 * (`ACCION_COLORES_REFERENCIA_OMITIDOS`).
 *
 * `variantIds` is the active LoRA dataset pool: when present the lookup stays
 * inside it. `catalogSnapshotId` pins the snapshot the turn searched.
 */
export async function buscarGlobosPorColor(
  pool: Pick<Pool, "query">,
  colores: readonly string[],
  opciones: { variantIds?: readonly string[] | null; catalogSnapshotId?: string | null } = {},
): Promise<Map<string, ProductoColorDisponible[]>> {
  const resultado = new Map<string, ProductoColorDisponible[]>();
  const buscados = [...new Set(colores.map((color) => color.trim().toLowerCase()).filter(Boolean))];
  if (buscados.length === 0 || (opciones.variantIds && opciones.variantIds.length === 0)) return resultado;
  const variantIds = opciones.variantIds ? [...opciones.variantIds] : null;
  const catalogSnapshotId = opciones.catalogSnapshotId ?? null;

  const presentes = await coloresPresentesEnElPool(pool, variantIds, catalogSnapshotId);
  if (presentes.length === 0) return resultado;

  const resueltos = new Map<string, string>();
  for (const pedido of buscados) {
    const cercano = colorCatalogoMasCercano(pedido, presentes);
    if (cercano) resueltos.set(pedido, cercano);
  }
  if (resueltos.size === 0) return resultado;

  const aConsultar = [...new Set(resueltos.values())];
  const { rows } = await pool.query<FilaGloboColor>(
    `SELECT color, product_id, titulo, diametros
       FROM (
         SELECT color, p.product_id, p.title AS titulo,
                jsonb_array_length(COALESCE(p.derived->'colors', '[]'::jsonb)) AS total_colores,
                COALESCE(array_agg(DISTINCT v.diam_pulg::float8) FILTER (WHERE v.diam_pulg IS NOT NULL), ARRAY[]::float8[]) AS diametros
           FROM catalog_variants v
           JOIN catalog_products p ON p.product_id = v.product_id
          CROSS JOIN LATERAL unnest($1::text[]) AS color
          WHERE p.status = 'ACTIVE'
            AND p.available = true
            AND v.available = true
            AND v.forma = 'redondo'
            AND p.derived->>'category' = 'globo_latex'
            AND (color = ANY(COALESCE(v.derived_colors, ARRAY[]::text[])) OR COALESCE(p.derived->'colors', '[]'::jsonb) ? color)
            AND ($2::text[] IS NULL OR v.variant_id = ANY($2::text[]))
            AND ($3::text IS NULL OR (p.source_snapshot_id = $3 AND v.source_snapshot_id = $3))
          GROUP BY color, p.product_id, p.title, p.derived
       ) AS globos
      -- Plain one-color balloons first: a printed balloon with a pink accent is not a pink balloon.
      ORDER BY color, total_colores, titulo, product_id
      LIMIT 200`,
    [aConsultar, variantIds, catalogSnapshotId],
  );
  const porColor = new Map<string, ProductoColorDisponible[]>();
  for (const fila of rows) {
    if (typeof fila.color !== "string" || typeof fila.product_id !== "string" || typeof fila.titulo !== "string") continue;
    // Grey balloons are filed under "plateado" in the derived colors (colores-producto.ts).
    if (!coloresRealesProducto(fila.titulo, [fila.color]).includes(fila.color)) continue;
    const lista = porColor.get(fila.color) ?? [];
    // Unknown sizes stay unknown (never "no sizes"): the color is then claimable as before.
    const diametros = Array.isArray(fila.diametros) ? fila.diametros.map(Number).filter(Number.isFinite) : undefined;
    if (lista.length < MAX_PRODUCTOS_POR_COLOR) lista.push({ product_id: fila.product_id, titulo: fila.titulo, en_busqueda: false, ...(diametros ? { diametros } : {}) });
    porColor.set(fila.color, lista);
  }
  for (const [pedido, resuelto] of resueltos) {
    const productos = porColor.get(resuelto);
    if (productos && productos.length > 0) resultado.set(pedido, productos);
  }
  return resultado;
}
