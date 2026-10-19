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
/**
 * La única forma en que un código de color llega a FLUX: pegado entre paréntesis al nombre de su color,
 * «vivid pink (#E04B87)». FLUX.2 respeta el hex, y sin él pintaba pasteles donde la foto tenía colores fuertes
 * (pedido del dueño, 2026-10-06, commit 1043386). Lo escribe `colorDeReferencia`.
 */
export function hexPegado(color: string, hex: string): string {
  return `${color} (#${hex.replace(/^#/, "").toUpperCase()})`;
}

/** Un hex pegado tal como lo escribe `hexPegado`, para quitarlo antes de mirar la forma del resto del texto. */
export const HEX_PEGADO = /(?<=[A-Za-z]) \(#[0-9A-Fa-f]{6}\)/g;

/**
 * Un código hex suelto: cualquiera que no sea exactamente «<palabra> (#RRGGBB)». Suelto, el código se leía como un
 * globo más de la lista («satin pearlescent white, #F7F7F5 and …») o como texto que escribir (producción,
 * 2026-10-06, guiada-20261006-220821-ci54dg). Con 8 cifras (alfa) o mal cerrado, también es suelto.
 */
const HEX_SUELTO = String.raw`(?:(?<![A-Za-z] \()#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?\b|#[0-9A-Fa-f]{8}\b|#[0-9A-Fa-f]{6}\b(?!\)))`;
/** El hex suelto con los paréntesis que lo rodeen, si los tiene. */
const UNIDAD_HEX_SUELTO = String.raw`(?:\(\s*${HEX_SUELTO}\s*\)|${HEX_SUELTO})`;

const PALABRAS_SOLO_FLUX: ReadonlyArray<{ patron: RegExp; etiqueta: string; reemplazo: string }> = [
  { patron: /\beventdecor_\w+/gi, etiqueta: "trigger de LoRA", reemplazo: "" },
  { patron: /\b(?:Reflex|Fashion|Silk)\b/g, etiqueta: "nombre de línea comercial", reemplazo: "" },
  { patron: /\b(?:Crystal|Pastel)\b(?= [A-ZÁÉÍÓÚÑ])/g, etiqueta: "nombre de línea comercial", reemplazo: "" },
  { patron: /\bLink-O-Loon\b/gi, etiqueta: "marca registrada", reemplazo: "linking" },
  { patron: /[®™]/g, etiqueta: "marca registrada", reemplazo: "" },
  // El hex pegado a su color se queda; el suelto se va con lo que lo une a la lista: tras una coma, al frente de un
  // «and» o solo.
  { patron: new RegExp(String.raw`,\s*${UNIDAD_HEX_SUELTO}`, "g"), etiqueta: "código de color hex suelto", reemplazo: "" },
  { patron: new RegExp(String.raw`${UNIDAD_HEX_SUELTO}\s+and\s+`, "g"), etiqueta: "código de color hex suelto", reemplazo: "" },
  { patron: new RegExp(String.raw`\s*${UNIDAD_HEX_SUELTO}`, "g"), etiqueta: "código de color hex suelto", reemplazo: "" },
];

/** Etiquetas de las palabras solo-LoRA presentes en el texto (vacío si no hay ninguna). */
export function palabrasSoloFlux(texto: string): string[] {
  return [...new Set(PALABRAS_SOLO_FLUX.filter(({ patron }) => new RegExp(patron.source, patron.flags).test(texto)).map(({ etiqueta }) => etiqueta))];
}

/**
 * Quita del texto base las palabras solo-LoRA y devuelve cuáles quitó, para
 * que el llamador lo deje en diagnóstico (fallback observable).
 */
export function limpiarTextoBase(texto: string): { texto: string; quitadas: string[] } {
  const quitadas = new Set<string>();
  let limpio = texto;
  for (const { patron, reemplazo } of PALABRAS_SOLO_FLUX) {
    limpio = limpio.replace(patron, (encontrada) => {
      quitadas.add(encontrada);
      return reemplazo;
    });
  }
  if (!quitadas.size) return { texto, quitadas: [] };
  limpio = limpio.replace(/[ \t]{2,}/g, " ").replace(/ +([,.;:])/g, "$1").replace(/^[ ,;:]+| +$/gm, "");
  return { texto: limpio, quitadas: [...quitadas] };
}
