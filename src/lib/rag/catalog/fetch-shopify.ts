import { conReintento } from "@/lib/retry";
import type { ProductoInventarioCDN, ProductoPublico } from "@/lib/shopify/tipos";

/**
 * Duplica deliberadamente el fetch de src/lib/shopify/sincronizar.ts (que
 * importa "server-only" y por eso no puede correr desde un script standalone
 * con tsx). Mismo endpoint público, ningún cambio de comportamiento — así el
 * pipeline RAG queda desacoplado del sync SQLite existente (plan G-02).
 */
const TIENDA = process.env.SHOPIFY_TIENDA ?? "https://www.sempertex.com";
const INVENTARIO_URL =
  process.env.SHOPIFY_INVENTARIO_URL ??
  "https://cdn.shopify.com/s/files/1/0983/2752/7703/files/products_catalog.json";
const PAGINAS_MAX = 30;

/** Un 4xx (URL/tienda mal configurada) nunca se arregla reintentando; un
 * fallo de red, timeout o 5xx sí suele ser transitorio. */
class ErrorHttp extends Error {
  constructor(mensaje: string, readonly status: number) {
    super(mensaje);
  }
}
function esReintentable(error: unknown): boolean {
  if (error instanceof ErrorHttp) return error.status >= 500;
  return true;
}

async function fetchJson<T>(url: string, timeoutMs: number, etiqueta: string): Promise<T> {
  return conReintento(
    async () => {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new ErrorHttp(`${etiqueta} respondió ${res.status}`, res.status);
      return (await res.json()) as T;
    },
    { esReintentable },
  );
}

export async function obtenerProductosPublicosRag(): Promise<ProductoPublico[]> {
  const productos: ProductoPublico[] = [];
  for (let pagina = 1; pagina <= PAGINAS_MAX; pagina++) {
    const url = `${TIENDA}/products.json?limit=250&page=${pagina}`;
    const datos = await fetchJson<{ products: ProductoPublico[] }>(url, 20_000, `products.json página ${pagina}`);
    if (!datos.products || datos.products.length === 0) break;
    productos.push(...datos.products);
  }
  return productos;
}

export async function obtenerInventarioCdnRag(): Promise<ProductoInventarioCDN[]> {
  return fetchJson<ProductoInventarioCDN[]>(INVENTARIO_URL, 30_000, "Inventario CDN");
}
