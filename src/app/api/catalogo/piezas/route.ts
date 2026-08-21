import { aProducto, buscarCatalogoShopify, type FiltrosCatalogo } from "@/lib/shopify/consultas";

/**
 * Navegación directa por tipo de producto (§ page.tsx navegarCategoria): el
 * cliente ya sabe qué categoría quiere ver porque tocó un chip con el conteo
 * real, así que no hace falta gastar un turno de IA para traer las piezas —
 * es la misma búsqueda que ya validó `buscar_catalogo` en el chat, solo que
 * sin pasar por el modelo.
 */
export async function POST(request: Request) {
  const filtros = (await request.json()) as FiltrosCatalogo;
  const { resultados, total } = buscarCatalogoShopify({ ...filtros, limite: filtros.limite ?? 20 });
  return Response.json({ productos: resultados.map(aProducto), total });
}
