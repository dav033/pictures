import { MANIFIESTOS } from "./manifiestos";
import type { IdRepositorio, ManifiestoRepositorio, Superficie } from "./tipos";

/**
 * Qué repositorios ve cada superficie (REQ-013, SPEC §7), resuelto en el servidor: la variable `CATALOGO_REPOS_<SUPERFICIE>`
 * (lista separada por comas) y, si no está, el `visiblePorDefecto` de cada manifiesto. Las filas de `ajustes_runtime` llegan
 * en la fase 4. Vale para todo repositorio con manifiesto, también `terceros/<slug>` cuando su paquete se cargue (fase 7).
 *
 * Política del catálogo: la resuelven las rutas (y `modelar-foto-real`) y se la pasan a la búsqueda; el motor nunca la
 * alcanza (regla R8, `test-catalogo-capas`).
 */

export type Entorno = Readonly<Record<string, string | undefined>>;

export const variableDeSuperficie = (superficie: Superficie): string => `CATALOGO_REPOS_${superficie.toUpperCase()}`;

/** Los manifiestos que hoy existen: los fundadores (los de terceros se sumarán al cargar sus paquetes). */
const manifiestosConocidos = (): readonly ManifiestoRepositorio[] => Object.values(MANIFIESTOS);

/** Los avisos ya dados, para no repetir el mismo en cada búsqueda (la variable se lee en cada llamada, como `featureEnabled`). */
const avisados = new Set<string>();
function avisarUnaVez(mensaje: string): void {
  if (avisados.has(mensaje)) return;
  avisados.add(mensaje);
  console.warn(`[catalogo] ${mensaje}`);
}

export const reposPorDefecto = (superficie: Superficie, manifiestos: readonly ManifiestoRepositorio[] = manifiestosConocidos()): IdRepositorio[] =>
  manifiestos.filter((m) => m.visiblePorDefecto.includes(superficie)).map((m) => m.id);

/**
 * Los repositorios visibles para la superficie, en el orden de los manifiestos y sin repetir. Un id sin manifiesto se ignora con
 * un aviso; si la variable no deja ninguno válido (vacía o mal escrita), vale la política por defecto: una errata nunca vacía
 * la biblioteca ni abre una superficie de cliente a otro repositorio.
 */
export function reposVisibles(
  superficie: Superficie,
  entorno: Entorno = process.env,
  manifiestos: readonly ManifiestoRepositorio[] = manifiestosConocidos(),
): IdRepositorio[] {
  const variable = variableDeSuperficie(superficie);
  const crudo = entorno[variable]?.trim();
  if (!crudo) return reposPorDefecto(superficie, manifiestos);
  const pedidos = crudo.split(",").map((s) => s.trim()).filter(Boolean);
  const conocidos = manifiestos.map((m) => m.id as string);
  const desconocidos = pedidos.filter((id) => !conocidos.includes(id));
  if (desconocidos.length) avisarUnaVez(`${variable}: se ignoran repositorios sin manifiesto (${desconocidos.join(", ")}).`);
  const validos = manifiestos.map((m) => m.id).filter((id) => pedidos.includes(id));
  if (validos.length) return validos;
  avisarUnaVez(`${variable} no nombra ningún repositorio conocido: se usa la visibilidad por defecto.`);
  return reposPorDefecto(superficie, manifiestos);
}
