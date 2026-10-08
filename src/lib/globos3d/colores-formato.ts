import type { ReferenciaSempertex } from "@/lib/plan/referencia-sempertex";
import { labDeRgb } from "@/lib/rag/catalog/similitud-color";
import { coloresDelFormato } from "./formatos";

/**
 * **Qué color va cuando el pedido no se fabrica en el formato** (el R-9 no trae Reflex Azul, el LOL-6 no trae Dorado):
 * el parecido se mide por el color del globo inflado (distancia CIELAB, `distanciaLab`). Lo usan el motor orgánico
 * (`organico.ts`, que lo avisa) y las herramientas de la IA de escena. Puro y sin red.
 */

export function distanciaLab(hexA: string, hexB: string): number {
  const lab = (hex: string) => labDeRgb(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16));
  const [l1, a1, b1] = lab(hexA), [l2, a2, b2] = lab(hexB);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/** Hasta esta distancia, un color de la misma familia de acabado vale por el pedido (Metal Dorado → Reflex Dorado); más allá es otro color. */
export const DISTANCIA_MAXIMA_FAMILIA = 28;

/** El color de su misma familia que sí se fabrica en el formato, si es lo bastante parecido; si no, `null`. */
export function sustitutoDeFamilia(ref: Pick<ReferenciaSempertex, "familia" | "hexGlobo">, formatoId: string): ReferenciaSempertex | null {
  const mejor = coloresDelFormato(formatoId).filter((r) => r.familia === ref.familia)
    .map((r) => ({ r, d: distanciaLab(ref.hexGlobo, r.hexGlobo) })).sort((a, b) => a.d - b.d)[0];
  return mejor && mejor.d <= DISTANCIA_MAXIMA_FAMILIA ? mejor.r : null;
}

/** El color más parecido de TODOS los que se fabrican en el formato (cualquier familia), para no dejar un globo sin color. */
export function masParecidoEnFormato(hexGlobo: string, formatoId: string): { ref: ReferenciaSempertex; distancia: number } | null {
  const mejor = coloresDelFormato(formatoId).map((r) => ({ ref: r, distancia: distanciaLab(hexGlobo, r.hexGlobo) })).sort((a, b) => a.distancia - b.distancia)[0];
  return mejor ?? null;
}

/**
 * Ningún color de la paleta se fabrica en el formato: el más parecido de los que sí a alguno de ellos (a igual
 * parecido, el de más peso) y el aviso que lo dice (sin parecido posible: Fashion Blanco, 005, avisado también).
 */
export function colorDeRescate(
  candidatos: readonly { codigo: string; peso: number }[], referencias: ReadonlyMap<string, ReferenciaSempertex>, formatoId: string,
): { ref: ReferenciaSempertex | null; aviso: string } {
  const mejores = candidatos.flatMap((e) => {
    const propia = referencias.get(e.codigo);
    const m = propia ? masParecidoEnFormato(propia.hexGlobo, formatoId) : null;
    return propia && m ? [{ propia, peso: e.peso, ...m }] : [];
  }).sort((a, b) => a.distancia - b.distancia || b.peso - a.peso);
  const mejor = mejores[0];
  if (!mejor) return { ref: null, aviso: `Ningún color de la paleta se fabrica en ${formatoId}: se usa Fashion Blanco (005).` };
  return { ref: mejor.ref, aviso: `Ningún color de la paleta se fabrica en ${formatoId}: se usa ${mejor.ref.nombreCompleto} (${mejor.ref.codigo}), el más parecido a ${mejor.propia.nombreCompleto} (${mejor.propia.codigo}).` };
}
