import type { Pool } from "pg";

/**
 * Lo único que el LLM puede mandar por cada pieza elegida (plan §4.5). A
 * propósito NO hay campo de precio/nombre/imagen aquí — no existe forma de
 * que el modelo los inyecte porque el schema de la herramienta no los admite.
 */
export type SeleccionSolicitada = {
  productId: string;
  variantId: string;
  cantidad: number;
  razon?: string;
};

export type ItemValidado = {
  productId: string;
  variantId: string;
  sku: string | null;
  titulo: string;
  precioUnitario: number;
  cantidad: number;
  subtotal: number;
  imagen: string | null;
  /** Handle real de Shopify — permite enlazar a la página pública del
   * producto para que el cliente verifique contra la fuente de verdad que
   * esto no es un producto inventado por el LLM. */
  handle: string | null;
};

export type ItemRechazado = {
  productId: string;
  variantId: string;
  motivo: string;
};

export type ResultadoValidacion = {
  validados: ItemValidado[];
  rechazados: ItemRechazado[];
  total: number;
};

export type WhitelistRecuperada = ReadonlyMap<string, ReadonlySet<string>>;

type FilaVariante = {
  product_id: string;
  variant_id: string;
  sku: string | null;
  producto_titulo: string;
  variante_titulo: string | null;
  precio: string;
  variante_disponible: boolean;
  inventario: number | null;
  imagen_principal: string | null;
  handle: string | null;
};

/**
 * Validación obligatoria (plan §4.7/§4.8). Ningún dato comercial sale de la
 * solicitud del LLM — todo se resuelve aparte contra la DB. Un item se
 * rechaza si:
 *   1. su product_id no estaba en la whitelist de resultados recuperados
 *      (nunca se confía en que el LLM "vio" algo — se verifica);
 *   2. su variant_id no existe o no pertenece a ese product_id;
 *   3. la cantidad no es un entero positivo;
 *   4. la variante está agotada (no se cotiza como disponible, plan Test 5).
 */
export async function validarSeleccion(
  pool: Pool,
  seleccion: SeleccionSolicitada[],
  idsRecuperados: WhitelistRecuperada,
): Promise<ResultadoValidacion> {
  const rechazados: ItemRechazado[] = [];
  const candidatos = seleccion.filter((item) => {
    if (!idsRecuperados.has(item.productId)) {
      rechazados.push({
        productId: item.productId,
        variantId: item.variantId,
        motivo: "product_id no estaba en los resultados recuperados de este turno",
      });
      return false;
    }
    if (!idsRecuperados.get(item.productId)?.has(item.variantId)) {
      rechazados.push({
        productId: item.productId,
        variantId: item.variantId,
        motivo: "variant_id no estaba en la whitelist de variantes recuperadas de este turno",
      });
      return false;
    }
    if (!Number.isInteger(item.cantidad) || item.cantidad <= 0) {
      rechazados.push({ productId: item.productId, variantId: item.variantId, motivo: "cantidad inválida" });
      return false;
    }
    return true;
  });

  if (candidatos.length === 0) return { validados: [], rechazados, total: 0 };

  const variantIds = candidatos.map((c) => c.variantId);
  const { rows } = await pool.query<FilaVariante>(
    `SELECT v.product_id, v.variant_id, v.sku, p.title AS producto_titulo, v.title AS variante_titulo,
            v.price AS precio, v.available AS variante_disponible, v.inventory_quantity AS inventario,
            p.image_urls[1] AS imagen_principal, p.handle
     FROM catalog_variants v
     JOIN catalog_products p ON p.product_id = v.product_id
     WHERE v.variant_id = ANY($1::text[])`,
    [variantIds],
  );
  const porVariantId = new Map(rows.map((r) => [r.variant_id, r]));

  const validados: ItemValidado[] = [];
  for (const item of candidatos) {
    const fila = porVariantId.get(item.variantId);
    if (!fila) {
      rechazados.push({ productId: item.productId, variantId: item.variantId, motivo: "variant_id no existe" });
      continue;
    }
    if (fila.product_id !== item.productId) {
      rechazados.push({
        productId: item.productId,
        variantId: item.variantId,
        motivo: "variant_id no pertenece a ese product_id",
      });
      continue;
    }
    if (!fila.variante_disponible) {
      rechazados.push({ productId: item.productId, variantId: item.variantId, motivo: "variante agotada" });
      continue;
    }
    // inventory_quantity es cruce informativo del CDN (ver sincronizar.ts),
    // no siempre está poblado — solo se aplica el tope cuando SÍ hay un
    // número real (plan §4.7: "cantidad <= disponible"). Se rechaza en vez
    // de recortar en silencio: cambiarle la cantidad al cliente sin decirlo
    // sería tan malo como inventar disponibilidad.
    // Shopify's `available` flag is authoritative. A zero/negative inventory
    // value is a known over-selling/unknown-stock signal in this source and
    // must not be used to reinterpret an available variant as exhausted.
    if (fila.inventario != null && fila.inventario > 0 && item.cantidad > fila.inventario) {
      rechazados.push({
        productId: item.productId,
        variantId: item.variantId,
        motivo: `cantidad solicitada (${item.cantidad}) excede el inventario disponible (${fila.inventario})`,
      });
      continue;
    }

    const precioUnitario = Number(fila.precio);
    validados.push({
      productId: item.productId,
      variantId: item.variantId,
      sku: fila.sku,
      titulo: fila.variante_titulo ? `${fila.producto_titulo} — ${fila.variante_titulo}` : fila.producto_titulo,
      precioUnitario,
      cantidad: item.cantidad,
      subtotal: precioUnitario * item.cantidad, // cálculo en código (plan §4.11), nunca del LLM
      imagen: fila.imagen_principal,
      handle: fila.handle,
    });
  }

  const total = validados.reduce((suma, v) => suma + v.subtotal, 0);
  return { validados, rechazados, total };
}
