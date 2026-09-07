import type { Pool } from "pg";
import type { Producto } from "@/lib/types";
import { nombreCategoria } from "@/lib/shopify/derivar";

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
  productoTitulo: string;
  titulo: string;
  precioUnitario: number;
  cantidad: number;
  subtotal: number;
  imagen: string | null;
  /** Handle real de Shopify — permite enlazar a la página pública del
   * producto para que el cliente verifique contra la fuente de verdad que
   * esto no es un producto inventado por el LLM. */
  handle: string | null;
  /** Metadata factual/derivada leída de las mismas filas PG validadas. */
  tipoProducto: string | null;
  categoria: string | null;
  colores: string[];
  descripcion: string | null;
  unidadesPaquete: number | null;
  codigoTamano: string | null;
  forma: string | null;
  diamPulg: number | null;
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
  producto_tipo: string | null;
  categoria: string | null;
  colores_producto: unknown;
  colores_variante: unknown;
  descripcion: string | null;
  unidades_paq: number | null;
  codigo_tamano: string | null;
  forma: string | null;
  diam_pulg: number | null;
};

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

/** Proyección visual segura: todo dato comercial proviene de ItemValidado/PG. */
export function aProductoValidado(item: ItemValidado, paquetes = item.cantidad): Producto {
  const producto: Producto = {
    id: item.variantId,
    nombre: item.titulo,
    categoria: nombreCategoria(item.categoria),
    estilos: [],
    colores: item.colores,
    descripcion: item.descripcion ?? item.titulo,
    precio: item.precioUnitario,
    familiaId: item.productId,
    catalogSku: item.sku ?? undefined,
    catalogProductTitle: item.productoTitulo,
    paquetes,
  };
  if (item.tipoProducto) producto.tipoProducto = item.tipoProducto;
  if (item.unidadesPaquete != null) producto.unidadesPaquete = item.unidadesPaquete;
  if (item.codigoTamano) producto.tamanoCodigo = item.codigoTamano;
  if (item.forma) producto.forma = item.forma;
  if (item.diamPulg != null) producto.diamPulg = item.diamPulg;
  if (item.imagen) producto.foto = item.imagen;
  return producto;
}

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
            p.image_urls[1] AS imagen_principal, p.handle, p.product_type AS producto_tipo,
            p.derived->>'category' AS categoria,
            COALESCE(p.derived->'colors', '[]'::jsonb) AS colores_producto,
            COALESCE(v.derived_colors, ARRAY[]::text[]) AS colores_variante,
            p.description_text AS descripcion,
            NULLIF(to_jsonb(v)->>'unidades_paq', '')::integer AS unidades_paq,
            v.codigo_tamano, v.forma, v.diam_pulg
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
    const coloresVariante = strings(fila.colores_variante);
    const coloresProducto = strings(fila.colores_producto);
    validados.push({
      productId: item.productId,
      variantId: item.variantId,
      sku: fila.sku,
      productoTitulo: fila.producto_titulo,
      titulo: fila.variante_titulo ? `${fila.producto_titulo} — ${fila.variante_titulo}` : fila.producto_titulo,
      precioUnitario,
      cantidad: item.cantidad,
      subtotal: precioUnitario * item.cantidad, // cálculo en código (plan §4.11), nunca del LLM
      imagen: fila.imagen_principal,
      handle: fila.handle,
      tipoProducto: fila.producto_tipo,
      categoria: fila.categoria,
      colores: coloresVariante.length ? coloresVariante : coloresProducto.length === 1 ? coloresProducto : [],
      descripcion: fila.descripcion,
      unidadesPaquete: fila.unidades_paq,
      codigoTamano: fila.codigo_tamano,
      forma: fila.forma,
      diamPulg: fila.diam_pulg == null ? null : Number(fila.diam_pulg),
    });
  }

  const total = validados.reduce((suma, v) => suma + v.subtotal, 0);
  return { validados, rechazados, total };
}
