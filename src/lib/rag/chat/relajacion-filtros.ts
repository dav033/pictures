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
 * color uncovered: in the LoRA pool only a printed "Happy Birthday" balloon
 * carries `cumpleanos`, so "azul, blanco y dorado para un cumpleaños" returned
 * that single product and the plan could not cover blue or white.
 *
 * The colors to cover are the customer's hard colors (request and brief, already
 * in `filtrosOriginales.colores`) plus `coloresContexto`: colors the design must
 * reproduce that are not hard filters, such as the dominant colors of a
 * reference photo (E2E 2026-09-15: "Semiarcos rosa y plata" + "para un
 * cumpleaños" kept only printed birthday balloons, so pink and silver never
 * came back and the model looped). Context colors only decide whether the
 * occasion is relaxed; they never become a catalog filter. Color itself is
 * still relaxed only on zero results.
 */
export function debeAplicarPaso(
  siguiente: PasoRelajacion,
  filtrosOriginales: FiltrosDuros,
  candidatos: ReadonlyArray<{ colores: readonly string[] }>,
  coloresContexto: readonly string[] = [],
): boolean {
  if (candidatos.length === 0) return true;
  return siguiente.relajado === "ocasiones" && coloresSinCubrir(coloresACubrir(filtrosOriginales, coloresContexto), candidatos).length > 0;
}

/** Hard colors plus context colors, without duplicates (accent-insensitive). */
export function coloresACubrir(filtros: FiltrosDuros, coloresContexto: readonly string[] = []): string[] {
  const colores: string[] = [];
  for (const color of [...filtros.colores, ...coloresContexto]) {
    if (color.trim() && !colores.some((otro) => normalizarColor(otro) === normalizarColor(color))) colores.push(color);
  }
  return colores;
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

type ColoresCandidatos = ReadonlyArray<{ colores: readonly string[] }>;

/**
 * Runs the ladder after the first (unrelaxed) search, for both backends. Each
 * step keeps the previous result when it returns nothing, and stops at the
 * first step `debeAplicarPaso` does not ask for. `colores` gives the catalog
 * colors of a result (it may query the catalog, so it is only called when a step
 * could need them); `puedeSeguir` stops early (ambiguous SKU, deadline).
 */
export async function recorrerEscalera<R>(
  filtros: FiltrosDuros,
  primera: R,
  opciones: {
    buscar: (filtros: FiltrosDuros) => Promise<R>;
    cantidad: (respuesta: R) => number;
    colores: (respuesta: R, paso: PasoRelajacion) => ColoresCandidatos | Promise<ColoresCandidatos>;
    coloresContexto?: readonly string[];
    puedeSeguir?: (respuesta: R) => boolean;
  },
): Promise<{ respuesta: R; relajado: FiltroRelajable | null }> {
  let respuesta = primera;
  let relajado: FiltroRelajable | null = null;
  for (const paso of escaleraRelajacion(filtros).slice(1)) {
    if (opciones.puedeSeguir && !opciones.puedeSeguir(respuesta)) break;
    const necesitaColores = opciones.cantidad(respuesta) > 0 && paso.relajado === "ocasiones" && coloresACubrir(filtros, opciones.coloresContexto).length > 0;
    const coloresCandidatos = necesitaColores
      ? await opciones.colores(respuesta, paso)
      : Array.from({ length: opciones.cantidad(respuesta) }, () => ({ colores: [] as string[] }));
    if (!debeAplicarPaso(paso, filtros, coloresCandidatos, opciones.coloresContexto)) break;
    const previa = respuesta;
    respuesta = await opciones.buscar(paso.filtros);
    if (opciones.cantidad(respuesta) > 0) relajado = paso.relajado;
    else if (opciones.cantidad(previa) > 0) {
      respuesta = previa;
      break;
    }
  }
  return { respuesta, relajado };
}
