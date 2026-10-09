/**
 * ¿El mensaje de la persona corrige a la IA («no, eso no», «no es lo que pedí», «deshaz eso»)? Entonces la respuesta anterior se
 * cuenta como deshecha y se abre el «por qué» (REQ-010). Muy conservador: un «no» suelto, una duda o un elogio («no estoy segura»,
 * «no, esa me encanta», «no así está perfecto», «eso no lo sé todavía») NO son correcciones, y un falso positivo ensucia los datos
 * que se quieren para ver los huecos de la IA. Cada patrón es una frase que empieza el mensaje, con fronteras de palabra.
 */

/** «no, eso no lo sé», «no, eso no tengo»: la persona responde una pregunta, no corrige. */
const NO_ES_CORRECCION = String.raw`(?!\s+(lo|la|se|tengo|hay|puedo|conozco|recuerdo|se\b)\b)`;

const CORRECCIONES: readonly RegExp[] = [
  new RegExp(String.raw`^no[,.!\s]+(eso|esa|ese|esto|asi) no\b${NO_ES_CORRECCION}`),
  /^no (era|es) (eso|esa|ese)[.!\s]*$/,
  /\bno es (lo que|eso lo que) (pedi|dije|queria|quiero)\b/,
  /\bno (te )?(pedi|dije) (eso|esa|ese)\b/,
  /^no me gusta[.!\s]*$/,
  /^no (me )?(sirve|funciona|convence)[.!\s]*$/,
  /^(esta|quedo|quedaron) (mal|incorrect[oa]s?|feo|fea)\b/,
  /^(te equivocaste|equivocaste|incorrecto|incorrecta|fallaste|mal)[.!\s]*$/,
  /^(deshaz|deshacer|deshazlo|revierte|revertir)\b/,
  /^(vuelve|regresa) a como (estaba|era)\b/,
  /^ponlo como estaba\b/,
];

const normalizar = (texto: string): string =>
  texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[¡¿]/g, "").replace(/\s+/g, " ").trim().slice(0, 120);

export function esCorreccion(texto: string): boolean {
  const limpio = normalizar(texto);
  return limpio.length > 0 && CORRECCIONES.some((patron) => patron.test(limpio));
}
