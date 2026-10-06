import type { PlanDecoracion, PlanDecoracion1_1 } from "./tipos";

type EspacioPlan = PlanDecoracion["espacio"] | PlanDecoracion1_1["espacio"];

function tieneMedidasEspacio(espacio: EspacioPlan): boolean {
  return espacio.ancho_m != null || espacio.alto_m != null || espacio.largo_m != null;
}

/** A length in meters or centimeters, or "3x4" / "3 por 4", in the customer's words. */
const MEDIDA_EN_TEXTO = /\b\d+(?:[.,]\d+)?\s*(?:m|mts?|metros?|cm|cent[ií]metros?)\b|\b\d+(?:[.,]\d+)?\s*(?:x|×|por)\s*\d+(?:[.,]\d+)?\b/i;

/**
 * Whether the customer stated a physical size in their own messages
 * (`solicitudOriginal` joins every customer message of the conversation).
 * The brief is not evidence: `guardar_brief` is a model tool call, so a number
 * in `brief.espacio` can be one the model invented, and it would make those
 * measures the customer's and freeze them against the photo's count
 * (ADR-0031, amendment 2026-09-28).
 */
export function clienteDioMedidasEspacio(solicitudOriginal: string): boolean {
  return MEDIDA_EN_TEXTO.test(solicitudOriginal);
}

/** Piezas nombradas junto a una medida explícita en el mensaje del cliente. */
export function estructurasMedidasPorCliente(
  estructuras: ReadonlyArray<Pick<PlanDecoracion["estructuras"][number], "estructura_id" | "tipo" | "nombre">>,
  solicitudOriginal: string,
): string[] {
  const normalizar = (texto: string) => texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const alias: Readonly<Record<string, readonly string[]>> = {
    arco: ["arco", "semiarco", "medio arco"],
    arco_organico: ["arco", "arco organico", "semiarco", "medio arco"],
    semiarco: ["semiarco", "medio arco", "arco"],
    columna: ["columna", "columnas", "columna clasica", "columna organica"],
    columna_organica: ["columna", "columnas", "columna organica"],
    pared: ["pared", "paredes"],
    pared_organica: ["pared", "paredes", "pared organica"],
  };
  const tramos = normalizar(solicitudOriginal).split(/[.!?;,\n]|\s+y\s+/u).filter((tramo) => MEDIDA_EN_TEXTO.test(tramo));
  const salida = new Set<string>();
  const descriptores = ["izquierda", "izquierdo", "derecha", "derecho", "central", "principal", "primera", "segundo", "segunda"];
  for (const tramo of tramos) {
    const candidatas = estructuras.filter((estructura) => {
      const palabras = [estructura.tipo, ...(alias[estructura.tipo] ?? [])].map(normalizar);
      return palabras.some((palabra) => new RegExp(`\\b${palabra}\\b`, "u").test(tramo));
    });
    if (candidatas.length === 1) {
      salida.add(candidatas[0]!.estructura_id);
      continue;
    }
    const descriptor = descriptores.find((palabra) => new RegExp(`\\b${palabra}\\b`, "u").test(tramo));
    const nombradas = descriptor
      ? candidatas.filter((estructura) => normalizar(estructura.nombre).includes(descriptor))
      : candidatas.filter((estructura) => new RegExp(`\\b${normalizar(estructura.nombre)}\\b`, "u").test(tramo));
    if (nombradas.length === 1) salida.add(nombradas[0]!.estructura_id);
  }
  return [...salida];
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
