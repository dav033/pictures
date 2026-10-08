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

/** El JSON trae las etiquetas como arreglos `[id, confianza]`; se leen con su tipo (sin aserciones a ciegas). */
const etiquetas = (xs: ReadonlyArray<ReadonlyArray<string | number>>): Etiqueta[] =>
  xs.flatMap((x) => (typeof x[0] === "string" && typeof x[1] === "number" ? [[x[0], x[1]] as Etiqueta] : []));
const ITEMS: Record<string, Clasificado> = Object.fromEntries(
  Object.entries(datos.items as Record<string, { c: ReadonlyArray<ReadonlyArray<string | number>>; t: ReadonlyArray<ReadonlyArray<string | number>>; general: boolean; motivo: string }>)
    .map(([id, v]) => [id, { c: etiquetas(v.c), t: etiquetas(v.t), general: v.general, motivo: v.motivo }]),
);

/** Etiquetas de un item (o de la escena de la que sale), las de mayor confianza primero; null si no está clasificado. */
export function clasificacionDe(id: string): ClasificacionTaller | null {
  const propio = ITEMS[id] ?? ITEMS[id.split("~")[0]!];
  if (!propio) return null;
  const ids = (xs: Etiqueta[]) => [...xs].sort((a, b) => b[1] - a[1]).map(([x]) => x);
  return { celebraciones: ids(propio.c), tematicas: ids(propio.t) };
}

export const VERSION_CLASIFICACION = datos.version;
