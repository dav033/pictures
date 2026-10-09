/**
 * ¿El mensaje de la persona corrige a la IA («no, eso no», «no es lo que pedí», «deshaz eso»)? Entonces la respuesta anterior se
 * cuenta como deshecha y se abre el «por qué» (REQ-010). Conservador: un «no» suelto («no sé», «no tengo foto») NO es una
 * corrección, y un falso positivo ensucia los datos que se quieren para ver los huecos de la IA.
 */

const CORRECCIONES: readonly RegExp[] = [
  /^no[,.!\s]+(eso|esa|ese|esto|asi|lo que|era|es lo|es eso|quiero eso|me gusta|me sirve|me convence|funciona|esta bien|esta correct)/,
  /^(eso|esa|ese|asi) no\b/,
  /^(esta|estan|quedo|quedaron) (mal|incorrect|feo|fea)/,
  /^(te equivocaste|equivocaste|incorrecto|incorrecta|mal\b|error\b|fallaste)/,
  /\bno es (lo que|eso lo que) (pedi|dije|queria|quiero)/,
  /\bno (te )?(pedi|dije) eso\b/,
  /^(deshaz|deshacer|deshazlo|revierte|revertir|vuelve a (como|lo)|regresa (a|al|lo)|ponlo como estaba)/,
];

const normalizar = (texto: string): string =>
  texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[¡¿]/g, "").replace(/\s+/g, " ").trim().slice(0, 120);

export function esCorreccion(texto: string): boolean {
  const limpio = normalizar(texto);
  return limpio.length > 0 && CORRECCIONES.some((patron) => patron.test(limpio));
}
