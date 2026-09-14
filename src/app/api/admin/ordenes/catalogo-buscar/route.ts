import { isAuthenticatedRequest } from "@/lib/auth/request";
import { buscarElementosCatalogoOrden } from "@/lib/ordenes/catalogo";

// Búsqueda a nivel de VARIANTE (no de producto) -- para armar a mano una línea de "desglose"
// (foto agregada manualmente al dataset) hace falta el mismo grano que trae una orden real de
// Shopify: SKU + tamaño + precio puntual, no solo el producto genérico.
export type { ElementoCatalogoOrden as ElementoCatalogoBusqueda } from "@/lib/ordenes/catalogo";

export async function GET(request: Request) {
  if (!isAuthenticatedRequest(request)) return Response.json({ error: "Sesión requerida." }, { status: 401 });

  const url = new URL(request.url);
  const texto = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  return Response.json({ elementos: await buscarElementosCatalogoOrden(texto) });
}
