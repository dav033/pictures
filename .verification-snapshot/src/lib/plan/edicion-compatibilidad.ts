import type { ProductoCandidato } from "@/lib/rag/chat/buscar";

/**
 * What a replacement must keep from the line it replaces (E2E 2026-09-14: the
 * "Modificar" search offered a streamer for a 9-inch balloon and the editor
 * accepted it). A line with a diameter is a balloon: its replacement must be a
 * balloon of the same shape. A line without a diameter (backdrop, kit,
 * accessory) accepts any catalog product. Pure: no HTTP, database or provider.
 */
export type LineaObjetivoEdicion = { forma?: string | null; diam_pulg?: number | null };

function esGlobo(linea: LineaObjetivoEdicion): boolean {
  return linea.diam_pulg != null;
}

/** Search candidates (and their variants) that can replace `objetivo`; products left without variants are dropped. */
export function filtrarCandidatosCompatibles(candidatos: readonly ProductoCandidato[], objetivo: LineaObjetivoEdicion | undefined): ProductoCandidato[] {
  if (!objetivo || !esGlobo(objetivo)) return [...candidatos];
  return candidatos.flatMap((candidato) => {
    const variantes = candidato.variantes.filter((variante) => variante.diamPulg != null && (!objetivo.forma || variante.forma === objetivo.forma));
    return variantes.length ? [{ ...candidato, variantes }] : [];
  });
}

/**
 * After resolving an edited plan: true when a balloon line was replaced by a
 * variant that resolves as something else (no diameter, or another shape).
 */
export function reemplazoIncompatible(
  objetivo: LineaObjetivoEdicion,
  lineasDeLaVariante: ReadonlyArray<LineaObjetivoEdicion>,
): boolean {
  if (!esGlobo(objetivo)) return false;
  return lineasDeLaVariante.some((linea) => !esGlobo(linea) || (objetivo.forma != null && linea.forma !== objetivo.forma));
}

export const MENSAJE_REEMPLAZO_INCOMPATIBLE = "Esa pieza no puede reemplazar un globo. Elige otro globo.";
export const MENSAJE_UNICO_MATERIAL = "No se puede quitar el único globo de esta pieza; cámbialo por otro.";
