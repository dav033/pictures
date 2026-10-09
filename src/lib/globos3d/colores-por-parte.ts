import type { ColorLeido } from "./lectura-foto";

/**
 * **Qué color leído va en qué parte de un mueble** (`compilar-mobiliario.ts`). La foto da los colores de una pieza con su peso («blanco 90 %, dorado 10 %»); el
 * mueble los pide por parte («tapa», «patas», «adorno»). Repartirlos por posición (el primero a la tapa, el segundo a las patas) pintaba de dorado las
 * patas de una mesa blanca con un filete dorado. Aquí se reparte por parte:
 * - un color de ACENTO (de poco peso, junto a otro que domina) no pinta una parte del cuerpo del mueble (tapa, patas, pie, mantel…): el cuerpo lleva los
 *   colores que dominan y, si tiene menos que partes, repite el principal;
 * - el acento va a la parte de adorno (filete, ribete, adorno) si el mueble la tiene; si no la tiene, no se pinta y se avisa;
 * - sin acentos (los colores pesan parecido) o en las partes que no son de cuerpo ni de adorno (cojín, pantalla, luz), se conserva el orden de siempre.
 */

/** Hasta este porcentaje del peso total un color es un acento y no manda en el cuerpo del mueble. */
export const ACENTO_MAXIMO_PCT = 20;
const ES_ADORNO = /adorno|filete|ribete/i;
const ES_CUERPO = /^(tapa|patas|pie|mantel|funda|cuerpo|estructura)\b/i;

export type ColoresPorParte = { porParte: Array<ColorLeido | undefined>; sobran: ColorLeido[] };

export function coloresPorParte(partes: readonly string[], leidos: readonly ColorLeido[]): ColoresPorParte {
  const total = leidos.reduce((s, c) => s + c.peso, 0) || 1;
  const esAcento = (c: ColorLeido) => (100 * c.peso) / total <= ACENTO_MAXIMO_PCT;
  const principales = leidos.filter((c) => !esAcento(c));
  const acentos = leidos.filter(esAcento);
  const posicional = (): ColoresPorParte => ({ porParte: partes.map((_, i) => leidos[i]), sobran: [] });
  // Sin un color que domine ni uno de acento a quien darle otro lugar, o si el mueble no distingue cuerpo y adorno, vale el orden de la lectura.
  if (!principales.length || !acentos.length || !partes.some((p) => ES_CUERPO.test(p) || ES_ADORNO.test(p))) return posicional();
  let siguientePrincipal = 0, siguienteAcento = 0;
  const porParte = partes.map((parte, i): ColorLeido | undefined => {
    if (ES_ADORNO.test(parte)) return acentos[siguienteAcento++];
    if (ES_CUERPO.test(parte)) return principales[siguientePrincipal++] ?? principales[0];
    return leidos[i];
  });
  return { porParte, sobran: acentos.slice(siguienteAcento) };
}
