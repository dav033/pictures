import "server-only";
import {
  decodificarTamano,
  decodificarUnidadesPaquete,
  derivarCategoria,
  derivarColores,
  derivarOcasiones,
  limpiarTitulo,
  tipoExcluido,
} from "./derivar";
import { enriquecerDescripcion } from "./enriquecer-descripcion";
import type {
  ProductoCanonico,
  ProductoInventarioCDN,
  ProductoPublico,
  VarianteCanonica,
} from "./tipos";

const TIENDA = process.env.SHOPIFY_TIENDA ?? "https://www.sempertex.com";
const INVENTARIO_URL =
  process.env.SHOPIFY_INVENTARIO_URL ??
  "https://cdn.shopify.com/s/files/1/0983/2752/7703/files/products_catalog.json";

const PAGINAS_MAX = 30; // 1.735 productos / 250 por página ≈ 7 — 30 es margen de sobra.

// Sin User-Agent la tienda responde 429 («Retry-After: 60») a todo, aunque sea la primera petición; con cualquiera pasa.
const CABECERAS_TIENDA = { "User-Agent": "demo-decoracion-catalogo/1.0" } as const;

async function obtenerProductosPublicos(): Promise<ProductoPublico[]> {
  const productos: ProductoPublico[] = [];
  for (let pagina = 1; pagina <= PAGINAS_MAX; pagina++) {
    const url = `${TIENDA}/products.json?limit=250&page=${pagina}`;
    const res = await fetch(url, { headers: CABECERAS_TIENDA, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`products.json página ${pagina} respondió ${res.status}`);
    const datos = (await res.json()) as { products: ProductoPublico[] };
    if (!datos.products || datos.products.length === 0) break;
    productos.push(...datos.products);
  }
  return productos;
}

/** sku → inventoryQuantity, cruzando por SKU sin el prefijo "B2B-" del CDN. */
async function obtenerInventarioCDN(): Promise<Map<string, number>> {
  const mapa = new Map<string, number>();
  const res = await fetch(INVENTARIO_URL, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Inventario CDN respondió ${res.status}`);
  const productos = (await res.json()) as ProductoInventarioCDN[];
  for (const producto of productos) {
    for (const variante of producto.variants ?? []) {
      if (!variante.sku) continue;
      const skuLimpio = variante.sku.replace(/^B2B-/i, "");
      mapa.set(skuLimpio, variante.inventoryQuantity);
    }
  }
  return mapa;
}

function canonizarProducto(p: ProductoPublico, inventario: Map<string, number>): ProductoCanonico {
  const tags = p.tags ?? [];
  const descripcionDatos = enriquecerDescripcion(p.body_html);
  const descripcionTxt = descripcionDatos.textoCompleto;
  const variantes: VarianteCanonica[] = (p.variants ?? []).map((v) => {
    const tamano = decodificarTamano(v.option1);
    const unidadesPaq = decodificarUnidadesPaquete(v.option2);
    const inv = v.sku ? inventario.get(v.sku) : undefined;
    return {
      id: String(v.id),
      sku: v.sku,
      titulo: v.title,
      option1: v.option1,
      option2: v.option2,
      precio: Number(v.price) || 0,
      disponible: Boolean(v.available),
      inventario: inv ?? null,
      inventarioFuente: inv !== undefined ? "cdn" : null,
      gramos: v.grams ?? 0,
      tamanoCodigo: v.option1,
      forma: tamano?.forma ?? null,
      diamPulg: tamano?.diamPulg ?? null,
      largoPulg: tamano?.largoPulg ?? null,
      anchoCm: tamano?.anchoCm ?? null,
      altoCm: tamano?.altoCm ?? null,
      // Default 1 con bandera unidadesInferidas: nunca inventar un tamaño de
      // paquete que no existe, porque un error aquí multiplica la cotización.
      unidadesPaq: unidadesPaq ?? 1,
      unidadesInferidas: unidadesPaq === null,
    };
  });

  const precios = variantes.map((v) => v.precio).filter((p) => p > 0);
  const tituloLimpio = limpiarTitulo(p.title.replace(/^B2B\s*/i, ""));

  return {
    id: String(p.id),
    handle: p.handle,
    titulo: p.title,
    tituloLimpio,
    tipo: p.product_type,
    tags,
    descripcionTxt,
    descripcionDatos,
    categoria: derivarCategoria(p.product_type, tags),
    colores: derivarColores(tags, p.title),
    ocasiones: derivarOcasiones(tags, p.title),
    imagenPrincipal: p.images?.[0]?.src ?? null,
    imagenes: (p.images ?? []).map((img) => img.src).slice(0, 12),
    disponible: variantes.some((v) => v.disponible),
    precioMin: precios.length ? Math.min(...precios) : null,
    precioMax: precios.length ? Math.max(...precios) : null,
    variantes,
  };
}

/**
 * Descarga el catálogo público (products.json + inventario del CDN) y lo deja en su forma canónica, ya filtrado a lo
 * cotizable. No toca ninguna base: quien lo llama decide si lo persiste (el sync) o lo congela (el snapshot).
 */
export async function descargarCatalogoCanonico(): Promise<ProductoCanonico[]> {
  const [crudos, inventario] = await Promise.all([obtenerProductosPublicos(), obtenerInventarioCDN()]);
  return crudos
    .filter((p) => !tipoExcluido(p.product_type))
    // Solo cotizable con precio > 0 en al menos una variante — el resto son
    // datos sucios (278 en B2B, 3 en B2C) que no deben llegar al cliente.
    .map((p) => canonizarProducto(p, inventario))
    .filter((p) => p.variantes.some((v) => v.precio > 0));
}
