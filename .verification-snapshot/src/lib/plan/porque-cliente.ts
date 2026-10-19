import type { PlanDecoracion } from "./tipos";

/**
 * `estructuras[].porque` is shown to the customer in the structure detail, but
 * the model wrote it in its own working language (E2E 2026-09-14: "Materializa
 * la columna de globos observada a la izquierda de la imagen de referencia.").
 * The tool schema and the prompt ask for a customer sentence; this removes the
 * known internal wording that still gets through before the plan is signed.
 * It never invents content: an explanation left empty falls back to a neutral
 * sentence. Pure.
 */
const REEMPLAZOS: ReadonlyArray<readonly [RegExp, string]> = [
  // Internal ids and snake_case fields.
  [/\b(?:REF|EST)_[A-Z0-9_]+\b/g, ""],
  [/\b([a-z]+)_([a-z0-9_]+)\b/g, "$1 $2"],
  // The analyzed photo, in the customer's words.
  [/\b(?:en|de|según|como en|desde) (?:la|una) (?:imagen|foto|fotografía) de referencia\b/gi, "de tu foto"],
  [/\b(?:en|de|según|como en|desde) la referencia(?: visual)?\b/gi, "como en tu foto"],
  [/\b(?:en|de) la imagen\b/gi, "de tu foto"],
  [/\bla (?:imagen|foto) de referencia\b/gi, "tu foto"],
  [/\bla referencia visual\b/gi, "tu foto"],
  // Model working verbs.
  [/\bMaterializa(?:r|mos)?\b/g, "Recrea"],
  [/\bmaterializa(?:r|mos)?\b/g, "recrea"],
  [/\s+observad[oa]s?\b/gi, ""],
];

const PORQUE_NEUTRO = "Pieza de tu decoración.";

export function sanearPorque(porque: string): string {
  let texto = porque;
  for (const [patron, reemplazo] of REEMPLAZOS) texto = texto.replace(patron, reemplazo);
  texto = texto
    .replace(/\s+([.,;:])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!/[\p{L}]/u.test(texto)) return PORQUE_NEUTRO;
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export function sanearPorquesPlan<T extends PlanDecoracion>(plan: T): T {
  return { ...plan, estructuras: plan.estructuras.map((estructura) => ({ ...estructura, porque: sanearPorque(estructura.porque) })) };
}
