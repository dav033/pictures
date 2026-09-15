import type { Pool } from "pg";
import type { ProductoColorDisponible } from "@/lib/plan/colores-referencia";

type FilaGloboColor = { product_id: string; titulo: string; color: string };

const MAX_PRODUCTOS_POR_COLOR = 3;

/**
 * Read-only lookup: which available round latex balloons of the published
 * catalog offer each color. It only informs the model that a photo color exists
 * (`coloresReferenciaOmitidos`); it never adds a product to the turn whitelist,
 * so prices and variants still come from `buscar_catalogo_rag`.
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
  const { rows } = await pool.query<FilaGloboColor>(
    `SELECT color, product_id, titulo
       FROM (
         SELECT DISTINCT ON (color, p.product_id) color, p.product_id, p.title AS titulo,
                jsonb_array_length(COALESCE(p.derived->'colors', '[]'::jsonb)) AS total_colores
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
          ORDER BY color, p.product_id
       ) AS globos
      -- Plain one-color balloons first: a printed balloon with a pink accent is not a pink balloon.
      ORDER BY color, total_colores, titulo, product_id
      LIMIT 200`,
    [buscados, opciones.variantIds ? [...opciones.variantIds] : null, opciones.catalogSnapshotId ?? null],
  );
  for (const fila of rows) {
    if (typeof fila.color !== "string" || typeof fila.product_id !== "string" || typeof fila.titulo !== "string") continue;
    const lista = resultado.get(fila.color) ?? [];
    if (lista.length < MAX_PRODUCTOS_POR_COLOR) lista.push({ product_id: fila.product_id, titulo: fila.titulo, en_busqueda: false });
    resultado.set(fila.color, lista);
  }
  return resultado;
}
