import { crearCacheTemporal } from "@/lib/cache/cache-temporal";
import type { ColorCatalogo } from "./colores-catalogo";

/**
 * Cachés de las dos lecturas que el explorador del editor repite en cada apertura y que casi nunca cambian.
 * La lista de colores del snapshot publicado no cambia durante su publicación.
 *
 * - Colores: la clave lleva el snapshot firmado de la propuesta, así que catálogos distintos nunca comparten
 *   respuesta. Un snapshot publicado no cambia: 5 min. Sin snapshot
 *   (propuesta sin procedencia firmada) se pide el último publicado y solo se recuerda 30 s.
 */

const TTL_COLORES_SNAPSHOT_MS = 5 * 60_000;
const TTL_COLORES_ULTIMO_MS = 30_000;

const cacheColores = crearCacheTemporal<ColorCatalogo[]>({ ttlMs: TTL_COLORES_SNAPSHOT_MS, maximo: 32 });

export function claveColores(catalogSnapshotId: string | undefined): string {
  return JSON.stringify(catalogSnapshotId ?? null);
}

/** La lista de colores para esa clave; `pedir` solo se llama si no hay una respuesta viva ni una en vuelo. */
export function coloresParaExplorar(clave: string, pinned: boolean, pedir: () => Promise<ColorCatalogo[]>): Promise<ColorCatalogo[]> {
  return cacheColores.obtener(clave, () => pedir(), { ttlMs: pinned ? TTL_COLORES_SNAPSHOT_MS : TTL_COLORES_ULTIMO_MS });
}

/** Para las pruebas: cada caso parte sin nada recordado. */
export function olvidarCachesExploracion(): void {
  cacheColores.olvidar();
}
