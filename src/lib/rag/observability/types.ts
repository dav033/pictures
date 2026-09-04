import type { EventMatchLevel } from "../retrieval/types";

export type ResultadoBusquedaObservabilidad = "candidatos" | "NO_MATCH" | "aclaracion" | "plan_confirmado";

export type NivelCandidatos = Record<EventMatchLevel, number>;

export type PiezaObservabilidad = {
  productId: string;
  variantId?: string;
  rol?: string;
  matchLevel: EventMatchLevel;
};

/** Metadata acotada para medir eventos abiertos sin guardar prompts ni payloads. */
export type ObservabilidadBusqueda = {
  eventLabel: string | null;
  closedOccasionRecognized: boolean;
  componentQueries: string[];
  candidateCountsByTier: NivelCandidatos;
  selectedPieces: PiezaObservabilidad[];
  relaxations: string[];
  outcome: ResultadoBusquedaObservabilidad;
  planningLatencyMs?: number;
};

export const nivelesCandidatosVacios = (): NivelCandidatos => ({
  exact_event: 0,
  thematic: 0,
  adaptable: 0,
});

export function contarNivelesCandidatos(
  candidates: Array<{ matchLevel?: EventMatchLevel }>,
): NivelCandidatos {
  const counts = nivelesCandidatosVacios();
  for (const candidate of candidates) counts[candidate.matchLevel ?? "adaptable"]++;
  return counts;
}
