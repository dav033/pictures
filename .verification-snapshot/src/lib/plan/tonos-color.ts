import { TABLA_SEMPERTEX, referenciaDelTitulo, type ReferenciaSempertex } from "@/lib/plan/referencia-sempertex";
import { clasificarColores, clasificarTonos, plegarTexto, TONOS_V2, type ColorPropuestaV2, type TonoClaroV2 } from "@/lib/rag/taxonomy/v2";

/**
 * Los tonos claros de la taxonomía (`TONOS_V2`: celeste, rosa pastel, durazno) contra el catálogo real: qué globo es
 * de ese tono, qué referencia Sempertex lo representa y qué pidió el cliente. Puro: sin red, sin base de datos.
 *
 * Por qué existe (probador, 2026-10-07, guiada-20261006-234525-va33im): el cliente pidió un unicornio en «rosa, lila,
 * celeste y dorado» y el plan compró «Reflex Azul» (azul cromado, un petróleo en el dibujo). «Celeste» no era ningún
 * color, la propuesta lo volvió «azul» y la búsqueda devolvía cualquier azul. El catálogo guarda los globos celestes
 * como «azul» y Python (también el del VPS) solo entiende esa familia, así que el tono se resuelve aquí: la búsqueda se
 * queda con los azules claros cuando el cliente pidió celeste y no otro azul, y el material sigue diciendo «azul».
 */

/** Familias que nunca son un tono claro aunque la lámina las llame «light»: el cromado, el metalizado, el neón y el cristal. */
const FAMILIA_NO_CLARA = /\b(?:reflex|cromad\w*|metal\w*|neon|cristal|crystal|transparente)\b/;

function conEspacios(texto: string): string {
  return ` ${plegarTexto(texto)} `;
}

/**
 * ¿El globo de este título es del tono? Tiene que ser de su familia (sus colores reales, o los que dice el título) y,
 * además, decir el tono («FASHION AZUL CELESTE»), ser pastel de esa familia («PASTEL MATE AZUL») o ser una referencia
 * Sempertex de ese tono que no sea cromada, metalizada, neón ni cristal («FASHION AZUL» es la 040, azul claro).
 */
export function esGloboDelTono(titulo: string, tono: TonoClaroV2, coloresReales?: readonly string[]): boolean {
  const definicion = TONOS_V2[tono];
  const colores = (coloresReales ?? clasificarColores(titulo).values).map((color) => plegarTexto(color));
  if (!colores.includes(definicion.familia)) return false;
  const plegado = conEspacios(titulo);
  if (definicion.titulo.some((palabra) => plegado.includes(` ${palabra} `))) return true;
  if (definicion.pastel && plegado.includes(" pastel ")) return true;
  if (FAMILIA_NO_CLARA.test(plegado)) return false;
  const referencia = referenciaDelTitulo(titulo, null);
  return Boolean(referencia && definicion.basesSempertex.includes(referencia.nombreBase));
}

/**
 * El tono que dice el TÍTULO de un producto, con una palabra que la lámina Sempertex no tiene: «FASHION AZUL CELESTE»
 * (la lámina solo dice «Azul») o la línea pastel de la familia («PASTEL MATE AZUL» es un celeste, «PASTEL MATE ROSADO»
 * un rosa pastel). Null si el título no dice ningún tono claro.
 */
export function tonoDelTitulo(titulo: string): TonoClaroV2 | null {
  const plegado = conEspacios(titulo);
  const colores = clasificarColores(titulo).values;
  for (const [tono, definicion] of Object.entries(TONOS_V2) as Array<[TonoClaroV2, (typeof TONOS_V2)[TonoClaroV2]]>) {
    if (!colores.includes(definicion.familia)) continue;
    if (definicion.titulo.some((palabra) => plegado.includes(` ${palabra} `))) return tono;
    if (definicion.pastel && plegado.includes(" pastel ") && colores.length === 1) return tono;
  }
  return null;
}

/** Referencia que se pinta para un tono pedido sin producto: la primera de la lámina del tono (en la familia pedida, si la hay). */
const PREFERIDA: Readonly<Record<TonoClaroV2, string>> = { celeste: "040", "rosa pastel": "609", durazno: "060" };

export function referenciaDeTono(tono: TonoClaroV2, familiaSempertex?: string | null): ReferenciaSempertex | null {
  const bases = TONOS_V2[tono].basesSempertex;
  const delTono = TABLA_SEMPERTEX.referencias.filter((referencia) => bases.includes(referencia.nombreBase) && !FAMILIA_NO_CLARA.test(referencia.familia.toLowerCase()));
  return (familiaSempertex ? delTono.find((referencia) => referencia.familia === familiaSempertex) : undefined)
    ?? delTono.find((referencia) => referencia.codigo === PREFERIDA[tono])
    ?? delTono[0]
    ?? null;
}

function escapar(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** El texto sin las palabras de un tono (para saber si la familia se nombra aparte: «azul rey y celeste»). */
function sinPalabrasDeTono(texto: string, tonos: readonly TonoClaroV2[]): string {
  let resto = plegarTexto(texto);
  const aliases = tonos.flatMap((tono) => TONOS_V2[tono].aliases).sort((a, b) => b.length - a.length);
  for (const alias of aliases) resto = resto.replace(new RegExp(`(?<=^| )${escapar(alias)}(?= |$)`, "g"), " ");
  return resto;
}

/**
 * Los tonos que pide un texto SIN pedir aparte otro color de su familia: «rosa, lila, celeste y dorado» → [celeste];
 * «azul rey y celeste» → [] (ahí los dos azules valen). Son los que restringen la búsqueda del catálogo.
 */
export function tonosExclusivos(texto: string): TonoClaroV2[] {
  const tonos = clasificarTonos(texto).values;
  if (!tonos.length) return [];
  const familiasAparte = new Set(clasificarColores(sinPalabrasDeTono(texto, tonos)).values);
  return tonos.filter((tono) => !familiasAparte.has(TONOS_V2[tono].familia));
}

/**
 * Los candidatos de una búsqueda del catálogo con los tonos pedidos: de la familia de cada tono solo quedan los globos de
 * ese tono («celeste» → Fashion Azul Celeste, Pastel Mate Azul…, nunca Reflex Azul ni Azul Rey). Los de otras familias,
 * los surtidos y los que no tienen color siguen igual. Si de una familia no quedara ninguno, se deja como estaba: un
 * color nunca desaparece de la búsqueda por su tono.
 */
export function filtrarPorTonos<T>(candidatos: readonly T[], tonos: readonly TonoClaroV2[], leer: (candidato: T) => { titulo: string; colores: readonly string[] }): T[] {
  let resultado = [...candidatos];
  for (const tono of tonos) {
    const familia = TONOS_V2[tono].familia;
    const deLaFamilia = (candidato: T) => { const { colores } = leer(candidato); return colores.length === 1 && plegarTexto(colores[0]!) === familia; };
    const quedan = resultado.filter((candidato) => !deLaFamilia(candidato) || esGloboDelTono(leer(candidato).titulo, tono, leer(candidato).colores));
    if (quedan.some(deLaFamilia)) resultado = quedan;
  }
  return resultado;
}

/** «el azul cámbialo por celeste», «en vez del azul, celeste»: el tono reemplaza a su familia. */
function pideCambio(mensaje: string, tono: TonoClaroV2): boolean {
  const plegado = plegarTexto(mensaje);
  if (/\b(?:cambia\w*|reemplaza\w*|sustitu\w*|en vez|en lugar)\b/.test(plegado)) return true;
  const aliases = TONOS_V2[tono].aliases.map(escapar).join("|");
  return new RegExp(`\\bpor (?:un |uno |el )?(?:color |tono )?(?:${aliases})\\b`).test(plegado);
}

/**
 * Los colores de una propuesta con los tonos que dijo el cliente. El modelo solo podía elegir colores de la paleta y
 * «celeste» le llegaba como «azul» (luego el plan compraba cualquier azul). Ahora, con el último mensaje del cliente que
 * nombra un tono: si la propuesta trae su familia y no el tono, el tono la reemplaza; si el cliente nombró además otro
 * color de esa familia («azul rey y celeste»), se agregan los dos. Sin la familia en la propuesta no se inventa nada.
 */
export function coloresConTonosDelCliente<C extends string>(colores: readonly C[], mensajesCliente: readonly string[], maximo = 5): Array<C | ColorPropuestaV2> {
  const mensaje = [...mensajesCliente].reverse().find((texto) => clasificarTonos(texto).values.length > 0);
  if (!mensaje) return [...colores];
  const tonos = clasificarTonos(mensaje).values;
  const exclusivos = new Set(tonosExclusivos(mensaje));
  let resultado: Array<C | ColorPropuestaV2> = [...colores];
  for (const tono of tonos) {
    const familia = TONOS_V2[tono].familia;
    if (resultado.includes(tono) || !resultado.includes(familia)) continue;
    resultado = exclusivos.has(tono) || pideCambio(mensaje, tono) || resultado.length >= maximo
      ? resultado.map((color) => (color === familia ? tono : color))
      : resultado.flatMap((color) => (color === familia ? [color, tono] : [color]));
  }
  return [...new Set(resultado)];
}
