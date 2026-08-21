/**
 * Filtros DUROS (plan §3.9/§3.11): se aplican en SQL antes del ranking, nunca
 * comparando números vía embeddings. Todo lo que sea "preferencia" en vez de
 * requerimiento estricto va en `semanticQuery`, no aquí — convertir toda
 * preferencia en filtro duro puede devolver cero resultados sin necesidad.
 */
export type FiltrosDuros = {
  disponible?: boolean;
  precioMax?: number;
  categorias?: string[];
  ocasiones?: string[];
  colores?: string[];
  /** Forma física del globo (redondo, corazon, link, modelar) — no el tamaño. */
  formas?: string[];
  /** Diámetro exacto en pulgadas para globos redondos (5, 9, 12, 18, 24, 36). */
  diametrosPulgadas?: number[];
};

export type ConsultaRetrieval = {
  semanticQuery: string;
  filtros?: FiltrosDuros;
  /** Embedding ya calculado para `semanticQuery` — evita recalcularlo cuando
   * el mismo turno hace varias búsquedas por rol (§3, Etapa 2 del plan de
   * franjas de presupuesto): un solo embedding por turno, no uno por rol. */
  embeddingPrecalculado?: number[];
};

/** Contrato de salida (plan §3.12): solo productos candidatos, sin lenguaje para el usuario. */
export type ResultadoRetrieval = {
  productId: string;
  variantIds: string[];
  vectorScore: number;
  textScore: number;
  /** Score de fusión (Reciprocal Rank Fusion) — solo sirve para ORDENAR, no
   * es una similitud ni una probabilidad, su magnitud no es comparable entre
   * consultas distintas. */
  finalScore: number;
};

export type RespuestaRetrieval = {
  query: ConsultaRetrieval;
  results: ResultadoRetrieval[];
};
