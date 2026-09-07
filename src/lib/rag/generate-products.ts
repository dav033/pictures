import type { Pool } from "pg";
import { productosPorId } from "@/lib/products";
import type { Producto } from "@/lib/types";
import { getRagPool } from "@/lib/rag/db";
import { aProductoValidado, type ItemValidado } from "@/lib/rag/chat/validar";

type FilaVarianteGeneracion = {
  product_id: string;
  variant_id: string;
  sku: string | null;
  producto_titulo: string;
  variante_titulo: string | null;
  precio: string | number;
  imagen_principal: string | null;
  producto_tipo: string | null;
  categoria: string | null;
  colores_producto: unknown;
  colores_variante: unknown;
  descripcion: string | null;
  unidades_paq: number | null;
  codigo_tamano: string | null;
  forma: string | null;
  diam_pulg: string | number | null;
};

export type FuentesProductosGeneracion = {
  productIds?: unknown;
  ragVariantIds?: unknown;
};

export type ProductosResueltosGeneracion = {
  productIds: string[];
  ragVariantIds: string[];
  legacy: Producto[];
  rag: Producto[];
  productos: Producto[];
};

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function idsDeFuente(value: unknown, nombre: "productIds" | "ragVariantIds"): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string" || id.length === 0)) {
    throw new Error(`${nombre} must be an array of non-empty strings.`);
  }
  return [...value] as string[];
}

function rechazarDuplicados(ids: string[], nombre: "productIds" | "ragVariantIds"): void {
  const vistos = new Set<string>();
  const duplicados = new Set<string>();
  for (const id of ids) {
    if (vistos.has(id)) duplicados.add(id);
    vistos.add(id);
  }
  if (duplicados.size > 0) throw new Error(`${nombre} contains duplicate IDs: ${[...duplicados].join(", ")}.`);
}

function itemDesdeFila(fila: FilaVarianteGeneracion): ItemValidado {
  const precioUnitario = Number(fila.precio);
  if (!Number.isFinite(precioUnitario) || precioUnitario <= 0) {
    throw new Error(`RAG variant ${fila.variant_id} has an invalid price.`);
  }
  const coloresVariante = strings(fila.colores_variante);
  const coloresProducto = strings(fila.colores_producto);
  return {
    productId: fila.product_id,
    variantId: fila.variant_id,
    sku: fila.sku,
    productoTitulo: fila.producto_titulo,
    titulo: fila.variante_titulo ? `${fila.producto_titulo} — ${fila.variante_titulo}` : fila.producto_titulo,
    precioUnitario,
    cantidad: 1,
    subtotal: precioUnitario,
    imagen: fila.imagen_principal,
    handle: null,
    tipoProducto: fila.producto_tipo,
    categoria: fila.categoria,
    colores: coloresVariante.length ? coloresVariante : coloresProducto.length === 1 ? coloresProducto : [],
    descripcion: fila.descripcion,
    unidadesPaquete: fila.unidades_paq,
    codigoTamano: fila.codigo_tamano,
    forma: fila.forma,
    diamPulg: fila.diam_pulg == null ? null : Number(fila.diam_pulg),
  };
}

/**
 * Resolve exact CDN/RAG variant ids into the same trusted Producto projection
 * used by confirmar_seleccion_rag. This intentionally has no numeric-id
 * heuristic: callers must put legacy SQLite ids and RAG ids in separate fields.
 */
export async function resolverVariantesRagParaGeneracion(
  ids: string[],
  pool: Pick<Pool, "query"> = getRagPool(),
): Promise<Producto[]> {
  if (ids.length === 0) return [];
  const { rows } = await pool.query<FilaVarianteGeneracion>(
    `SELECT v.product_id, v.variant_id, v.sku,
            p.title AS producto_titulo, v.title AS variante_titulo,
            v.price AS precio, p.image_urls[1] AS imagen_principal,
            p.product_type AS producto_tipo, p.derived->>'category' AS categoria,
            COALESCE(p.derived->'colors', '[]'::jsonb) AS colores_producto,
            COALESCE(v.derived_colors, ARRAY[]::text[]) AS colores_variante,
            p.description_text AS descripcion,
            NULLIF(to_jsonb(v)->>'unidades_paq', '')::integer AS unidades_paq,
            v.codigo_tamano, v.forma, v.diam_pulg
       FROM catalog_variants v
       JOIN catalog_products p ON p.product_id = v.product_id
      WHERE v.variant_id = ANY($1::text[])
        AND p.status = 'ACTIVE'
        AND p.available = true
        AND v.available = true
        AND v.price > 0`,
    [ids],
  );
  const porId = new Map(rows.map((fila) => [fila.variant_id, fila]));
  const faltantes = ids.filter((id) => !porId.has(id));
  if (faltantes.length > 0) {
    throw new Error(`One or more RAG variant IDs could not be validated: ${faltantes.join(", ")}.`);
  }
  return ids.map((id) => aProductoValidado(itemDesdeFila(porId.get(id)!), 1));
}

/**
 * Resolve the two explicit product sources used by /api/generate. Legacy
 * productIds stay on the existing SQLite/Shopify resolver; RAG ids never fall
 * back to it. The returned arrays preserve each source's request order.
 */
export async function resolverProductosParaGeneracion(
  fuentes: FuentesProductosGeneracion,
  pool?: Pick<Pool, "query">,
): Promise<ProductosResueltosGeneracion> {
  const productIds = idsDeFuente(fuentes.productIds, "productIds");
  const ragVariantIds = idsDeFuente(fuentes.ragVariantIds, "ragVariantIds");
  rechazarDuplicados(productIds, "productIds");
  rechazarDuplicados(ragVariantIds, "ragVariantIds");

  const idsEnAmbasFuentes = productIds.filter((id) => ragVariantIds.includes(id));
  if (idsEnAmbasFuentes.length > 0) {
    throw new Error(`An ID cannot be present in both productIds and ragVariantIds: ${idsEnAmbasFuentes.join(", ")}.`);
  }

  const legacy = productosPorId(productIds);
  if (legacy.length !== productIds.length) {
    throw new Error("One or more selected catalog products could not be validated.");
  }
  const rag = ragVariantIds.length
    ? await resolverVariantesRagParaGeneracion(ragVariantIds, pool ?? getRagPool())
    : [];
  return { productIds, ragVariantIds, legacy, rag, productos: [...legacy, ...rag] };
}
