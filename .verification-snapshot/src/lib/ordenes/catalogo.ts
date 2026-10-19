import "server-only";

import { getRagPool } from "@/lib/rag/db";

export type ElementoCatalogoOrden = {
  sku: string;
  producto: string;
  variante: string | null;
  precioUnitario: number;
  imagen: string | null;
  disponible: boolean;
  cantidad?: number;
};

type FilaCatalogo = {
  variant_id: string;
  sku: string | null;
  sku_original: string | null;
  sku_canonical: string | null;
  producto: string;
  variante: string | null;
  precio: string;
  imagen: string | null;
  disponible: boolean;
};

function filaAElemento(fila: FilaCatalogo): ElementoCatalogoOrden {
  const precioUnitario = Number(fila.precio);
  if (!Number.isFinite(precioUnitario) || precioUnitario < 0) throw new Error("El catálogo contiene un precio inválido.");
  const sku = [fila.sku, fila.sku_original, fila.sku_canonical]
    .find((valor): valor is string => typeof valor === "string" && valor.trim().length > 0) ?? "";
  return {
    sku,
    producto: fila.producto,
    variante: fila.variante,
    precioUnitario,
    imagen: fila.imagen,
    disponible: fila.disponible,
  };
}

function filaCoincideSku(fila: FilaCatalogo, sku: string): boolean {
  const buscado = sku.toUpperCase();
  return [fila.sku, fila.sku_original, fila.sku_canonical].some((valor) => valor?.toUpperCase() === buscado);
}

export async function buscarElementosCatalogoOrden(texto: string): Promise<ElementoCatalogoOrden[]> {
  const limpio = texto.trim();
  const comodin = `%${limpio}%`;
  const { rows } = await getRagPool().query<FilaCatalogo>(
    `SELECT v.variant_id,
            v.sku,
            v.sku_original,
            v.sku_canonical,
            p.title AS producto,
            COALESCE(v.codigo_tamano, v.title) AS variante,
            v.price::text AS precio,
            COALESCE(v.image_url, p.image_urls[1]) AS imagen,
            v.available AS disponible
       FROM catalog_variants v
       JOIN catalog_products p ON p.product_id = v.product_id
      WHERE p.status = 'ACTIVE'
        AND (v.sku IS NOT NULL OR v.sku_original IS NOT NULL OR v.sku_canonical IS NOT NULL)
        AND ($1 = '' OR p.title ILIKE $2 OR v.sku ILIKE $2 OR v.sku_original ILIKE $2 OR v.sku_canonical ILIKE $2 OR COALESCE(v.title, '') ILIKE $2 OR COALESCE(v.codigo_tamano, '') ILIKE $2)
      ORDER BY v.available DESC, p.title, v.variant_id
      LIMIT 30`,
    [limpio, comodin],
  );
  return rows.map(filaAElemento).filter((elemento) => elemento.sku.length > 0);
}

export async function resolverElementosCatalogoOrden(
  entradas: readonly Pick<ElementoCatalogoOrden, "sku" | "cantidad">[],
): Promise<ElementoCatalogoOrden[]> {
  const skus = [...new Set(entradas.map((entrada) => entrada.sku.trim().toUpperCase()).filter(Boolean))];
  if (skus.length !== entradas.length) throw new Error("Cada elemento debe tener un SKU válido.");

  const { rows } = await getRagPool().query<FilaCatalogo>(
    `SELECT v.variant_id,
            v.sku,
            v.sku_original,
            v.sku_canonical,
            p.title AS producto,
            COALESCE(v.codigo_tamano, v.title) AS variante,
            v.price::text AS precio,
            COALESCE(v.image_url, p.image_urls[1]) AS imagen,
            v.available AS disponible
       FROM catalog_variants v
       JOIN catalog_products p ON p.product_id = v.product_id
      WHERE p.status = 'ACTIVE'
        AND (UPPER(v.sku) = ANY($1::text[]) OR UPPER(v.sku_original) = ANY($1::text[]) OR UPPER(v.sku_canonical) = ANY($1::text[]))`,
    [skus],
  );

  return entradas.map((entrada) => {
    const matches = rows.filter((fila) => filaCoincideSku(fila, entrada.sku.trim()));
    if (matches.length !== 1) throw new Error(`El SKU ${entrada.sku} no identifica una única variante activa del catálogo.`);
    return { ...filaAElemento(matches[0]), cantidad: entrada.cantidad };
  });
}
