import type { Pool } from "pg";
import { buscarHibrido } from "../retrieval/search";
import type { ResultadoRetrieval } from "../retrieval/types";
import { interpretarConsulta } from "../query-parser/parse";
import type { IntentQuery } from "../query-parser/schema";

export type VarianteCandidata = {
  variantId: string;
  sku: string | null;
  titulo: string | null;
  precio: number;
  disponible: boolean;
  /** Código de catálogo tal cual ("R-12") — para que el LLM cite el mismo código que ve el cliente. */
  codigoTamano: string | null;
  /** Diámetro real en pulgadas (solo globo redondo) — la señal que le faltaba al LLM para no elegir por defecto. */
  diamPulg: number | null;
  forma: string | null;
};

export type ProductoCandidato = {
  productId: string;
  titulo: string;
  categoria: string | null;
  colores: string[];
  ocasiones: string[];
  disponible: boolean;
  imagen: string | null;
  variantes: VarianteCandidata[];
};

export type ResultadoBusquedaRag = {
  status: "OK" | "NO_MATCH";
  candidatos: ProductoCandidato[];
  // Para trazabilidad (plan §6.1/§6.2) — no se usan para responderle al
  // cliente, solo para poder reconstruir después "por qué salió esto".
  intent: IntentQuery | null;
  scores: ResultadoRetrieval[];
  latencyParseMs: number;
  latencyRetrievalMs: number;
  /** Filtro que se relajó para no devolver cero resultados (plan de tamaños
   * §6) — null si la búsqueda original ya encontró algo. El LLM debe
   * decírselo al cliente, nunca sustituir en silencio. */
  filtroRelajado: "ocasiones" | "colores" | null;
};

type FilaCandidato = {
  product_id: string;
  title: string;
  derived: { category: string | null; colors: string[]; occasions: string[] };
  available: boolean;
  imagen_principal: string | null;
  variant_id: string;
  sku: string | null;
  variante_titulo: string | null;
  price: string;
  variante_disponible: boolean;
  codigo_tamano: string | null;
  diam_pulg: string | null;
  forma: string | null;
};

/**
 * search_products (plan §4.2): interpreta la consulta, recupera candidatos
 * reales del catálogo y los devuelve. NUNCA genera lenguaje para el cliente
 * ni decide la selección final — eso lo hace el LLM después, y el backend lo
 * vuelve a validar en confirmar_seleccion_rag.
 */
export async function buscarCatalogoRag(pool: Pool, mensaje: string): Promise<ResultadoBusquedaRag> {
  const t0 = Date.now();
  const intento = await interpretarConsulta(mensaje);
  const latencyParseMs = Date.now() - t0;

  if (intento.intent !== "product_search") {
    return { status: "NO_MATCH", candidatos: [], intent: intento, scores: [], latencyParseMs, latencyRetrievalMs: 0, filtroRelajado: null };
  }

  const filtrosBase = {
    disponible: intento.filtros_duros.solo_disponibles,
    precioMax: intento.filtros_duros.precio_max ?? undefined,
    categorias: intento.filtros_duros.categorias.length ? intento.filtros_duros.categorias : undefined,
    formas: intento.filtros_duros.formas.length ? intento.filtros_duros.formas : undefined,
    diametrosPulgadas: intento.filtros_duros.diametros_pulgadas.length ? intento.filtros_duros.diametros_pulgadas : undefined,
  };
  const ocasiones = intento.filtros_duros.ocasiones.length ? intento.filtros_duros.ocasiones : undefined;
  const colores = intento.filtros_duros.colores.length ? intento.filtros_duros.colores : undefined;

  const t1 = Date.now();
  let respuesta = await buscarHibrido(pool, { semanticQuery: intento.semantic_query, filtros: { ...filtrosBase, ocasiones, colores } });
  let filtroRelajado: ResultadoBusquedaRag["filtroRelajado"] = null;

  // Escalera de relajación (plan de tamaños §6): un tamaño/forma pedido
  // explícito es un requisito FÍSICO (tiene que caber en la estructura) y
  // nunca se relaja. "Ocasión" y "color" son etiquetas más blandas — se
  // sueltan ANTES que el tamaño, en ese orden, solo cuando la combinación
  // completa da cero resultados. Sin esto, "globos rojos de 5 pulgadas para
  // cumpleaños" puede caer a NO_MATCH aunque sí existan globos rojos R-5
  // (solo que ninguno tiene la etiqueta de ocasión "cumpleanos").
  if (respuesta.results.length === 0 && ocasiones) {
    respuesta = await buscarHibrido(pool, { semanticQuery: intento.semantic_query, filtros: { ...filtrosBase, colores } });
    if (respuesta.results.length > 0) filtroRelajado = "ocasiones";
  }
  if (respuesta.results.length === 0 && colores) {
    respuesta = await buscarHibrido(pool, { semanticQuery: intento.semantic_query, filtros: { ...filtrosBase } });
    if (respuesta.results.length > 0) filtroRelajado = "colores";
  }
  const latencyRetrievalMs = Date.now() - t1;

  if (respuesta.results.length === 0) {
    return { status: "NO_MATCH", candidatos: [], intent: intento, scores: [], latencyParseMs, latencyRetrievalMs, filtroRelajado: null };
  }

  const ids = respuesta.results.map((r) => r.productId);
  const { rows } = await pool.query<FilaCandidato>(
    `SELECT p.product_id, p.title, p.derived, p.available, p.image_urls[1] AS imagen_principal,
            v.variant_id, v.sku, v.title AS variante_titulo, v.price, v.available AS variante_disponible,
            v.codigo_tamano, v.diam_pulg, v.forma
     FROM catalog_products p
     JOIN catalog_variants v ON v.product_id = p.product_id
     WHERE p.product_id = ANY($1::text[])
     ORDER BY v.diam_pulg ASC NULLS LAST`,
    [ids],
  );

  // `buscarHibrido` ya calculó, por producto, cuáles variantes pasan el
  // filtro de precio/disponibilidad (retrieval/search.ts) — ese cálculo NO
  // se repite aquí. Antes esta función volvía a pedir TODAS las variantes
  // del producto sin filtro, así que un producto que entraba por su
  // variante barata podía mostrarle al LLM (y luego cotizar) una variante
  // muy por encima del presupuesto del cliente. Se restringe a esa
  // whitelist para que lo que ve el LLM sea exactamente lo que pasó el filtro.
  const variantesPermitidasPorProducto = new Map<string, Set<string>>(
    respuesta.results.map((r) => [r.productId, new Set(r.variantIds)]),
  );

  const porProducto = new Map<string, ProductoCandidato>();
  for (const fila of rows) {
    const permitidas = variantesPermitidasPorProducto.get(fila.product_id);
    if (permitidas && !permitidas.has(fila.variant_id)) continue;

    if (!porProducto.has(fila.product_id)) {
      porProducto.set(fila.product_id, {
        productId: fila.product_id,
        titulo: fila.title,
        categoria: fila.derived.category,
        colores: fila.derived.colors,
        ocasiones: fila.derived.occasions,
        disponible: fila.available,
        imagen: fila.imagen_principal,
        variantes: [],
      });
    }
    porProducto.get(fila.product_id)!.variantes.push({
      variantId: fila.variant_id,
      sku: fila.sku,
      titulo: fila.variante_titulo,
      precio: Number(fila.price),
      disponible: fila.variante_disponible,
      codigoTamano: fila.codigo_tamano,
      diamPulg: fila.diam_pulg != null ? Number(fila.diam_pulg) : null,
      forma: fila.forma,
    });
  }

  // Un producto cuyas variantes quedaron TODAS fuera de la whitelist (ej.
  // pasó el filtro duro por metadatos pero ninguna variante real cabe en el
  // presupuesto) no debe aparecer como candidato vacío.
  for (const [productId, producto] of porProducto) {
    if (producto.variantes.length === 0) porProducto.delete(productId);
  }

  // Mismo orden que devolvió el retrieval (ya rankeado), no el orden de la fila SQL.
  const candidatos = ids.map((id) => porProducto.get(id)).filter((p): p is ProductoCandidato => p !== undefined);

  return {
    status: "OK",
    candidatos,
    intent: intento,
    scores: respuesta.results,
    latencyParseMs,
    latencyRetrievalMs,
    filtroRelajado,
  };
}
