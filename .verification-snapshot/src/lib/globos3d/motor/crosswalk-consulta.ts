import { presentacionesDelMismoGlobo, type FilaCrudaDePresentaciones, type FilaDePresentaciones } from "./crosswalk-mismo-globo";
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

function filasDeCatalogo(rows: ReadonlyArray<Record<string, unknown>>): FilaCatalogo[] {
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

export async function leerFilasCatalogo(conexion: ConsultaSql): Promise<FilaCatalogo[]> {
  const { rows } = await conexion.query(SQL_FILAS_CATALOGO);
  return filasDeCatalogo(rows);
}

export type { FilaDePresentaciones } from "./crosswalk-mismo-globo";

/**
 * Los otros paquetes del MISMO globo que cada variante pedida (D-038), de los productos que el cruce no conoce (un globo impreso, una
 * cortina). La consulta trae las variantes de cada producto pedido con lo que decide si son del mismo globo, y la regla de
 * `mismo_globo` de Python se aplica en TypeScript (`crosswalk-mismo-globo.ts`): normaliza los colores y el texto como ella, algo que
 * la base no hace. La lista de variantes a la venta es la que cotiza Python (producto activo y disponible; variante disponible en COP,
 * con precio y unidades por paquete); la variante pedida se trae aunque no se venda, para saber de qué globo es.
 */
const SQL_PRESENTACIONES = `
  WITH snapshot AS (
    SELECT source_snapshot_id FROM rag_source_snapshots
     WHERE source_kind = 'products_catalog' AND status = 'published'
     ORDER BY published_at DESC NULLS LAST, fetched_at DESC LIMIT 1
  ), pedidas AS (
    SELECT v.variant_id::text AS pedida, v.product_id
      FROM catalog_variants v JOIN snapshot s ON s.source_snapshot_id = v.source_snapshot_id
     WHERE v.variant_id::text = ANY($1::text[])
  )
  SELECT q.pedida, s.source_snapshot_id AS snapshot, p.product_id, p.title AS titulo_producto,
         COALESCE(p.derived->'colors', '[]'::jsonb) AS colores_producto, v.variant_id, v.title AS titulo_variante,
         v.codigo_tamano, v.forma, v.diam_pulg, v.derived_colors, NULLIF(to_jsonb(v)->>'unidades_paq', '')::integer AS unidades_paq, v.price,
         (v.available = TRUE AND v.currency = 'COP' AND v.price > 0 AND NULLIF(to_jsonb(v)->>'unidades_paq', '')::integer > 0) AS vendible
    FROM pedidas q
    JOIN catalog_variants v ON v.product_id = q.product_id
    JOIN catalog_products p ON p.product_id = v.product_id
    JOIN snapshot s ON s.source_snapshot_id = v.source_snapshot_id
   WHERE p.source_snapshot_id = s.source_snapshot_id
     AND p.status = 'ACTIVE' AND p.available = TRUE
     AND (v.variant_id::text = q.pedida
          OR (v.available = TRUE AND v.currency = 'COP' AND v.price > 0 AND NULLIF(to_jsonb(v)->>'unidades_paq', '')::integer > 0))
   ORDER BY q.pedida, v.variant_id`;

const numero = (valor: unknown): number | null => {
  if (valor === null || valor === undefined || valor === "") return null;
  const convertido = Number(valor);
  return Number.isFinite(convertido) ? convertido : null;
};

/** Una lista de textos de la base: un arreglo, o su JSON (`_json_value` de Python). */
function lista(valor: unknown): string[] {
  let leida = valor;
  if (typeof leida === "string") {
    try { leida = JSON.parse(leida) as unknown; } catch { return []; }
  }
  return Array.isArray(leida) ? leida.filter((item): item is string => typeof item === "string") : [];
}

export function filaCrudaDePresentaciones(fila: Record<string, unknown>): FilaCrudaDePresentaciones | null {
  const pedida = texto(fila.pedida), snapshot = texto(fila.snapshot), productId = texto(fila.product_id), tituloProducto = texto(fila.titulo_producto), variantId = texto(fila.variant_id);
  if (!pedida || !snapshot || !productId || !tituloProducto || !variantId) return null;
  return {
    pedida, snapshot, productId, tituloProducto, coloresProducto: lista(fila.colores_producto), variantId, tituloVariante: texto(fila.titulo_variante),
    codigoTamano: texto(fila.codigo_tamano), forma: texto(fila.forma), diamPulg: numero(fila.diam_pulg), coloresVariante: lista(fila.derived_colors),
    unidadesPaq: numero(fila.unidades_paq), precio: numero(fila.price), vendible: fila.vendible === true,
  };
}

export async function leerPresentacionesDeVariantes(conexion: ConsultaSql, variantIds: readonly string[]): Promise<FilaDePresentaciones[]> {
  if (!variantIds.length) return [];
  const { rows } = await conexion.query(SQL_PRESENTACIONES, [[...variantIds]]);
  return presentacionesDelMismoGlobo(rows.flatMap((fila) => filaCrudaDePresentaciones(fila) ?? []));
}

const SQL_SNAPSHOT_PUBLICADO = `
  SELECT source_snapshot_id FROM rag_source_snapshots
   WHERE source_kind = 'products_catalog' AND status = 'published'
   ORDER BY published_at DESC NULLS LAST, fetched_at DESC LIMIT 1`;

/** El snapshot publicado del catálogo: el mismo del que Python saca los precios. */
export async function leerSnapshotPublicado(conexion: ConsultaSql): Promise<string | null> {
  const { rows } = await conexion.query(SQL_SNAPSHOT_PUBLICADO);
  return texto(rows[0]?.source_snapshot_id);
}
