/**
 * Detector único de jerga interna en texto dirigido al cliente final: códigos,
 * identificadores, SKU, nombres de herramientas y términos técnicos que no
 * deben aparecer ni en los mensajes redactados por el backend ni en las
 * respuestas del asistente (docs/mejoras/PLAN-ESTRUCTURAS-Y-UX.md, A4).
 *
 * "R-12" y "techo" no son jerga prohibida: son vocabulario comercial y de
 * decoración ("globo de 12 pulgadas" es preferible, pero no se bloquea).
 */
const PATRONES_JERGA: ReadonlyArray<readonly [string, RegExp]> = [
  ["SKU", /\bsku\b/i],
  ["código en MAYÚSCULAS_CON_GUIONES", /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/],
  ["campo técnico snake_case", /\b[a-z]+(?:_[a-z0-9]+)+\b/],
  ["id de estructura", /\bEST_\d{2}/],
  ["id de referencia", /\bREF_\d{2}/],
  ["identificador numérico largo", /\b\d{11,}\b/],
  ["cobertura", /\bcobertura\b/i],
  ["límite", /\bl[ií]mites?\b/i],
  ["whitelist/allowlist", /\b(?:white|allow)list\b/i],
  ["término técnico", /\b(?:backend|prompt|lora|payload|hash|snapshot|preflight|status)\b/i],
];

/** Devuelve las etiquetas de los patrones de jerga presentes en `texto` (vacío si está limpio). */
export function detectarJergaInterna(texto: string): string[] {
  return PATRONES_JERGA.filter(([, patron]) => patron.test(texto)).map(([etiqueta]) => etiqueta);
}
