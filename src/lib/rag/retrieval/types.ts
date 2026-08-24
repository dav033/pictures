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

export type ConsultaRetrieval = {
  semanticQuery: string;
  filtros?: FiltrosDuros;
  /** Embedding ya calculado; evita otra llamada cuando un turno hace varias búsquedas. */
  embeddingPrecalculado?: number[];
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
};

export type RespuestaRetrieval = {
  query: ConsultaRetrieval;
  results: ResultadoRetrieval[];
  skuStatus?: EstadoSku;
  branchStatus?: Record<string, BranchStatus>;
};
