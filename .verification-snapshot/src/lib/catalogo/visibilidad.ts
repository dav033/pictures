import { crearAjusteConCache, leerAjusteNeon } from "@/lib/ajustes/ajustes-runtime";
import { featureEnabled } from "@/lib/ia/nucleo/feature-flags";
import { parsearIdCatalogo, repositorioDeIdLocal } from "./indice";
import { MANIFIESTOS } from "./manifiestos";
import type { EntradaCatalogo } from "./repositorio";
import type { IdRepositorio, ManifiestoRepositorio, Superficie } from "./tipos";

/**
 * Qué repositorios ve cada superficie (REQ-013, SPEC §7), resuelto en el servidor. De mayor a menor prioridad:
 *   1. la fila `catalogo_repos_<superficie>` de `ajustes_runtime` (lista separada por comas; se cambia sin desplegar y el caché es
 *      de 30 s por instancia, `ajustes/ajustes-runtime.ts`);
 *   2. la variable `CATALOGO_REPOS_<SUPERFICIE>` (la misma lista);
 *   3. el `visiblePorDefecto` de cada manifiesto.
 * Los ids se leen sin mayúsculas ni espacios. Un nivel con CUALQUIER id desconocido se ignora entero, con un error en el log, y se
 * pasa al siguiente: una errata («sempertx,mobiliario») nunca deja una lista a medias —sin Sempertex— ni vacía una superficie ni abre
 * otra. Vale para todo repositorio con manifiesto, también `terceros/<slug>` cuando su paquete se cargue (fase 7).
 *
 * Regla de seguridad: la guiada y el estudio son del cliente, y un cliente nunca ve algo que no se puede cotizar. Un repositorio de
 * precio `sin-precio` se descarta de ellas salvo `CATALOGO_PERMITIR_SIN_PRECIO_CLIENTE=true` (decisión del dueño). Eso vale venga
 * la lista de donde venga.
 *
 * Política del catálogo: la resuelven las rutas (y `modelar-foto-real`) y se la pasan a la búsqueda; el motor nunca la
 * alcanza (regla R8, `test-catalogo-capas`). Para encender un repositorio en el RAG sin desplegar:
 *   INSERT INTO ajustes_runtime (clave, valor, actualizado_por) VALUES ('catalogo_repos_rag', 'sempertex,mobiliario,escenografia', 'dueño')
 *   ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_en = now(), actualizado_por = EXCLUDED.actualizado_por;
 * y para volver a hoy: DELETE FROM ajustes_runtime WHERE clave = 'catalogo_repos_rag'; (en 30 s).
 */

export type Entorno = Readonly<Record<string, string | undefined>>;

export const variableDeSuperficie = (superficie: Superficie): string => `CATALOGO_REPOS_${superficie.toUpperCase()}`;
export const claveAjusteDeSuperficie = (superficie: Superficie): string => `catalogo_repos_${superficie}`;

/** Las superficies del cliente: lo que ven tiene que poder cotizarse. */
const SUPERFICIES_DE_CLIENTE: readonly Superficie[] = ["guiada", "estudio"];

/** Los manifiestos que hoy existen: los fundadores (los de terceros se sumarán al cargar sus paquetes). */
const manifiestosConocidos = (): readonly ManifiestoRepositorio[] => Object.values(MANIFIESTOS);

/** Los avisos ya dados, para no repetir el mismo en cada búsqueda (la variable se lee en cada llamada, como `featureEnabled`). */
const avisados = new Set<string>();
function avisarUnaVez(mensaje: string, nivel: "warn" | "error" = "warn"): void {
  if (avisados.has(mensaje)) return;
  avisados.add(mensaje);
  console[nivel](`[catalogo] ${mensaje}`);
}

export const reposPorDefecto = (superficie: Superficie, manifiestos: readonly ManifiestoRepositorio[] = manifiestosConocidos()): IdRepositorio[] =>
  manifiestos.filter((m) => m.visiblePorDefecto.includes(superficie)).map((m) => m.id);

/**
 * Los repositorios con manifiesto que nombra una lista de un nivel (`origen` dice cuál para el aviso), en el orden de los manifiestos
 * y sin repetir, sin mayúsculas ni espacios. `null` si el nivel no existe (vacío) o se ignora entero porque algún id no tiene
 * manifiesto: una lista a medias (sin Sempertex por una errata) es peor que la del nivel siguiente. Esto último se avisa como error.
 */
function nombrados(crudo: string | null | undefined, origen: string, manifiestos: readonly ManifiestoRepositorio[]): IdRepositorio[] | null {
  const pedidos = (crudo ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!pedidos.length) return null;
  const conocidos = manifiestos.map((m) => m.id as string);
  const desconocidos = pedidos.filter((id) => !conocidos.includes(id));
  if (desconocidos.length) {
    avisarUnaVez(`${origen} = «${crudo}» se IGNORA ENTERA: «${desconocidos.join("», «")}» no es un repositorio conocido (${conocidos.join(", ")}). Vale el siguiente nivel.`, "error");
    return null;
  }
  return manifiestos.map((m) => m.id).filter((id) => pedidos.includes(id));
}

/** Quita de una superficie del cliente los repositorios que no se pueden cotizar; si no queda ninguno, los de por defecto que sí. */
function soloCotizablesParaCliente(
  superficie: Superficie,
  repos: IdRepositorio[],
  entorno: Entorno,
  manifiestos: readonly ManifiestoRepositorio[],
): IdRepositorio[] {
  if (!SUPERFICIES_DE_CLIENTE.includes(superficie) || featureEnabled("CATALOGO_PERMITIR_SIN_PRECIO_CLIENTE", entorno)) return repos;
  const cotizable = (id: IdRepositorio) => manifiestos.find((m) => m.id === id)?.precio.tipo !== "sin-precio";
  const cotizables = repos.filter(cotizable);
  if (cotizables.length === repos.length) return repos;
  avisarUnaVez(`${superficie}: se descartan los repositorios sin precio (${repos.filter((id) => !cotizable(id)).join(", ")}); un cliente no ve lo que no se cotiza. CATALOGO_PERMITIR_SIN_PRECIO_CLIENTE=true lo permite.`);
  return cotizables.length ? cotizables : reposPorDefecto(superficie, manifiestos).filter(cotizable);
}

/**
 * Los repositorios visibles para la superficie, en el orden de los manifiestos y sin repetir, dada la fila de `ajustes_runtime`
 * ya leída (`fila`, o `null` si no hay). Es el núcleo puro; quien tiene base lee la fila con `reposVisiblesVigentes`.
 */
export function reposVisibles(
  superficie: Superficie,
  entorno: Entorno = process.env,
  manifiestos: readonly ManifiestoRepositorio[] = manifiestosConocidos(),
  fila: string | null = null,
): IdRepositorio[] {
  const variable = variableDeSuperficie(superficie);
  const pedidos = nombrados(fila, `${claveAjusteDeSuperficie(superficie)} (ajustes_runtime)`, manifiestos) ?? nombrados(entorno[variable], variable, manifiestos);
  return soloCotizablesParaCliente(superficie, pedidos ?? reposPorDefecto(superficie, manifiestos), entorno, manifiestos);
}

export type DependenciasVisibilidad = {
  /** El valor crudo de la fila de `ajustes_runtime`, `null` si no hay. Por defecto Neon (sin `DATABASE_URL`, sin fila). LANZA si la base falló. */
  leerFila?: (clave: string) => Promise<string | null>;
  entorno?: () => Entorno;
  manifiestos?: () => readonly ManifiestoRepositorio[];
  ahora?: () => number;
  /** Cuánto espera una petición a la lectura de la fila antes de seguir sin ella (`PLAZO_LECTURA_AJUSTE_MS`). */
  plazoMs?: number;
};

/** Un lector que cachea cada fila 30 s: leer la visibilidad en cada búsqueda cuesta lo mismo que no tener filas. Nunca tumba ni retrasa más del plazo una petición. */
export function crearLectorVisibilidad(deps: DependenciasVisibilidad = {}): (superficie: Superficie) => Promise<IdRepositorio[]> {
  const leerFila = deps.leerFila ?? ((clave: string) => leerAjusteNeon(clave, "catalogo"));
  const ahora = deps.ahora ?? (() => Date.now());
  const filas = new Map<Superficie, () => Promise<string | null>>();
  return async (superficie) => {
    let fila = filas.get(superficie);
    if (!fila) {
      const clave = claveAjusteDeSuperficie(superficie);
      fila = crearAjusteConCache(() => leerFila(clave), ahora, { etiqueta: clave, ...(deps.plazoMs !== undefined ? { plazoMs: deps.plazoMs } : {}) });
      filas.set(superficie, fila);
    }
    return reposVisibles(superficie, (deps.entorno ?? (() => process.env))(), (deps.manifiestos ?? manifiestosConocidos)(), await fila());
  };
}

/** La visibilidad de una superficie con la fila de `ajustes_runtime` incluida: lo que usan las rutas. */
export const reposVisiblesVigentes: (superficie: Superficie) => Promise<IdRepositorio[]> = crearLectorVisibilidad();

export type CatalogoDeSuperficie = {
  superficie: Superficie;
  repositorios: readonly IdRepositorio[];
  permite(repositorio: IdRepositorio): boolean;
  /** Un id del catálogo (corto o calificado) que reclama un repositorio visible; uno desconocido, o calificado con otro repositorio que el suyo, no. */
  permiteId(id: string): boolean;
  /** Las entradas de sus repositorios, en el orden del registro. Carga el registro (la biblioteca) la primera vez. */
  entradas(): Promise<readonly EntradaCatalogo[]>;
};

/**
 * **El catálogo de una superficie**: la única puerta para listar o consultar el catálogo desde la guiada o el estudio (SPEC §9 c),
 * y para que la IA del taller sepa qué puede tocar. Falla cerrado: lo que la superficie no ve, no se pide.
 */
export async function catalogoPara(superficie: Superficie, resolver: (s: Superficie) => Promise<IdRepositorio[]> = reposVisiblesVigentes): Promise<CatalogoDeSuperficie> {
  const repositorios = await resolver(superficie);
  const permite = (repositorio: IdRepositorio) => repositorios.includes(repositorio);
  return {
    superficie,
    repositorios,
    permite,
    permiteId: (id) => {
      const p = parsearIdCatalogo(id);
      return !("error" in p) && repositorioDeIdLocal(p.idLocal) === p.repositorio && permite(p.repositorio);
    },
    entradas: async () => {
      const { repositorio } = await import("./registro");
      return repositorios.flatMap((id) => repositorio(id)?.entradas() ?? []);
    },
  };
}
