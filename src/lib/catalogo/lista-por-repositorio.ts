import type { LineaEscenografia, ProductosDeItem } from "@/lib/globos3d/biblioteca";
import type { Escena } from "@/lib/globos3d/escena";
import { repositorioDePieza } from "./indice";
import type { IdRepositorio } from "./tipos";

/**
 * La lista de compra por repositorio (REQ-013 fase 5, T25, SPEC §8): las líneas de «Escenografía» de `productosDe` (lo que va en la
 * foto y no se compra en la tienda como producto) se reparten en «Mobiliario» —lo que se alquila: sillas, mesas, sofás, los
 * conjuntos de mesa con sillas— y «Escenografía» —fondos, decorado y lo que traen las ideas de Sempertex—. `productosDe` no cambia:
 * la lista de siempre y la partida se derivan de la misma, y la guiada, que solo ve Sempertex, no pasa por aquí.
 */

export type EscenografiaPorRepositorio = { mobiliario: readonly LineaEscenografia[]; escenografia: readonly LineaEscenografia[] };

/**
 * Reparte las líneas por el repositorio de las piezas de la escena que las componen (`LineaEscenografia.piezas` son los nombres de
 * sus nodos). Es de mobiliario la línea de escenografía cuyas piezas son todas de mobiliario (`repositorioDePieza`); papel y follaje, y
 * lo que no se reconoce (un mueble que ya no está en el catálogo), se quedan en «Escenografía», como hoy. El orden de cada parte es el de siempre.
 */
export function repartirEscenografia(escena: Escena, lineas: readonly LineaEscenografia[]): EscenografiaPorRepositorio {
  const repositoriosPorNombre = new Map<string, Set<IdRepositorio | undefined>>();
  for (const nodo of escena.nodos) {
    const conocidos = repositoriosPorNombre.get(nodo.nombre) ?? new Set<IdRepositorio | undefined>();
    conocidos.add(repositorioDePieza(nodo.pieza));
    repositoriosPorNombre.set(nodo.nombre, conocidos);
  }
  const esMobiliario = (linea: LineaEscenografia) => linea.clase === "escenografia" && linea.piezas.length > 0
    && linea.piezas.every((nombre) => { const repositorios = repositoriosPorNombre.get(nombre); return repositorios?.size === 1 && repositorios.has("mobiliario"); });
  return { mobiliario: lineas.filter(esMobiliario), escenografia: lineas.filter((linea) => !esMobiliario(linea)) };
}

/** Las líneas del texto que se copia de la lista: la sección «Escenografía» de siempre, o «Mobiliario» y «Escenografía» si ya está repartida. */
export function escenografiaEnTexto(lineas: ProductosDeItem["escenografia"], partes: EscenografiaPorRepositorio | null): string[] {
  const seccion = (titulo: string, delGrupo: readonly LineaEscenografia[]) => (delGrupo.length ? ["", `${titulo} (no es producto de la tienda)`, ...delGrupo.map((e) => `${e.cantidad} × ${e.nombre}`)] : []);
  return partes ? [...seccion("MOBILIARIO", partes.mobiliario), ...seccion("ESCENOGRAFÍA", partes.escenografia)] : seccion("ESCENOGRAFÍA", lineas);
}
