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

/** Rol que un candidato cumple dentro de una búsqueda por rol
 * (`retrieval/por-rol.ts`): cada rol se busca por separado, con sus propias
 * categorías y su propio tope de precio por variante. */
export type RolPresupuesto = "focal" | "soporte" | "relleno" | "acento" | "servicio";

/** Cuota de un rol para `buscarPorRol`: cuántas piezas admite y con qué tope
 * de precio por variante, más las categorías que puede tocar (y las que
 * admite si la escalera de relajación tiene que ampliarlas). */
export type CuotaPlan = {
  rol: RolPresupuesto;
  max: number;
  /** Precio máximo en COP para UNA variante de este rol. */
  topeCop: number;
  categorias: readonly string[];
  categoriasRelajacion: readonly string[];
};

/** Variantes permitidas de un producto real; vacío = producto sin variantes explícitas. */
export type CatalogAllowlistEntry = {
  readonly productId: string;
  readonly variantIds: readonly string[];
};

/**
 * Pool de productos/variantes permitido por una especialización LoRA.
 * `entries` conserva la asociación producto→variante; `productIds` y
 * `variantIds` son derivados. Construir solo con `crearCatalogAllowlist`.
 */
export type CatalogAllowlist = {
  readonly entries: readonly CatalogAllowlistEntry[];
  readonly productIds: readonly string[];
  readonly variantIds: readonly string[];
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
