import type { ItemBiblioteca } from "@/lib/globos3d/biblioteca";
import { ASIGNACION_FONDOS, GENERADORES_MOBILIARIO, type RepositorioDeFondos } from "./asignacion-fondos";
import { repositorioDeItem } from "./indice";
import type { RepositorioPublico, RespuestaRepositorios } from "./repositorios-api-tipos";
import type { IdRepositorioFundador } from "./tipos";

/**
 * La lógica del panel «Añadir» por repositorio (REQ-013 fase 5, SPEC §9), sin React ni red: qué repositorios ofrece el selector,
 * qué bloques muestra cada elección, cuántas entradas tiene cada repositorio y de dónde viene lo que se añade. Los componentes
 * (`PanelAnadir`, `SelectorRepositorio`, `FondosYMuebles`) solo pintan lo que esto dice.
 */

/** Los repositorios que el panel sabe pintar hoy; un paquete `terceros/<slug>` llegará con la fase 7. */
export type RepositorioDeAnadir = IdRepositorioFundador;
export type EleccionAnadir = "todos" | RepositorioDeAnadir;

export const REPOSITORIOS_DE_ANADIR: readonly RepositorioDeAnadir[] = ["sempertex", "mobiliario", "escenografia"];
const REPOSITORIOS_DE_FONDOS: readonly RepositorioDeFondos[] = ["mobiliario", "escenografia"];

const esDeAnadir = (id: string): id is RepositorioDeAnadir => (REPOSITORIOS_DE_ANADIR as readonly string[]).includes(id);

/**
 * Los repositorios que ofrece el selector, en el orden de los manifiestos; `null` cuando el panel queda como siempre: la interfaz
 * apagada (la marcha atrás), la lectura sin llegar o fallida, o ningún repositorio visible que el panel sepa pintar.
 */
export function visiblesParaAnadir(respuesta: RespuestaRepositorios | null): readonly RepositorioDeAnadir[] | null {
  if (!respuesta?.ui) return null;
  const visibles = respuesta.repositorios.filter((r) => r.visible).map((r) => r.id).filter(esDeAnadir);
  return visibles.length ? visibles : null;
}

/** Las opciones del selector: «Todos» solo si hay más de un repositorio que juntar. */
export function opcionesDelSelector(visibles: readonly RepositorioDeAnadir[]): readonly EleccionAnadir[] {
  return visibles.length > 1 ? ["todos", ...visibles] : visibles;
}

/** La elección que vale: la pedida si sigue visible; si no, «Todos» (o el único repositorio que quede). */
export function eleccionVigente(pedida: EleccionAnadir, visibles: readonly RepositorioDeAnadir[]): EleccionAnadir {
  if (pedida === "todos" ? visibles.length > 1 : visibles.includes(pedida)) return pedida;
  return visibles.length > 1 ? "todos" : visibles[0] ?? "todos";
}

export type VistaAnadir = {
  /** Las pestañas de Sempertex (Estructuras, Decoraciones, Utilería, Ideas) y su biblioteca. */
  sempertex: boolean;
  /** Los repositorios de fondos y muebles que muestra `FondosYMuebles`. */
  fondos: readonly RepositorioDeFondos[];
  /** `FondosYMuebles` dentro de la pestaña Utilería, como siempre (solo «Todos»); si no, solo, sin pestañas. */
  fondosEnUtileria: boolean;
};

/**
 * Qué muestra cada elección. «Todos» es el panel de siempre limitado a los repositorios visibles; Sempertex, sus cuatro pestañas
 * sin los fondos y muebles; Mobiliario y Escenografía, sus grupos de `FondosYMuebles` y lo que el usuario guardó de ellos.
 */
export function vistaDeAnadir(eleccion: EleccionAnadir, visibles: readonly RepositorioDeAnadir[]): VistaAnadir {
  const fondosVisibles = REPOSITORIOS_DE_FONDOS.filter((id) => visibles.includes(id));
  if (eleccion === "todos") return { sempertex: visibles.includes("sempertex"), fondos: fondosVisibles, fondosEnUtileria: true };
  if (eleccion === "sempertex") return { sempertex: true, fondos: [], fondosEnUtileria: false };
  return { sempertex: false, fondos: [eleccion], fondosEnUtileria: false };
}

/**
 * Los items de la biblioteca de un repositorio (`repositorioDeItem`). «Todos» son los de los repositorios que el Taller ve, y con
 * todos visibles devuelve la misma lista, sin copiarla (el panel de siempre no paga nada).
 */
export function itemsDelRepositorio(items: readonly ItemBiblioteca[], eleccion: EleccionAnadir, visibles: readonly RepositorioDeAnadir[] = REPOSITORIOS_DE_ANADIR): readonly ItemBiblioteca[] {
  if (eleccion !== "todos") return items.filter((item) => repositorioDeItem(item) === eleccion);
  if (REPOSITORIOS_DE_ANADIR.every((id) => visibles.includes(id))) return items;
  return items.filter((item) => { const repositorio = repositorioDeItem(item); return esDeAnadir(repositorio) && visibles.includes(repositorio); });
}

export type ConteosAnadir = Readonly<Record<RepositorioDeAnadir, number>>;

/**
 * Las tarjetas fijas de un repositorio de fondos, las que pinta `FondosYMuebles` (mobiliario 26 + la de la mesa con sillas a medida, escenografía 25):
 * los dos generadores (mesa y sillas a medida) se ofrecen en esa única tarjeta, así que el selector y las tarjetas cuentan lo mismo.
 */
const fijasDe = (repositorio: RepositorioDeFondos): number => {
  const entradas = [...ASIGNACION_FONDOS.values()].filter((r) => r === repositorio).length;
  return repositorio === "mobiliario" ? entradas - GENERADORES_MOBILIARIO.length + 1 : entradas;
};

/** Cuántas tarjetas tiene cada repositorio: las fijas del catálogo más lo de la biblioteca (de fábrica, derivado y propio) que le toca. */
export function conteosPorRepositorio(items: readonly ItemBiblioteca[]): ConteosAnadir {
  const cuentas: Record<RepositorioDeAnadir, number> = { sempertex: 0, mobiliario: fijasDe("mobiliario"), escenografia: fijasDe("escenografia") };
  for (const item of items) {
    const repositorio = repositorioDeItem(item);
    if (esDeAnadir(repositorio)) cuentas[repositorio] += 1;
  }
  return cuentas;
}

const REGIMEN: Readonly<Record<RepositorioPublico["licencia"]["regimen"], string>> = {
  propia: "propia", "marca-socio": "de la marca socia", referencia: "de referencia", "cc-by": "CC BY", cc0: "CC0", comercial: "comercial",
};

/** De dónde viene lo de un repositorio: nombre, versión, licencia con su titular y, si no se vende, por qué no se cotiza. */
export function procedenciaDe(repositorio: RepositorioPublico): string {
  const { nombre, version, licencia, precio } = repositorio;
  const partes = [`${nombre} v${version}`, `licencia ${REGIMEN[licencia.regimen]}: ${licencia.titular}`];
  if (precio.tipo === "sin-precio") partes.push(`no cotiza${precio.motivo ? ` (${precio.motivo})` : ""}`);
  return partes.join(" · ");
}

/** La procedencia de un item de la biblioteca: la de su repositorio, si la interfaz por repositorio está en marcha (si no, `null`). */
export function procedenciaDeItem(item: ItemBiblioteca, respuesta: RespuestaRepositorios | null): string | null {
  if (!respuesta?.ui) return null;
  const repositorio = respuesta.repositorios.find((r) => r.id === repositorioDeItem(item));
  return repositorio ? procedenciaDe(repositorio) : null;
}

/** La procedencia de cada repositorio que el panel pinta. */
export function procedenciasDeRepositorios(respuesta: RespuestaRepositorios | null): Partial<Record<RepositorioDeAnadir, string>> {
  const procedencias: Partial<Record<RepositorioDeAnadir, string>> = {};
  for (const repositorio of respuesta?.repositorios ?? []) if (esDeAnadir(repositorio.id)) procedencias[repositorio.id] = procedenciaDe(repositorio);
  return procedencias;
}

const NOMBRES_DE_SIEMPRE: Readonly<Record<RepositorioDeAnadir, string>> = { sempertex: "Sempertex", mobiliario: "Mobiliario", escenografia: "Escenografía" };

/** Cómo se llama cada repositorio: el nombre de su manifiesto, o el de siempre si la lectura no lo trae. */
export function nombresDeRepositorios(respuesta: RespuestaRepositorios | null): Readonly<Record<RepositorioDeAnadir, string>> {
  const nombres: Record<RepositorioDeAnadir, string> = { ...NOMBRES_DE_SIEMPRE };
  for (const repositorio of respuesta?.repositorios ?? []) if (esDeAnadir(repositorio.id)) nombres[repositorio.id] = repositorio.nombre;
  return nombres;
}
