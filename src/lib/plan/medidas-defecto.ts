import type { PlanDecoracion, PlanDecoracion1_1 } from "./tipos";

type EspacioPlan = PlanDecoracion["espacio"] | PlanDecoracion1_1["espacio"];

function tieneMedidasEspacio(espacio: EspacioPlan): boolean {
  return espacio.ancho_m != null || espacio.alto_m != null || espacio.largo_m != null;
}

/** A length in meters or centimeters, or "3x4" / "3 por 4", in the customer's words. */
const MEDIDA_EN_TEXTO = /\b\d+(?:[.,]\d+)?\s*(?:m|mts?|metros?|cm|cent[ií]metros?)\b|\b\d+(?:[.,]\d+)?\s*(?:x|×|por)\s*\d+(?:[.,]\d+)?\b/i;

/** Whether the customer stated a physical size in the request or the brief. */
export function clienteDioMedidasEspacio(solicitudOriginal: string, espacioBrief?: unknown): boolean {
  // The brief is written by a tool call: its field is not guaranteed to be text.
  return MEDIDA_EN_TEXTO.test(solicitudOriginal) || (typeof espacioBrief === "string" && MEDIDA_EN_TEXTO.test(espacioBrief));
}

/**
 * Before signing, the server decides the source of the space measures from the
 * customer's evidence, not from the model: measures the customer gave are
 * `cliente` (even if the model wrote `foto`); measures without that evidence are
 * `supuesto` (even if the model wrote `foto` or `cliente`). Without measures the
 * model's source stays (a `foto` type is legitimate). Completing default
 * measures and normalizing `foto` + measures to `supuesto` belong to the
 * resolver (`_complete_plan` / `_normalize_space_source` in
 * services/ai-api/app/plan.py, locked by golden vector 17).
 */
export function aplicarFuenteMedidasEspacio<T extends PlanDecoracion>(plan: T, clienteDioMedidas: boolean): T {
  if (!tieneMedidasEspacio(plan.espacio)) return plan;
  const fuente = clienteDioMedidas ? "cliente" : "supuesto";
  return plan.espacio.fuente === fuente ? plan : { ...plan, espacio: { ...plan.espacio, fuente } };
}
