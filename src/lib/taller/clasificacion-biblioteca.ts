import datos from "./datos/clasificacion-biblioteca.json";
import type { ClasificacionTaller } from "./fichas-tipos";

/**
 * **Clasificación de la biblioteca** por celebración y temática (REQ-002 paso 1, D-011): reglas + subagentes Claude
 * Sonnet 5.5 leyendo las fichas; versionada en `datos/clasificacion-biblioteca.json` (ids de
 * `taxonomia-celebraciones.ts`, confianza ≥ 0,5). Solo los items de fábrica están clasificados: una pieza derivada
 * de una escena (`escena~pieza`) hereda las etiquetas de su escena.
 */
type Etiqueta = [id: string, confianza: number];
type Clasificado = { c: Etiqueta[]; t: Etiqueta[]; general: boolean; motivo: string };

const ITEMS = (datos as { items: Record<string, Clasificado> }).items;

/** Etiquetas de un item (o de la escena de la que sale), las de mayor confianza primero; null si no está clasificado. */
export function clasificacionDe(id: string): ClasificacionTaller | null {
  const propio = ITEMS[id] ?? ITEMS[id.split("~")[0]!];
  if (!propio) return null;
  const ids = (xs: Etiqueta[]) => [...xs].sort((a, b) => b[1] - a[1]).map(([x]) => x);
  return { celebraciones: ids(propio.c), tematicas: ids(propio.t) };
}

export const VERSION_CLASIFICACION = (datos as { version: number }).version;
