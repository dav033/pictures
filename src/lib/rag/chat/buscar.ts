import type { Pool } from "pg";
import { buscarHibrido, consultaTieneSku, RERANK_DEADLINE_MS } from "../retrieval/search";
import { embeddingOpcional } from "../embeddings";
import type { EventMatchEvidence, EstadoSku, ResultadoRetrieval } from "../retrieval/types";
import { parseEventSearchIntent, type EventSearchIntent } from "../query-parser/event-search";
import { interpretarConsulta } from "../query-parser/parse";
import { IntentQuerySchema, type IntentQuery } from "../query-parser/schema";
import type { ObservabilidadBusqueda, ResultadoBusquedaObservabilidad } from "../observability/types";
import type { CatalogAllowlist } from "../retrieval/types";
import { llamarPythonCatalogSearch, seleccionarBackendPython } from "@/lib/ia/python-adapter";
import { candidatoDesdePython } from "./candidato-python";
import { coloresRealesProducto } from "@/lib/plan/colores-producto";
import { recorrerEscalera } from "./relajacion-filtros";

export type OpcionesBusquedaRag = {
  /** Customer-verified filters; component wording cannot alter them. */
  filtrosDuros?: IntentQuery["filtros_duros"];
  eventIntent?: EventSearchIntent;
  focusedQueries?: readonly string[];
  allowlist?: CatalogAllowlist;
  rerankRequestId?: string;
  rerankCorrelationId?: string;
  rerankSignal?: AbortSignal;
  rerankDeadlineAt?: number;
  catalogSnapshotId?: string;
  /** Colors the design must reproduce that are not hard filters (the dominant
   * colors of a reference photo). They only let the ladder relax the occasion
   * when its hits leave one uncovered (`debeAplicarPaso`). */
  coloresContexto?: readonly string[];
};

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
  colores: string[];
};

export type ProductoCandidato = {
  productId: string;
  titulo: string;
  categoria: string | null;
  colores: string[];
  acabados: string[];
  ocasiones: string[];
  disponible: boolean;
  imagen: string | null;
  variantes: VarianteCandidata[];
  eventEvidence?: EventMatchEvidence;
};

export type ResultadoBusquedaRag = {
  status: "OK" | "NO_MATCH" | "AMBIGUOUS_SKU";
  skuStatus?: EstadoSku;
  catalogSnapshotId?: string;
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
  observabilidad: ObservabilidadBusqueda;
};

type FilaCandidato = {
  product_id: string;
  title: string;
  derived: { category: string | null; colors: string[]; finishes?: string[]; occasions: string[] };
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
  colores: string[];
  acabados: string[];
};

function observabilidadBusqueda(
  mensaje: string,
  eventIntent: EventSearchIntent,
  scores: ResultadoRetrieval[],
  status: ResultadoBusquedaRag["status"],
  filtroRelajado: ResultadoBusquedaRag["filtroRelajado"],
  focusedQueries?: readonly string[],
): ObservabilidadBusqueda {
  const candidateCountsByTier: ObservabilidadBusqueda["candidateCountsByTier"] = {
    exact_event: 0,
    thematic: 0,
    adaptable: 0,
  };
  for (const score of scores) {
    const nivel = score.eventEvidence?.match_level ?? "adaptable";
    candidateCountsByTier[nivel]++;
  }
  const outcome: ResultadoBusquedaObservabilidad = status === "NO_MATCH"
    ? "NO_MATCH"
    : status === "AMBIGUOUS_SKU"
      ? "aclaracion"
      : "candidatos";
  return {
    eventLabel: eventIntent.event_label,
    closedOccasionRecognized: eventIntent.occasion_filter.length > 0,
    componentQueries: [...new Set((focusedQueries?.length ? focusedQueries : [mensaje]).map((query) => query.trim()).filter(Boolean))],
    candidateCountsByTier,
    selectedPieces: [],
    relaxations: descripcionRelajacion(filtroRelajado),
    outcome,
    planningLatencyMs: 0,
  };
}

/** Catalog colors per retrieved product, for the occasion step of the ladder. */
async function coloresDeProductos(pool: Pool, productIds: readonly string[]): Promise<Array<{ colores: string[] }>> {
  const { rows } = await pool.query<{ colores: unknown }>(
    `SELECT COALESCE(derived->'colors', '[]'::jsonb) AS colores FROM catalog_products WHERE product_id = ANY($1::text[])`,
    [[...productIds]],
  );
  return rows.map((row) => ({ colores: Array.isArray(row.colores) ? row.colores.filter((color): color is string => typeof color === "string") : [] }));
}

function descripcionRelajacion(filtroRelajado: ResultadoBusquedaRag["filtroRelajado"]): string[] {
  return filtroRelajado ? [`${filtroRelajado} pasó de filtro duro a señal de ranking`] : [];
}

function observabilidadConRerank(
  observabilidad: ObservabilidadBusqueda,
  branchStatus: Record<string, string> | undefined,
): ObservabilidadBusqueda {
  const status = branchStatus?.rerank;
  return status === "READY" || status === "SKIPPED_OPTIONAL" || status === "ERROR"
    ? { ...observabilidad, rerankStatus: status }
    : observabilidad;
}

async function buscarCatalogoPython(
  mensaje: string,
  opciones: OpcionesBusquedaRag,
): Promise<ResultadoBusquedaRag> {
  const filtros = opciones.filtrosDuros;
  // Python reads an empty allowlist as "unrestricted". A restricted mode that
  // authorizes nothing must fail closed here, never widen to the whole catalog.
  if (opciones.allowlist && opciones.allowlist.entries.length === 0) {
    return {
      status: "NO_MATCH",
      candidatos: [],
      intent: null,
      scores: [],
      latencyParseMs: 0,
      latencyRetrievalMs: 0,
      filtroRelajado: null,
      observabilidad: {
        eventLabel: null,
        closedOccasionRecognized: Boolean(filtros?.ocasiones?.length),
        componentQueries: [mensaje],
        candidateCountsByTier: { exact_event: 0, thematic: 0, adaptable: 0 },
        selectedPieces: [],
        relaxations: [],
        outcome: "NO_MATCH",
        planningLatencyMs: 0,
      },
    };
  }
  const deadlineAt = opciones.rerankDeadlineAt ?? Date.now() + RERANK_DEADLINE_MS;
  const requestId = opciones.rerankRequestId ?? crypto.randomUUID();
  const correlationId = opciones.rerankCorrelationId ?? opciones.rerankRequestId ?? requestId;
  // Real product→variant entries; the service owns how they filter rows.
  const allowlist = opciones.allowlist
    ? opciones.allowlist.entries.map((entry) => ({ product_id: entry.productId, variant_ids: [...entry.variantIds] }))
    : [];
  const llamar = (paso: IntentQuery["filtros_duros"] | undefined) => llamarPythonCatalogSearch({
    message: mensaje,
    filters: {
      available: paso?.solo_disponibles ?? true,
      ...(paso?.precio_max === null || paso?.precio_max === undefined ? {} : { price_max: paso.precio_max }),
      ...(paso?.categorias?.length ? { categories: paso.categorias } : {}),
      ...(paso?.ocasiones?.length ? { occasions: paso.ocasiones } : {}),
      ...(paso?.colores?.length ? { colors: paso.colores } : {}),
      ...(paso?.acabados?.length ? { finishes: paso.acabados } : {}),
      ...(paso?.formas?.length ? { shapes: paso.formas } : {}),
      ...(paso?.diametros_pulgadas?.length ? { diameters_inches: paso.diametros_pulgadas } : {}),
    },
    allowlist,
    requestId,
    correlationId,
    deadlineMs: Math.max(1, deadlineAt - Date.now()),
    parentSignal: opciones.rerankSignal,
    ...(opciones.catalogSnapshotId === undefined ? {} : { catalogSnapshotId: opciones.catalogSnapshotId }),
  });
  // Same ladder as the TypeScript path. Search is read-only, so repeating it
  // with fewer verified filters duplicates no effect; the shared deadline
  // bounds the total, and a step is skipped once that deadline has passed.
  const primera = await llamar(filtros);
  const { respuesta: response, relajado: filtroRelajado } = filtros
    ? await recorrerEscalera(filtros, primera, {
        buscar: llamar,
        cantidad: (respuesta) => respuesta.candidates.length,
        colores: (respuesta) => respuesta.candidates.map((candidate) => ({ colores: coloresRealesProducto(candidate.title, candidate.colors) })),
        coloresContexto: opciones.coloresContexto,
        puedeSeguir: (respuesta) => respuesta.status !== "AMBIGUOUS_SKU" && Date.now() < deadlineAt,
      })
    : { respuesta: primera, relajado: null };
  const scores: ResultadoRetrieval[] = response.candidates.map((candidate) => ({
    productId: candidate.product_id,
    variantIds: candidate.variants.map((variant) => variant.variant_id),
    vectorScore: 0,
    textScore: candidate.score,
    trigramScore: candidate.score,
    finalScore: candidate.score,
  }));
  const candidatos: ProductoCandidato[] = response.candidates.map(candidatoDesdePython);
  const status = response.status === "OK"
    ? "candidatos"
    : response.status === "AMBIGUOUS_SKU" ? "aclaracion" : "NO_MATCH";
  return {
    status: response.status,
    skuStatus: response.sku_status ?? undefined,
    catalogSnapshotId: response.catalog_snapshot_id ?? undefined,
    candidatos,
    intent: null,
    scores,
    latencyParseMs: response.latency_parse_ms,
    latencyRetrievalMs: response.latency_retrieval_ms,
    filtroRelajado,
    observabilidad: {
      eventLabel: null,
      closedOccasionRecognized: Boolean(filtros?.ocasiones?.length),
      componentQueries: [mensaje],
      candidateCountsByTier: {
        exact_event: 0,
        thematic: 0,
        adaptable: scores.length,
      },
      selectedPieces: [],
      relaxations: descripcionRelajacion(filtroRelajado),
      outcome: status,
      planningLatencyMs: 0,
    },
  };
}

/**
 * search_products (plan §4.2): interpreta la consulta, recupera candidatos
 * reales del catálogo y los devuelve. NUNCA genera lenguaje para el cliente
 * ni decide la selección final — eso lo hace el LLM después, y el backend lo
 * vuelve a validar en confirmar_seleccion_rag.
 */
export async function buscarCatalogoRag(
  pool: Pool,
  mensaje: string,
  opciones: OpcionesBusquedaRag = {},
): Promise<ResultadoBusquedaRag> {
  const rerankDeadlineAt = opciones.rerankDeadlineAt ?? Date.now() + RERANK_DEADLINE_MS;
  if (seleccionarBackendPython().backend === "python") {
    return buscarCatalogoPython(mensaje, { ...opciones, rerankDeadlineAt });
  }
  const t0 = Date.now();
  const parseado = await interpretarConsulta(mensaje);
  // Semantic retrieval uses component text. Hard SQL filters come only from
  // the original customer context when the caller supplies them.
  const intento: IntentQuery = opciones.filtrosDuros
    ? IntentQuerySchema.parse({ ...parseado, filtros_duros: opciones.filtrosDuros })
    : parseado;
  const eventIntent = opciones.eventIntent ?? parseEventSearchIntent(mensaje);
  const latencyParseMs = Date.now() - t0;

  if (intento.intent !== "product_search") {
    return { status: "NO_MATCH", skuStatus: "not_sku", candidatos: [], intent: intento, scores: [], latencyParseMs, latencyRetrievalMs: 0, filtroRelajado: null, observabilidad: observabilidadBusqueda(mensaje, eventIntent, [], "NO_MATCH", null, opciones.focusedQueries) };
  }

  const t1 = Date.now();
  let embeddingFallido = false;
  const embeddingPrecalculado = consultaTieneSku(intento.semantic_query)
    ? undefined
    : await embeddingOpcional(
      intento.semantic_query,
      opciones.rerankSignal,
      rerankDeadlineAt,
      () => { embeddingFallido = true; },
      opciones.rerankRequestId
        ? { requestId: opciones.rerankRequestId, correlationId: opciones.rerankCorrelationId ?? opciones.rerankRequestId }
        : undefined,
    );

  const buscarPaso = (filtros: IntentQuery["filtros_duros"]) => buscarHibrido(pool, {
    semanticQuery: intento.semantic_query,
    focusedQueries: opciones.focusedQueries,
    eventTerms: eventIntent.event_terms,
    eventIntent,
    allowlist: opciones.allowlist,
    rerankRequestId: opciones.rerankRequestId,
    rerankCorrelationId: opciones.rerankCorrelationId,
    rerankSignal: opciones.rerankSignal,
    rerankDeadlineAt,
    embeddingPrecalculado,
    embeddingFallido,
    filtros: {
      disponible: filtros.solo_disponibles,
      precioMax: filtros.precio_max ?? undefined,
      categorias: filtros.categorias.length ? filtros.categorias : undefined,
      formas: filtros.formas.length ? filtros.formas : undefined,
      acabados: filtros.acabados.length ? filtros.acabados : undefined,
      diametrosPulgadas: filtros.diametros_pulgadas.length ? filtros.diametros_pulgadas : undefined,
      ocasiones: filtros.ocasiones.length ? filtros.ocasiones : undefined,
      colores: filtros.colores.length ? filtros.colores : undefined,
    },
  });
  let respuesta = await buscarPaso(intento.filtros_duros);

  // Never expose ambiguous exact SKU candidates to the model as a normal
  // selectable pool. The client must clarify which exact variant it means.
  if (respuesta.skuStatus === "ambiguous") {
    return {
      status: "AMBIGUOUS_SKU",
      skuStatus: respuesta.skuStatus,
      candidatos: [],
      intent: intento,
      scores: [],
      latencyParseMs,
      latencyRetrievalMs: Date.now() - t1,
      filtroRelajado: null,
      observabilidad: observabilidadConRerank(
        observabilidadBusqueda(mensaje, eventIntent, [], "AMBIGUOUS_SKU", null, opciones.focusedQueries),
        respuesta.branchStatus,
      ),
    };
  }

  // Escalera de relajación (plan de tamaños §6): un tamaño/forma pedido
  // explícito es un requisito FÍSICO (tiene que caber en la estructura) y
  // nunca se relaja. "Ocasión" y "color" son etiquetas más blandas — se
  // sueltan ANTES que el tamaño, en ese orden, solo cuando la combinación
  // completa da cero resultados. Sin esto, "globos rojos de 5 pulgadas para
  // cumpleaños" puede caer a NO_MATCH aunque sí existan globos rojos R-5
  // (solo que ninguno tiene la etiqueta de ocasión "cumpleanos"). El orden
  // vive en `escaleraRelajacion`, compartido con el backend Python.
  const escalera = await recorrerEscalera(intento.filtros_duros, respuesta, {
    buscar: buscarPaso,
    cantidad: (resultado) => resultado.results.length,
    colores: (resultado) => coloresDeProductos(pool, resultado.results.map((result) => result.productId)),
    coloresContexto: opciones.coloresContexto,
  });
  respuesta = escalera.respuesta;
  const filtroRelajado: ResultadoBusquedaRag["filtroRelajado"] = escalera.relajado;
  const latencyRetrievalMs = Date.now() - t1;

  if (respuesta.results.length === 0) {
    return {
      status: "NO_MATCH",
      skuStatus: respuesta.skuStatus,
      candidatos: [],
      intent: intento,
      scores: [],
      latencyParseMs,
      latencyRetrievalMs,
      filtroRelajado: null,
      observabilidad: observabilidadConRerank(
        observabilidadBusqueda(mensaje, eventIntent, [], "NO_MATCH", null, opciones.focusedQueries),
        respuesta.branchStatus,
      ),
    };
  }

  const ids = respuesta.results.map((r) => r.productId);
  // `buscarHibrido` ya calculó, por producto, cuáles variantes pasan el
  // filtro de precio/disponibilidad (retrieval/search.ts:finalVariantWhitelist,
  // una consulta SQL real). Fase 3.4: esa whitelist se pasa aquí como
  // `AND v.variant_id = ANY($2)` en vez de traer TODAS las variantes del
  // producto y descartar en JS después — mismo conjunto exacto, sin la
  // ronda de filas descartadas. Antes de que existiera el filtro (ni en SQL
  // ni en JS) esta función pedía TODAS las variantes del producto sin
  // restricción, así que un producto que entraba por su variante barata
  // podía mostrarle al LLM (y luego cotizar) una variante muy por encima del
  // presupuesto del cliente — de ahí que la whitelist tenga que ser exacta,
  // no solo una optimización de rendimiento.
  const variantesPermitidas = respuesta.results.flatMap((r) => r.variantIds);
  const { rows } = await pool.query<FilaCandidato>(
    `SELECT p.product_id, p.title, p.derived, p.available, p.image_urls[1] AS imagen_principal,
            v.variant_id, v.sku, v.title AS variante_titulo, v.price, v.available AS variante_disponible,
            v.codigo_tamano, v.diam_pulg, v.forma, v.derived_colors AS colores
     FROM catalog_products p
     JOIN catalog_variants v ON v.product_id = p.product_id
     WHERE p.product_id = ANY($1::text[])
       AND v.variant_id = ANY($2::text[])
     ORDER BY v.diam_pulg ASC NULLS LAST`,
    [ids, variantesPermitidas],
  );

  const porProducto = new Map<string, ProductoCandidato>();
  for (const fila of rows) {
    if (!porProducto.has(fila.product_id)) {
      porProducto.set(fila.product_id, {
        productId: fila.product_id,
        titulo: fila.title,
        categoria: fila.derived.category,
         colores: fila.derived.colors,
         acabados: fila.derived.finishes ?? [],
        ocasiones: fila.derived.occasions,
        disponible: fila.available,
        imagen: fila.imagen_principal,
        variantes: [],
        eventEvidence: respuesta.results.find((result) => result.productId === fila.product_id)?.eventEvidence,
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
      colores: fila.colores,
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
    skuStatus: respuesta.skuStatus,
    candidatos,
    intent: intento,
    scores: respuesta.results,
    latencyParseMs,
    latencyRetrievalMs,
    filtroRelajado,
    observabilidad: observabilidadConRerank(
      observabilidadBusqueda(mensaje, eventIntent, respuesta.results, "OK", filtroRelajado, opciones.focusedQueries),
      respuesta.branchStatus,
    ),
  };
}
