import "server-only";
import { getDb } from "@/lib/db";
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

async function obtenerProductosPublicos(): Promise<ProductoPublico[]> {
  const productos: ProductoPublico[] = [];
  for (let pagina = 1; pagina <= PAGINAS_MAX; pagina++) {
    const url = `${TIENDA}/products.json?limit=250&page=${pagina}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
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

function persistir(productos: ProductoCanonico[]): void {
  const db = getDb();
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM shopify_variante");
    db.exec("DELETE FROM shopify_producto");
    db.exec("DELETE FROM shopify_fts");

    const insertarProducto = db.prepare(`
      INSERT INTO shopify_producto
        (id, handle, titulo, titulo_limpio, tipo, tags, descripcion_txt, descripcion_datos, categoria,
         colores, ocasiones, imagen_principal, imagenes, disponible, precio_min, precio_max, actualizado_en)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertarVariante = db.prepare(`
      INSERT INTO shopify_variante
        (id, producto_id, sku, titulo, option1, option2, precio, disponible, inventario,
         inventario_fuente, gramos, tamano_codigo, forma, diam_pulg, largo_pulg, ancho_cm, alto_cm,
         unidades_paq, unidades_inferidas)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertarFts = db.prepare(`
      INSERT INTO shopify_fts (id, titulo_limpio, descripcion_txt, tags, colores, ocasiones)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const ahora = new Date().toISOString();
    for (const p of productos) {
      insertarProducto.run(
        p.id,
        p.handle,
        p.titulo,
        p.tituloLimpio,
        p.tipo,
        JSON.stringify(p.tags),
        p.descripcionTxt,
        JSON.stringify(p.descripcionDatos),
        p.categoria,
        JSON.stringify(p.colores),
        JSON.stringify(p.ocasiones),
        p.imagenPrincipal,
        JSON.stringify(p.imagenes),
        p.disponible ? 1 : 0,
        p.precioMin,
        p.precioMax,
        ahora,
      );
      insertarFts.run(
        p.id,
        p.tituloLimpio,
        p.descripcionTxt ?? "",
        p.tags.join(" "),
        p.colores.join(" "),
        p.ocasiones.join(" "),
      );
      for (const v of p.variantes) {
        insertarVariante.run(
          v.id,
          p.id,
          v.sku,
          v.titulo,
          v.option1,
          v.option2,
          v.precio,
          v.disponible ? 1 : 0,
          v.inventario,
          v.inventarioFuente,
          v.gramos,
          v.tamanoCodigo,
          v.forma,
          v.diamPulg,
          v.largoPulg,
          v.anchoCm,
          v.altoCm,
          v.unidadesPaq,
          v.unidadesInferidas ? 1 : 0,
        );
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export type ResultadoSync = {
  productos: number;
  variantes: number;
  inventarioCruzado: number;
};

/**
 * Pipeline completo. Todo el fetch + procesamiento pasa por memoria ANTES de
 * tocar la base de datos: si products.json o el CDN fallan a mitad de
 * camino, el catálogo anterior sigue intacto — nunca se deja el demo sin
 * catálogo por un fallo de red a medias.
 */
export async function sincronizarCatalogo(): Promise<ResultadoSync> {
  const iniciadoEn = new Date().toISOString();
  const db = getDb();

  try {
    const [crudos, inventario] = await Promise.all([
      obtenerProductosPublicos(),
      obtenerInventarioCDN(),
    ]);

    const canonicos = crudos
      .filter((p) => !tipoExcluido(p.product_type))
      // Solo cotizable con precio > 0 en al menos una variante — el resto son
      // datos sucios (278 en B2B, 3 en B2C) que no deben llegar al cliente.
      .map((p) => canonizarProducto(p, inventario))
      .filter((p) => p.variantes.some((v) => v.precio > 0));

    persistir(canonicos);

    const variantes = canonicos.reduce((n, p) => n + p.variantes.length, 0);
    const inventarioCruzado = canonicos.reduce(
      (n, p) => n + p.variantes.filter((v) => v.inventarioFuente === "cdn").length,
      0,
    );

    db.prepare(
      `INSERT INTO shopify_sync (iniciado_en, terminado_en, productos, variantes, inventario_cruzado, error)
       VALUES (?, ?, ?, ?, ?, NULL)`,
    ).run(iniciadoEn, new Date().toISOString(), canonicos.length, variantes, inventarioCruzado);

    return { productos: canonicos.length, variantes, inventarioCruzado };
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "Error desconocido";
    db.prepare(
      `INSERT INTO shopify_sync (iniciado_en, terminado_en, productos, variantes, inventario_cruzado, error)
       VALUES (?, ?, NULL, NULL, NULL, ?)`,
    ).run(iniciadoEn, new Date().toISOString(), mensaje);
    throw error;
  }
}
