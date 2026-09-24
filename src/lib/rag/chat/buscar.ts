import type { Pool } from "pg";
import { RERANK_DEADLINE_MS } from "../retrieval/search";
import type { EventMatchEvidence, EstadoSku, ResultadoRetrieval } from "../retrieval/types";
import type { EventSearchIntent } from "../query-parser/event-search";
import type { IntentQuery } from "../query-parser/schema";
import type { ObservabilidadBusqueda } from "../observability/types";
import type { CatalogAllowlist } from "../retrieval/types";
import { llamarPythonCatalogSearch } from "@/lib/ia/python-adapter";
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

function descripcionRelajacion(filtroRelajado: ResultadoBusquedaRag["filtroRelajado"]): string[] {
  return filtroRelajado ? [`${filtroRelajado} pasó de filtro duro a señal de ranking`] : [];
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
  return buscarCatalogoPython(mensaje, { ...opciones, rerankDeadlineAt });
}
