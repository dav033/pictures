import { getDb } from "@/lib/db";

// Búsqueda a nivel de VARIANTE (no de producto) -- para armar a mano una línea de "desglose"
// (foto agregada manualmente al dataset) hace falta el mismo grano que trae una orden real de
// Shopify: SKU + tamaño + precio puntual, no solo el producto genérico.
export type ElementoCatalogoBusqueda = {
  sku: string;
  producto: string;
  variante: string | null;
  precioUnitario: number;
  imagen: string | null;
  disponible: boolean;
};

type Fila = {
  sku: string | null;
  titulo_limpio: string;
  tamano_codigo: string | null;
  option1: string | null;
  precio: number;
  imagen_principal: string | null;
  disponible: number;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const texto = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const query = `%${texto}%`;

  const filas = getDb()
    .prepare(
      `SELECT v.sku, p.titulo_limpio, v.tamano_codigo, v.option1, v.precio, p.imagen_principal, v.disponible
       FROM shopify_variante v
       JOIN shopify_producto p ON p.id = v.producto_id
       WHERE v.sku IS NOT NULL
         AND (? = '%%' OR lower(p.titulo_limpio) LIKE ? OR lower(v.sku) LIKE ? OR lower(COALESCE(v.option1, '')) LIKE ?)
       ORDER BY v.disponible DESC, p.titulo_limpio
       LIMIT 30`,
    )
    .all(query, query, query, query) as Fila[];

  const elementos: ElementoCatalogoBusqueda[] = filas.map((f) => ({
    sku: f.sku as string,
    producto: f.titulo_limpio,
    variante: f.tamano_codigo ?? f.option1,
    precioUnitario: f.precio,
    imagen: f.imagen_principal,
    disponible: Boolean(f.disponible),
  }));

  return Response.json({ elementos });
}
