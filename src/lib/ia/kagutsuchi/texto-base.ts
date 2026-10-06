/**
 * Palabras que solo entendía un LoRA entrenado. FLUX base lee un nombre de
 * línea comercial ("Reflex Dorado", "Fashion Coral") como una marca o un texto
 * que escribir, y un trigger como texto plano. El compilador las quita al
 * construir el texto en vez de que el preflight rechace la imagen; el
 * preflight conserva la misma lista como invariante (nunca debería dispararse).
 *
 * Las líneas comerciales distinguen mayúsculas a propósito: "pastel" o
 * "crystal" en minúscula son los adjetivos que el texto base sí usa. Pastel y
 * Crystal, que también abren una frase como adjetivos, solo cuentan delante de
 * otra palabra con mayúscula (el título de un producto: "Pastel Dusk").
 */
const PALABRAS_SOLO_LORA: ReadonlyArray<{ patron: RegExp; etiqueta: string; reemplazo: string }> = [
  { patron: /\beventdecor_\w+/gi, etiqueta: "trigger de LoRA", reemplazo: "" },
  { patron: /\b(?:Reflex|Fashion|Silk)\b/g, etiqueta: "nombre de línea comercial", reemplazo: "" },
  { patron: /\b(?:Crystal|Pastel)\b(?= [A-ZÁÉÍÓÚÑ])/g, etiqueta: "nombre de línea comercial", reemplazo: "" },
  { patron: /\bLink-O-Loon\b/gi, etiqueta: "marca registrada", reemplazo: "linking" },
  { patron: /[®™]/g, etiqueta: "marca registrada", reemplazo: "" },
];

/** Etiquetas de las palabras solo-LoRA presentes en el texto (vacío si no hay ninguna). */
export function palabrasSoloLora(texto: string): string[] {
  return [...new Set(PALABRAS_SOLO_LORA.filter(({ patron }) => new RegExp(patron.source, patron.flags).test(texto)).map(({ etiqueta }) => etiqueta))];
}

/**
 * Quita del texto base las palabras solo-LoRA y devuelve cuáles quitó, para
 * que el llamador lo deje en diagnóstico (fallback observable).
 */
export function limpiarTextoBase(texto: string): { texto: string; quitadas: string[] } {
  const quitadas = new Set<string>();
  let limpio = texto;
  for (const { patron, reemplazo } of PALABRAS_SOLO_LORA) {
    limpio = limpio.replace(patron, (encontrada) => {
      quitadas.add(encontrada);
      return reemplazo;
    });
  }
  if (!quitadas.size) return { texto, quitadas: [] };
  limpio = limpio.replace(/[ \t]{2,}/g, " ").replace(/ +([,.;:])/g, "$1").replace(/^[ ,;:]+| +$/gm, "");
  return { texto: limpio, quitadas: [...quitadas] };
}
