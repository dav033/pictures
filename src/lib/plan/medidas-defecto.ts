import type { EstructuraPlan, EstructuraPlan1_1, PlanDecoracion, PlanDecoracion1_1 } from "./tipos";

type Medidas = { ancho_m?: number; alto_m?: number; largo_m?: number };
const EXTERIOR = /jard[ií]n|exterior|terraza|playa|patio|campo/i;

const DEFAULTS: Record<EstructuraPlan["tipo"], { interior: Medidas; exterior: Medidas; texto: string }> = {
  arco: { interior: { ancho_m: 3, alto_m: 2.4 }, exterior: { ancho_m: 4, alto_m: 2.6 }, texto: "ancho × alto" },
  // Semiarco: ancho = alcance horizontal de la curva. Con el eje de cuarto de
  // elipse, 1,2 × 2,2 m y 1,5 × 2,4 m dan 2,73 m y 3,10 m de eje, casi los
  // 2,4 m y 3 m que tenían los defaults anteriores (misma escala de globos).
  semiarco: { interior: { ancho_m: 1.2, alto_m: 2.2 }, exterior: { ancho_m: 1.5, alto_m: 2.4 }, texto: "ancho × alto" },
  guirnalda: { interior: { largo_m: 2.5 }, exterior: { largo_m: 3.5 }, texto: "largo" },
  columna: { interior: { alto_m: 1.8 }, exterior: { alto_m: 2 }, texto: "alto" },
  pared: { interior: { ancho_m: 2.4, alto_m: 2.4 }, exterior: { ancho_m: 3, alto_m: 2.4 }, texto: "ancho × alto" },
  centro_mesa: { interior: { ancho_m: 0.4, alto_m: 0.5 }, exterior: { ancho_m: 0.4, alto_m: 0.5 }, texto: "diámetro × alto" },
  backdrop: { interior: {}, exterior: {}, texto: "" },
  kit: { interior: {}, exterior: {}, texto: "" },
  accesorio: { interior: {}, exterior: {}, texto: "" },
};

type EspacioPlan = PlanDecoracion["espacio"] | PlanDecoracion1_1["espacio"];

function tieneMedidasEspacio(espacio: EspacioPlan): boolean {
  return espacio.ancho_m != null || espacio.alto_m != null || espacio.largo_m != null;
}

/**
 * The model does not measure photos (E2E 2026-09-14: a venue with a ceiling
 * above 5 m came back as `{ancho_m: 3, largo_m: 3, alto_m: 2.5, fuente: "foto"}`
 * and the UI said "I measured your space from the photo"). `fuente: "foto"`
 * only states that the TYPE of space was seen in a photo; any numeric space
 * measure without customer data is an estimate. Rule, applied by both
 * resolvers when completing the plan (mirror: `_normalize_space_source` in
 * services/ai-api/app/plan.py): `fuente: "foto"` with any of
 * `ancho_m`/`alto_m`/`largo_m` becomes `fuente: "supuesto"`, keeping the
 * numbers. Contract for the UI:
 * - `fuente: "foto"` never carries measures (type seen in the photo);
 * - measures with `fuente: "supuesto"` are estimates the customer should confirm;
 * - measures with `fuente: "cliente"` came from the customer
 *   (`aplicarFuenteMedidasEspacio` checks that evidence before signing).
 */
export function normalizarFuenteEspacio<T extends EspacioPlan>(espacio: T): T {
  return espacio.fuente === "foto" && tieneMedidasEspacio(espacio) ? { ...espacio, fuente: "supuesto" } : espacio;
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
 * model's source stays (a `foto` type is legitimate).
 */
export function aplicarFuenteMedidasEspacio<T extends PlanDecoracion>(plan: T, clienteDioMedidas: boolean): T {
  if (!tieneMedidasEspacio(plan.espacio)) return plan;
  const fuente = clienteDioMedidas ? "cliente" : "supuesto";
  return plan.espacio.fuente === fuente ? plan : { ...plan, espacio: { ...plan.espacio, fuente } };
}

export function completarMedidas(plan: PlanDecoracion): PlanDecoracion {
  const exterior = EXTERIOR.test(plan.espacio.tipo);
  const supuestos = [...plan.supuestos];
  const estructuras = plan.estructuras.map((estructura) => {
    if (["backdrop", "kit", "accesorio"].includes(estructura.tipo)) return estructura;
    const defaults = DEFAULTS[estructura.tipo][exterior ? "exterior" : "interior"];
    const medidas = { ...defaults, ...estructura.medidas };
    const faltaban = Object.keys(defaults).some((key) => (estructura.medidas as Record<string, unknown>)[key] == null);
    if (faltaban) {
      const valores = [medidas.ancho_m, medidas.alto_m, medidas.largo_m].filter((value): value is number => value != null);
      const texto = valores.length === 1 ? `${valores[0]} m` : valores.map((value) => `${value} m`).join(" × ");
      supuestos.push(`medidas asumidas para ${estructura.tipo}: ${texto} — no nos diste el tamaño del espacio`);
    }
    return { ...estructura, medidas };
  });
  return { ...plan, espacio: normalizarFuenteEspacio(plan.espacio), estructuras, supuestos: [...new Set(supuestos)] };
}

/**
 * Plan 1.1: idéntica lógica, pero `escultura` se suma al grupo que nunca
 * recibe medidas geométricas por defecto (PLAN-COMPOSICION-RICA-V001.md
 * §10.1 — "reconocer escultura sin inventar medidas ni geometría"). Una
 * araña no tiene ancho×alto de despiece; su cantidad sale de
 * `unidades_por_instancia`, no de `DEFAULTS`.
 */
export function completarMedidas1_1(plan: PlanDecoracion1_1): PlanDecoracion1_1 {
  const exterior = EXTERIOR.test(plan.espacio.tipo);
  const supuestos = [...plan.supuestos];
  const estructuras = plan.estructuras.map((estructura): EstructuraPlan1_1 => {
    if (["backdrop", "kit", "accesorio", "escultura"].includes(estructura.tipo)) return estructura;
    const defaults = DEFAULTS[estructura.tipo as EstructuraPlan["tipo"]][exterior ? "exterior" : "interior"];
    const medidas = { ...defaults, ...estructura.medidas };
    const faltaban = Object.keys(defaults).some((key) => (estructura.medidas as Record<string, unknown>)[key] == null);
    if (faltaban) {
      const valores = [medidas.ancho_m, medidas.alto_m, medidas.largo_m].filter((value): value is number => value != null);
      const texto = valores.length === 1 ? `${valores[0]} m` : valores.map((value) => `${value} m`).join(" × ");
      supuestos.push(`medidas asumidas para ${estructura.tipo}: ${texto} — no nos diste el tamaño del espacio`);
    }
    return { ...estructura, medidas };
  });
  return { ...plan, espacio: normalizarFuenteEspacio(plan.espacio), estructuras, supuestos: [...new Set(supuestos)] };
}
