import type { Pool } from "pg";
import type { Producto } from "@/lib/types";
import { nombreCategoria } from "@/lib/shopify/derivar";
import { llamarPythonCatalogSelection } from "@/lib/ia/python-adapter";

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

export type OpcionesValidacion = {
  signal?: AbortSignal;
  correlationId?: string;
};

export type WhitelistRecuperada = ReadonlyMap<string, ReadonlySet<string>>;

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
  catalogSnapshotId?: string,
  opciones: OpcionesValidacion = {},
): Promise<ResultadoValidacion> {
    const requestId = crypto.randomUUID();
    const result = await llamarPythonCatalogSelection({
      items: seleccion.map((item) => ({
        product_id: item.productId,
        variant_id: item.variantId,
        quantity: item.cantidad,
        ...(item.razon ? { reason: item.razon } : {}),
      })),
      allowlist: [...idsRecuperados.entries()]
        .map(([productId, variantIds]) => ({
          product_id: productId,
          variant_ids: [...variantIds],
        }))
        .filter((entry) => entry.variant_ids.length > 0),
      requestId,
      correlationId: opciones.correlationId ?? crypto.randomUUID(),
      parentSignal: opciones.signal,
      ...(catalogSnapshotId ? { catalogSnapshotId } : {}),
    });
    return {
      validados: result.validados.map((item) => ({
        productId: item.product_id,
        variantId: item.variant_id,
        sku: item.sku,
        productoTitulo: item.product_title,
        titulo: item.title,
        precioUnitario: item.unit_price_cop,
        cantidad: item.quantity,
        subtotal: item.subtotal_cop,
        imagen: item.image_url,
        handle: item.handle,
        tipoProducto: item.product_type,
        categoria: item.category,
        colores: item.colors,
        descripcion: item.description,
        unidadesPaquete: item.units_per_package,
        codigoTamano: item.size_code,
        forma: item.shape,
        diamPulg: item.diameter_inches,
      })),
      rechazados: result.rechazados.map((item) => ({
        productId: item.product_id,
        variantId: item.variant_id,
        motivo: item.reason,
      })),
      total: result.total_cop,
    };
}
