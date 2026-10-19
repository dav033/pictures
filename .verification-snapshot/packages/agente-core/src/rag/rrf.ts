/** Un ranking ya resuelto (lista de ids en orden de relevancia) más el peso
 * de su rama en la fusión final. `peso` por defecto 1 — útil cuando solo se
 * fusiona un ranking o todas las ramas pesan igual. */
export type RankingConPeso = {
  ids: readonly string[];
  peso?: number;
};

const RRF_K_DEFECTO = 60;

/**
 * Reciprocal Rank Fusion: combina N listas rankeadas por posición (no por
 * score) en un único score comparable. Pura — no sabe qué es un producto ni
 * de dónde salió cada ranking, solo IDs en orden.
 *
 * Fusiona por posición y no por score normalizado porque los scores de
 * ramas distintas (ej. similitud coseno vs. ts_rank de full-text) no son
 * comparables entre sí — sumar/normalizar esos números mezcla escalas
 * arbitrarias, mientras que la posición dentro de cada ranking sí es
 * universal (Cormack et al. 2009).
 */
export function fusionarRankings(rankings: RankingConPeso[], opciones?: { k?: number }): Map<string, number> {
  const k = opciones?.k ?? RRF_K_DEFECTO;
  const fusionado = new Map<string, number>();

  for (const { ids, peso = 1 } of rankings) {
    ids.forEach((id, i) => {
      fusionado.set(id, (fusionado.get(id) ?? 0) + peso / (k + i + 1));
    });
  }

  return fusionado;
}
