import type { ColorLeido } from "./lectura-foto";

/**
 * **Qué color leído va en qué parte de un mueble** (`compilar-mobiliario.ts`). La foto da los colores de una pieza con su peso («blanco 90 %, dorado 10 %»); el
 * mueble los pide por parte («tapa», «patas», «adorno»). Por defecto van en el orden de la lectura: el primero a la primera parte, el segundo a la segunda…
 * Solo si el mueble tiene una parte de ADORNO (filete, ribete, adorno: la mesa de postres ornamentada) se reparte por parte:
 * - un color de ACENTO (de poco peso, junto a otro que domina) no pinta una parte del cuerpo del mueble (tapa, patas, pie, mantel…): el cuerpo lleva los
 *   colores que dominan y, si tiene menos que partes, repite el principal; el acento va al adorno (una mesa blanca con un filete dorado: tapa y patas blancas);
 * - sin acentos (los colores pesan parecido) o en las partes que no son de cuerpo ni de adorno, se conserva el orden de la lectura.
 * Un mueble sin parte de adorno (una silla de patas doradas y cojín blanco, un sofá, una mesa de tapa y patas) queda siempre con el orden de la lectura.
 */

/** Hasta este porcentaje del peso total un color es un acento y no manda en el cuerpo del mueble. */
export const ACENTO_MAXIMO_PCT = 20;
const ES_ADORNO = /adorno|filete|ribete/i;
const ES_CUERPO = /^(tapa|patas|pie|mantel|funda|cuerpo|estructura)/i;

export type ColoresPorParte = { porParte: Array<ColorLeido | undefined>; sobran: ColorLeido[] };

export function coloresPorParte(partes: readonly string[], leidos: readonly ColorLeido[]): ColoresPorParte {
  const posicional = (): ColoresPorParte => ({ porParte: partes.map((_, i) => leidos[i]), sobran: [] });
  if (!partes.some((p) => ES_ADORNO.test(p))) return posicional();
  const total = leidos.reduce((s, c) => s + c.peso, 0) || 1;
  const esAcento = (c: ColorLeido) => (100 * c.peso) / total <= ACENTO_MAXIMO_PCT;
  const principales = leidos.filter((c) => !esAcento(c));
  const acentos = leidos.filter(esAcento);
  if (!principales.length || !acentos.length) return posicional();
  let siguientePrincipal = 0, siguienteAcento = 0;
  const porParte = partes.map((parte, i): ColorLeido | undefined => {
    if (ES_ADORNO.test(parte)) return acentos[siguienteAcento++];
    if (ES_CUERPO.test(parte)) return principales[siguientePrincipal++] ?? principales[0];
    return leidos[i];
  });
  return { porParte, sobran: acentos.slice(siguienteAcento) };
}
