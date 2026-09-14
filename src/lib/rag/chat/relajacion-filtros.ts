import type { IntentQuery } from "../query-parser/schema";

type FiltrosDuros = IntentQuery["filtros_duros"];

export type FiltroRelajable = "ocasiones" | "colores";

export type PasoRelajacion = {
  filtros: FiltrosDuros;
  /** Filter dropped at this step; null for the original request. */
  relajado: FiltroRelajable | null;
};

/**
 * Relaxation ladder (plan de tamaños §6), single owner for both search
 * backends. An explicit size, shape, finish, category, price or availability
 * is a physical or commercial requirement and is never relaxed. Occasion and
 * color are softer catalog tags: most generic balloons carry no occasion tag,
 * so they are dropped, in that order, only when the previous step returned
 * zero results. Each step keeps every earlier relaxation. The caller runs the
 * steps in order, stops at the first non-empty result and reports that step's
 * `relajado` so the model tells the customer instead of substituting silently.
 *
 * The ladder decides which already-verified filters to send; the catalog
 * predicates themselves stay with the backend (TS SQL or Python
 * `_base_query`). Nothing here can add a filter or widen an allowlist.
 */
function normalizarColor(color: string): string {
  return color.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

/** Requested colors that no candidate carries (exact catalog color, accent-insensitive). */
export function coloresSinCubrir(coloresPedidos: readonly string[], candidatos: ReadonlyArray<{ colores: readonly string[] }>): string[] {
  const disponibles = new Set(candidatos.flatMap((candidato) => candidato.colores.map(normalizarColor)));
  return coloresPedidos.filter((color) => !disponibles.has(normalizarColor(color)));
}

/**
 * Whether the caller runs the next ladder step. Any step runs after zero
 * results. The occasion step also runs when the occasion-tagged hits leave a
 * requested color uncovered: in the LoRA pool only a printed "Happy Birthday"
 * balloon carries `cumpleanos`, so "azul, blanco y dorado para un cumpleaños"
 * returned that single product and the plan could not cover blue or white.
 * Color itself is still relaxed only on zero results.
 */
export function debeAplicarPaso(
  siguiente: PasoRelajacion,
  filtrosOriginales: FiltrosDuros,
  candidatos: ReadonlyArray<{ colores: readonly string[] }>,
): boolean {
  if (candidatos.length === 0) return true;
  return siguiente.relajado === "ocasiones" && coloresSinCubrir(filtrosOriginales.colores, candidatos).length > 0;
}

export function escaleraRelajacion(filtros: FiltrosDuros): PasoRelajacion[] {
  const pasos: PasoRelajacion[] = [{ filtros, relajado: null }];
  let actual = filtros;
  if (filtros.ocasiones.length > 0) {
    actual = { ...actual, ocasiones: [] };
    pasos.push({ filtros: actual, relajado: "ocasiones" });
  }
  if (filtros.colores.length > 0) {
    actual = { ...actual, colores: [] };
    pasos.push({ filtros: actual, relajado: "colores" });
  }
  return pasos;
}
