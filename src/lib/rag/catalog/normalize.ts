import {
  decodificarTamano,
  decodificarUnidadesPaquete,
  derivarCategoria,
  derivarColores,
  derivarOcasiones,
  limpiarTitulo,
  tipoExcluido,
} from "@/lib/shopify/derivar";
import type { ProductoInventarioCDN, ProductoPublico } from "@/lib/shopify/tipos";
import { enriquecerDescripcion } from "@/lib/shopify/enriquecer-descripcion";
import { construirSearchText, hashSearchText, sanitizeTexto, sanitizeTextoNullable } from "./sanitize";
import { CatalogProductSchema, CatalogVariantSchema, type CatalogProduct, type CatalogRejection, type CatalogVariant } from "./schemas";
import { clasificarAcabados, clasificarCategorias, clasificarColores, clasificarOcasiones } from "../taxonomy/v2";
import { deriveSceneCapabilities, type DeriveSceneCapabilitiesResult } from "./derive-scene-capabilities";

function normalizarColoresV2(values: string[]): string[] {
  const unique = [...new Set(values)];
  return unique.includes("dorado rosa") ? unique.filter((value) => value !== "dorado" && value !== "rosado") : unique;
}

export type ResultadoNormalizacion =
  | {
      ok: true;
      producto: CatalogProduct;
      variantes: CatalogVariant[];
      /**
       * Capacidades de escena candidatas (Tarea 03.1, PLAN_ARQUITECTURA_ESCENA_
       * COMPLETA_RAG.md), derivadas determinísticamente del mismo `producto` ya
       * normalizado — campo aditivo: los llamadores existentes que solo
       * desestructuran `{ producto, variantes }` (p. ej.
       * `scripts/import-shopify-catalog.ts`) siguen funcionando sin cambios.
       */
      capabilities: DeriveSceneCapabilitiesResult;
    }
  | { ok: false; rechazo: CatalogRejection };

/** sku (sin prefijo "B2B-") → cantidad de inventario, igual que el sync existente. */
export function mapaInventarioCDN(productos: ProductoInventarioCDN[]): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const producto of productos) {
    for (const variante of producto.variants ?? []) {
      if (!variante.sku) continue;
      mapa.set(variante.sku.replace(/^B2B-/i, ""), variante.inventoryQuantity);
    }
  }
  return mapa;
}

/**
 * RAW Shopify → modelo canónico (plan Fase 2). Ningún campo factual sale de
 * un LLM: todo viene de `raw` o de una derivación determinística y auditable
 * (derivar.ts). Si algo esencial falta, se rechaza con motivo explícito en
 * vez de inventarlo.
 */
export function normalizarProducto(
  raw: ProductoPublico,
  inventario: Map<string, number>,
): ResultadoNormalizacion {
  const sourceId = raw?.id != null ? String(raw.id) : null;

  if (!raw.id) {
    return { ok: false, rechazo: { source_id: null, reason: "sin product_id", raw_payload: raw } };
  }
  if (!raw.handle || sanitizeTexto(raw.handle).length === 0) {
    return { ok: false, rechazo: { source_id: sourceId, reason: "sin handle", raw_payload: raw } };
  }
  if (!raw.title || sanitizeTexto(raw.title).length === 0) {
    return { ok: false, rechazo: { source_id: sourceId, reason: "sin title", raw_payload: raw } };
  }
  if (tipoExcluido(raw.product_type)) {
    return {
      ok: false,
      rechazo: { source_id: sourceId, reason: `product_type excluido (${raw.product_type})`, raw_payload: raw },
    };
  }

  const tags = (raw.tags ?? []).map((t) => sanitizeTexto(t)).filter((t) => t.length > 0);
  const tituloLimpio = limpiarTitulo(sanitizeTexto(raw.title.replace(/^B2B\s*/i, "")));
  const descripcionTexto = sanitizeTextoNullable(enriquecerDescripcion(raw.body_html).textoCompleto);
  const taxonomyText = [...tags, tituloLimpio, raw.product_type ?? ""].join(" ").replace(/[-_/]+/g, " ");
  const v2Colors = clasificarColores(taxonomyText).values;
  const colores = v2Colors.length ? normalizarColoresV2(v2Colors) : derivarColores(tags, tituloLimpio);
  const v2Occasions = clasificarOcasiones(taxonomyText).values;
  const ocasiones = [...new Set([...v2Occasions, ...derivarOcasiones(tags, tituloLimpio)])];
  const acabados = [...new Set(clasificarAcabados(taxonomyText).values)];
  // Match canonical CDN precedence: a title such as Decor-Kit wins over a
  // stale Shopify product_type such as LATEX.
  const titleCategory = clasificarCategorias(tituloLimpio.replace(/[-_/]+/g, " ")).values[0] ?? null;
  const categoria = titleCategory ?? derivarCategoria(raw.product_type, tags) ?? clasificarCategorias(taxonomyText).values[0] ?? null;

  const variantesRaw = raw.variants ?? [];
  const variantesValidas = variantesRaw.filter((v) => Number(v.price) > 0);

  if (variantesValidas.length === 0) {
    return {
      ok: false,
      rechazo: { source_id: sourceId, reason: "ninguna variante con precio > 0", raw_payload: raw },
    };
  }

  const variantes: CatalogVariant[] = variantesValidas.map((v) => {
    const inv = v.sku ? inventario.get(v.sku) : undefined;
    // option1 es donde Shopify guarda el código de tamaño real ("R-12", "16
    // IN"…) — misma columna que decodifica el catálogo SQLite
    // (sincronizar.ts), aquí replicado para que Postgres tenga el mismo dato.
    const tamano = decodificarTamano(v.option1 ?? null);
    const tituloVariante = v.title ? sanitizeTexto(v.title) : null;
    const unidadesPaq = decodificarUnidadesPaquete(v.option2 ?? null) ?? decodificarUnidadesPaquete(tituloVariante);
    const variantText = (v.title ?? "").replace(/[-_/]+/g, " ");
    const productTitleColors = clasificarColores(raw.title.replace(/[-_/]+/g, " ")).values;
    const explicitVariantColors = clasificarColores(variantText).values;
    const titleSpecificColors = productTitleColors.filter((value) => value !== "multicolor");
    const directColors = explicitVariantColors.length === 1 && explicitVariantColors[0] === "multicolor"
      ? (titleSpecificColors.length ? ["multicolor", ...titleSpecificColors] : explicitVariantColors)
      : explicitVariantColors;
    const variantColors = /\bESCARCHAD[AO]?\b/i.test(variantText)
      ? []
      : directColors.length > 0
        ? directColors
        : productTitleColors;
    return CatalogVariantSchema.parse({
      variant_id: String(v.id),
      product_id: String(raw.id),
      sku: v.sku ?? null,
      title: tituloVariante,
      price: Number(v.price),
      currency: "COP",
      inventory_quantity: inv ?? null,
      inventory_source: inv !== undefined ? "cdn" : null,
      available: Boolean(v.available),
      options: { option1: v.option1 ?? null, option2: v.option2 ?? null, option3: v.option3 ?? null },
      image_url: null,
      source_payload: v,
      codigo_tamano: v.option1 ?? null,
      forma: tamano?.forma ?? null,
      diam_pulg: tamano?.diamPulg ?? null,
      largo_pulg: tamano?.largoPulg ?? null,
      ancho_cm: tamano?.anchoCm ?? null,
      alto_cm: tamano?.altoCm ?? null,
      derived_colors: variantColors.length ? variantColors : colores.length === 1 ? colores : [],
      unidades_paq: unidadesPaq,
      unidades_inferidas: unidadesPaq === null,
    });
  });

  const precios = variantes.map((v) => v.price);
  const imageUrls = (raw.images ?? []).map((img) => img.src).filter(Boolean);

  const skus = variantes.map((v) => v.sku).filter((s): s is string => Boolean(s));

  const searchText = construirSearchText({
    titulo: tituloLimpio,
    categoria,
    descripcion: descripcionTexto,
    tags,
    colores,
    ocasiones,
    acabados,
    skus,
  });

  const producto = CatalogProductSchema.parse({
    product_id: String(raw.id),
    handle: raw.handle,
    title: tituloLimpio,
    description_text: descripcionTexto,
    vendor: null,
    product_type: raw.product_type ?? null,
    tags,
    image_urls: imageUrls,
    status: "ACTIVE",
    available: variantes.some((v) => v.available),
    price_min: precios.length ? Math.min(...precios) : null,
    price_max: precios.length ? Math.max(...precios) : null,
     derived: { category: categoria, colors: colores, finishes: acabados, occasions: ocasiones },
    source_payload: raw,
    search_text: searchText,
    embedding_source_hash: hashSearchText(searchText),
    source_updated_at: raw.updated_at ?? null,
  });

  const capabilities = deriveSceneCapabilities(producto);

  return { ok: true, producto, variantes, capabilities };
}
