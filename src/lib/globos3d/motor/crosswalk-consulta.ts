import type { FilaCatalogo } from "./crosswalk-variantes";

/**
 * Las filas del catálogo publicado con que se arma el cruce (`crosswalk-variantes.ts`). Es la misma lista de variantes
 * que cotiza Python (`fetch_current_material_rows`, services/ai-api/app/catalog.py): producto activo y disponible,
 * variante disponible en COP, con precio y unidades por paquete. Quien la llama pasa su conexión (el pool del servidor o
 * el del script) y nunca se imprime ninguna credencial.
 */
export type ConsultaSql = { query: (texto: string, parametros?: readonly unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> };

const SQL_FILAS_CATALOGO = `
  WITH snapshot AS (
    SELECT source_snapshot_id FROM rag_source_snapshots
     WHERE source_kind = 'products_catalog' AND status = 'published'
     ORDER BY published_at DESC NULLS LAST, fetched_at DESC LIMIT 1
  )
  SELECT s.source_snapshot_id AS snapshot, p.product_id, p.title AS titulo_producto, v.variant_id,
         v.title AS titulo_variante, v.codigo_tamano, NULLIF(to_jsonb(v)->>'unidades_paq', '')::integer AS unidades_paq,
         v.price, v.derived_colors
    FROM catalog_variants v
    JOIN catalog_products p ON p.product_id = v.product_id
    JOIN snapshot s ON s.source_snapshot_id = v.source_snapshot_id
   WHERE p.source_snapshot_id = s.source_snapshot_id
     AND p.status = 'ACTIVE' AND p.available = TRUE
     AND v.available = TRUE AND v.currency = 'COP' AND v.price > 0
     AND NULLIF(to_jsonb(v)->>'unidades_paq', '')::integer > 0
   ORDER BY p.product_id, v.variant_id`;

function texto(valor: unknown): string | null {
  return typeof valor === "string" ? valor : null;
}

export async function leerFilasCatalogo(conexion: ConsultaSql): Promise<FilaCatalogo[]> {
  const { rows } = await conexion.query(SQL_FILAS_CATALOGO);
  return rows.flatMap((fila): FilaCatalogo[] => {
    const unidades = Number(fila.unidades_paq);
    const precio = Number(fila.price);
    const snapshot = texto(fila.snapshot), productId = texto(fila.product_id), titulo = texto(fila.titulo_producto), variantId = texto(fila.variant_id);
    if (!snapshot || !productId || !titulo || !variantId || !Number.isInteger(unidades) || unidades <= 0 || !Number.isFinite(precio) || precio <= 0) return [];
    return [{
      snapshot, productId, tituloProducto: titulo, variantId, tituloVariante: texto(fila.titulo_variante), codigoTamano: texto(fila.codigo_tamano),
      unidadesPaq: unidades, precio,
      coloresDerivados: Array.isArray(fila.derived_colors) ? fila.derived_colors.filter((color): color is string => typeof color === "string") : null,
    }];
  });
}
