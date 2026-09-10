export type FiltrosDuros = {
  disponible?: boolean;
  precioMax?: number;
  categorias?: string[];
  ocasiones?: string[];
  colores?: string[];
  acabados?: string[];
  /** Forma física del globo (redondo, corazon, link, modelar). */
  formas?: string[];
  /** Diámetro exacto en pulgadas para globos redondos. */
  diametrosPulgadas?: number[];
};

/** Pool de productos/variantes permitido por una especialización LoRA. */
export type CatalogAllowlist = {
  productIds: readonly string[];
  variantIds: readonly string[];
};

/** Canonical open-event contract lives in query-parser/event-search.ts. */
import type { EventSearchIntent } from "../query-parser/event-search";
export type { EventSearchIntent } from "../query-parser/event-search";

export type EventMatchLevel = "exact_event" | "thematic" | "adaptable";

export type EventMatchEvidence = {
  match_level: EventMatchLevel;
  matched_signals: string[];
  relaxations: string[];
};

export type ConsultaRetrieval = {
  semanticQuery: string;
  filtros?: FiltrosDuros;
  /** Embedding ya calculado; evita otra llamada cuando un turno hace varias búsquedas. */
  embeddingPrecalculado?: number[];
  /** El proveedor de embedding opcional ya falló; no reintentar por cada rol/relajación. */
  embeddingFallido?: boolean;
  /** Consultas enfocadas por componente; se fusionan dentro de cada rama lexical. */
  focusedQueries?: readonly string[];
  /** Event terms are ranking text, never SQL predicates. */
  eventTerms?: readonly string[];
  eventIntent?: EventSearchIntent;
  allowlist?: CatalogAllowlist;
  /** Operational context for the optional Python reranking call. */
  rerankRequestId?: string;
  rerankCorrelationId?: string;
  rerankSignal?: AbortSignal;
  /** Absolute turn deadline shared by every retrieval branch and relaxation. */
  rerankDeadlineAt?: number;
};

export type EstadoSku = "not_sku" | "unique" | "ambiguous" | "not_found" | "filtered_out";
export type BranchStatus = "READY" | "EMPTY" | "SKIPPED_OPTIONAL" | "ERROR";

/** Contrato de salida: IDs reales y whitelist de variantes válidas para el LLM. */
export type ResultadoRetrieval = {
  productId: string;
  variantIds: string[];
  vectorScore: number;
  textScore: number;
  trigramScore?: number;
  demandScore?: number;
  finalScore: number;
  reasons?: string[];
  rrfContributions?: Array<{ branch: "fts" | "trigram" | "vector"; rank: number; contribution: number }>;
  eventEvidence?: EventMatchEvidence;
};

export type RespuestaRetrieval = {
  query: ConsultaRetrieval;
  results: ResultadoRetrieval[];
  skuStatus?: EstadoSku;
  branchStatus?: Record<string, BranchStatus>;
};
