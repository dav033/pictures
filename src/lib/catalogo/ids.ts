import type { IdRepositorio, IdRepositorioFundador } from "./tipos";

/**
 * Los **ids del catálogo** (REQ-013, SPEC §5). El id local es el de hoy, congelado (`idea:arco-x`, `escena:boda~n3`,
 * `silla_tiffany`) y es el que se guarda; el id calificado `<repositorio>:<idLocal>` es el asa pública
 * (`sempertex:idea:arco-x`, `mobiliario:silla_tiffany`, `terceros/acme:silla-x`). Se parte en el PRIMER `:`: si la cabeza es un
 * repositorio, lo demás es el id local; si no, todo es un id local (forma corta) y lo resuelve el índice del registro.
 * Módulo hoja (solo tipos de `tipos.ts`): el motor puede importarlo sin arrastrar el registro (regla R8). Lo que se GUARDA es
 * siempre el id corto (SPEC §5.2): quien recibe un id calificado lo normaliza al escribir (`idCortoDeFondo`).
 */

export const REPOSITORIOS_FUNDADORES: readonly IdRepositorioFundador[] = ["sempertex", "mobiliario", "escenografia"];

const PREFIJO_TERCEROS = "terceros/";
export const PATRON_SLUG_TERCEROS = /^[a-z0-9][a-z0-9-]{1,23}$/;

/** Los prefijos de los ids de la biblioteca de fábrica y de lo que se deriva de sus escenas (`<escena>~<nodo>`). */
export const PREFIJOS_BIBLIOTECA = ["idea:", "celebra:", "decoracion:", "utileria:", "base-organica:", "referencia:", "escena:"] as const;
/**
 * Las demás clases de Sempertex no tenían id de catálogo (un formato es «R-12», un color «570», un plan de idea y su decoración
 * comparten la clave «deco-…»): su id local lleva el prefijo de su clase para que el índice de ids locales sea inyectivo.
 */
export const PREFIJOS_CLASE_SEMPERTEX = {
  formato: "formato:", color: "color:", "producto-tienda": "producto-tienda:", "plan-idea": "plan-idea:", "decoracion-guiada": "decoracion-guiada:", modulo: "modulo:",
} as const;
export const PREFIJOS_SEMPERTEX: readonly string[] = [...PREFIJOS_BIBLIOTECA, ...Object.values(PREFIJOS_CLASE_SEMPERTEX)];

export function esIdRepositorio(s: string): s is IdRepositorio {
  if ((REPOSITORIOS_FUNDADORES as readonly string[]).includes(s)) return true;
  return s.startsWith(PREFIJO_TERCEROS) && PATRON_SLUG_TERCEROS.test(s.slice(PREFIJO_TERCEROS.length));
}

export const idCalificado = (repositorio: IdRepositorio, idLocal: string): string => `${repositorio}:${idLocal}`;

/** El repositorio y el id local de un id calificado; `null` si es un id corto. */
export function separarCalificado(s: string): { repositorio: IdRepositorio; idLocal: string } | null {
  const i = s.indexOf(":");
  if (i <= 0 || i === s.length - 1) return null;
  const cabeza = s.slice(0, i);
  return esIdRepositorio(cabeza) ? { repositorio: cabeza, idLocal: s.slice(i + 1) } : null;
}

/** El repositorio que reclama un id local por su prefijo (hoy solo Sempertex reclama por prefijo). */
export function repositorioPorPrefijo(idLocal: string): IdRepositorioFundador | undefined {
  return PREFIJOS_SEMPERTEX.some((p) => idLocal.startsWith(p)) ? "sempertex" : undefined;
}

export type IdParseado =
  | { repositorio: IdRepositorio; idLocal: string; forma: "calificada" | "corta" }
  | { error: "desconocido" | "ambiguo" };
/** Quién reclama un id local: el registro pasa su índice completo (prefijos y los ids exactos de cada cargador). */
export type BuscarIdLocal = (idLocal: string) => IdRepositorio | "ambiguo" | undefined;

export function parsearId(s: string, buscar: BuscarIdLocal = repositorioPorPrefijo): IdParseado {
  const calificado = separarCalificado(s);
  if (calificado) return { ...calificado, forma: "calificada" };
  const repositorio = s ? buscar(s) : undefined;
  if (repositorio === "ambiguo") return { error: "ambiguo" };
  return repositorio ? { repositorio, idLocal: s, forma: "corta" } : { error: "desconocido" };
}
