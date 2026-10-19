import {
  CELEBRACIONES, TEMATICAS, NOMBRE_GRUPO_CELEBRACION, NOMBRE_GRUPO_TEMATICA, celebracionPorId, tematicaPorId, normalizar,
  type EntradaTaxonomia,
} from "./taxonomia-celebraciones";
import type { ClasificacionTaller } from "./fichas-tipos";

/**
 * Filtros por celebración y temática de la Biblioteca (REQ-002 paso 6), sobre la clasificación local
 * (`clasificacion-biblioteca.ts`, `clasificacionDe(id)`: una pieza derivada de una escena hereda las etiquetas de su
 * escena). Todo es dato en memoria: contar, agrupar, buscar opciones y filtrar no tocan la red ni la base. Puro y sin
 * React, para probarlo suelto. Dentro de un eje, elegir varias opciones es «cualquiera de ellas»; entre los dos ejes,
 * «las dos cosas».
 */

export type EjeTaxonomia = "celebraciones" | "tematicas";
/** Las etiquetas de un item (la clasificación vive aparte para cargarla perezosa); `null` si no está clasificado. */
export type Clasificador = (id: string) => ClasificacionTaller | null;
export type FiltroTaxonomia = { celebraciones: readonly string[]; tematicas: readonly string[] };

export const FILTRO_TAXONOMIA_VACIO: FiltroTaxonomia = { celebraciones: [], tematicas: [] };

export const hayFiltroTaxonomia = (f: FiltroTaxonomia): boolean => f.celebraciones.length > 0 || f.tematicas.length > 0;

/** Agrega o quita un id del eje (devuelve otro filtro; el anterior no se toca). */
export function alternarOpcion(f: FiltroTaxonomia, eje: EjeTaxonomia, id: string): FiltroTaxonomia {
  const actual = f[eje];
  return { ...f, [eje]: actual.includes(id) ? actual.filter((x) => x !== id) : [...actual, id] };
}

/** Cuántos items tienen cada id del eje (solo los que aparecen al menos una vez). */
export function contarPorEje(items: ReadonlyArray<{ id: string }>, clasificar: Clasificador, eje: EjeTaxonomia): Map<string, number> {
  const cuenta = new Map<string, number>();
  for (const { id } of items) {
    const c = clasificar(id);
    if (!c) continue;
    for (const x of new Set(c[eje])) cuenta.set(x, (cuenta.get(x) ?? 0) + 1);
  }
  return cuenta;
}

function cumpleEje(elegidos: readonly string[], tiene: readonly string[] | undefined): boolean {
  return elegidos.length === 0 || (tiene !== undefined && elegidos.some((x) => tiene.includes(x)));
}

/** Los items que cumplen el filtro; sin filtro devuelve la misma lista. Un item sin clasificar no pasa un filtro activo. */
export function filtrarPorTaxonomia<T extends { id: string }>(items: readonly T[], clasificar: Clasificador, f: FiltroTaxonomia): readonly T[] {
  if (!hayFiltroTaxonomia(f)) return items;
  return items.filter((item) => {
    const c = clasificar(item.id);
    return cumpleEje(f.celebraciones, c?.celebraciones) && cumpleEje(f.tematicas, c?.tematicas);
  });
}

export type OpcionTaxonomia = { id: string; nombre: string; n: number };
export type GrupoOpciones = { grupo: string; nombre: string; opciones: OpcionTaxonomia[] };

const POR_EJE: Record<EjeTaxonomia, { entradas: readonly EntradaTaxonomia<string>[]; nombreGrupo: Readonly<Record<string, string>> }> = {
  celebraciones: { entradas: CELEBRACIONES, nombreGrupo: NOMBRE_GRUPO_CELEBRACION },
  tematicas: { entradas: TEMATICAS, nombreGrupo: NOMBRE_GRUPO_TEMATICA },
};

/** Lo que se compara al buscar una opción: nombre, inglés y sinónimos, sin tildes ni mayúsculas. */
const textoBuscable = new Map<string, string>(
  [...CELEBRACIONES, ...TEMATICAS].map((e) => [e.id, normalizar([e.nombre, e.en, ...e.sinonimos].join(" "))]),
);

/**
 * Las opciones del eje, agrupadas por `grupo` (en el orden de la taxonomía), con su cuenta; solo las que tienen al menos
 * un item (más las ya elegidas, aunque ya no tengan: así se pueden quitar). `busqueda` filtra por nombre o sinónimo
 * (todas las palabras). Dentro de un grupo, las más frecuentes primero.
 */
export function opcionesAgrupadas(eje: EjeTaxonomia, conteos: ReadonlyMap<string, number>, busqueda = "", elegidas: readonly string[] = []): GrupoOpciones[] {
  const palabras = normalizar(busqueda).split(" ").filter(Boolean);
  const { entradas, nombreGrupo } = POR_EJE[eje];
  const grupos = new Map<string, OpcionTaxonomia[]>();
  for (const e of entradas) {
    const n = conteos.get(e.id) ?? 0;
    if (n === 0 && !elegidas.includes(e.id)) continue;
    const buscable = textoBuscable.get(e.id) ?? "";
    if (!palabras.every((p) => buscable.includes(p))) continue;
    grupos.set(e.grupo, [...(grupos.get(e.grupo) ?? []), { id: e.id, nombre: e.nombre, n }]);
  }
  const ordenGrupos = [...new Set(entradas.map((e) => e.grupo))];
  return ordenGrupos.flatMap((grupo) => {
    const opciones = grupos.get(grupo);
    return opciones ? [{ grupo, nombre: nombreGrupo[grupo] ?? grupo, opciones: [...opciones].sort((a, b) => b.n - a.n || a.nombre.localeCompare(b.nombre, "es")) }] : [];
  });
}

export const nombreOpcion = (eje: EjeTaxonomia, id: string): string =>
  (eje === "celebraciones" ? celebracionPorId(id) : tematicaPorId(id))?.nombre ?? id;

/** La celebración y la temática principales de un item (las de mayor confianza), con su nombre; `null` si no tiene. */
export function etiquetaPrincipal(c: ClasificacionTaller | null): { celebracion: string | null; tematica: string | null } {
  const primero = (eje: EjeTaxonomia) => { const id = c?.[eje][0]; return id ? nombreOpcion(eje, id) : null; };
  return { celebracion: primero("celebraciones"), tematica: primero("tematicas") };
}

/** «Cumpleaños · Dinosaurios» (lo que haya), o `null` si el item no tiene ninguna etiqueta. */
export function textoEtiquetaPrincipal(c: ClasificacionTaller | null): string | null {
  const { celebracion, tematica } = etiquetaPrincipal(c);
  const partes = [celebracion, tematica].filter((x): x is string => x !== null);
  return partes.length ? partes.join(" · ") : null;
}

/** Deja solo los items que están en `ids`, en el orden de `ids` (el del parecido a la foto); lo que no está en `items`, se ignora. */
export function ordenarPorIds<T extends { id: string }>(items: readonly T[], ids: readonly string[]): T[] {
  const porId = new Map(items.map((i) => [i.id, i]));
  return ids.flatMap((id) => { const i = porId.get(id); return i ? [i] : []; });
}
