import { createHash } from "node:crypto";
import { crearCacheTemporal } from "@/lib/cache/cache-temporal";
import type { CatalogAllowlist } from "../retrieval/types";
import type { ColorCatalogo } from "./colores-catalogo";

/**
 * Cachés de las dos lecturas que el explorador del editor repite en cada apertura y que casi nunca cambian.
 * Medido (dev, Neon): resolver la allowlist de un modo LoRA cuesta ~1,2 s en Next y la lista de colores ~0,5 s en
 * Python; juntas eran más de la mitad de lo que tardaba abrir el modal.
 *
 * Solo para LEER (buscar y colores). Aplicar una edición sigue resolviendo la allowlist en el momento: lo que se
 * guarda nunca se decide con un dato viejo.
 *
 * - Allowlist: 60 s por modo. Si el dataset cambia, el explorador tarda hasta un minuto en enterarse, pero no
 *   puede aplicar nada fuera del dataset (aplicar la vuelve a resolver).
 * - Colores: la clave lleva el snapshot firmado de la propuesta, el modo y una huella de la allowlist, así que un
 *   catálogo o un modo distinto nunca comparten respuesta. Un snapshot publicado no cambia: 5 min. Sin snapshot
 *   (propuesta sin procedencia firmada) se pide el último publicado y solo se recuerda 30 s.
 */

const TTL_ALLOWLIST_MS = 60_000;
const TTL_COLORES_SNAPSHOT_MS = 5 * 60_000;
const TTL_COLORES_ULTIMO_MS = 30_000;

const cacheAllowlist = crearCacheTemporal<CatalogAllowlist | null>({ ttlMs: TTL_ALLOWLIST_MS, maximo: 8 });
const cacheColores = crearCacheTemporal<ColorCatalogo[]>({ ttlMs: TTL_COLORES_SNAPSHOT_MS, maximo: 32 });

/** La allowlist de `modo` para una lectura del explorador; `null` sin modo restringido. Una sola resolución en vuelo por modo. */
export function allowlistParaExplorar(modo: string | undefined, resolver: () => Promise<CatalogAllowlist | null>): Promise<CatalogAllowlist | null> {
  if (modo === undefined) return resolver();
  return cacheAllowlist.obtener(modo, () => resolver());
}

function huella(allowlist: CatalogAllowlist | null | undefined): string {
  if (!allowlist) return "-";
  const hash = createHash("sha256");
  for (const entrada of allowlist.entries) hash.update(`${entrada.productId}:${entrada.variantIds.join(",")};`);
  return `${allowlist.entries.length}:${hash.digest("hex").slice(0, 24)}`;
}

export function claveColores(catalogSnapshotId: string | undefined, modo: string | undefined, allowlist: CatalogAllowlist | null | undefined): string {
  return JSON.stringify([catalogSnapshotId ?? null, modo ?? null, huella(allowlist)]);
}

/** La lista de colores para esa clave; `pedir` solo se llama si no hay una respuesta viva ni una en vuelo. */
export function coloresParaExplorar(clave: string, pinned: boolean, pedir: () => Promise<ColorCatalogo[]>): Promise<ColorCatalogo[]> {
  return cacheColores.obtener(clave, () => pedir(), { ttlMs: pinned ? TTL_COLORES_SNAPSHOT_MS : TTL_COLORES_ULTIMO_MS });
}

/** Para las pruebas: cada caso parte sin nada recordado. */
export function olvidarCachesExploracion(): void {
  cacheAllowlist.olvidar();
  cacheColores.olvidar();
}
