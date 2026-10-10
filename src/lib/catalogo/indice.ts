import type { ContenidoItem, ItemBiblioteca } from "@/lib/globos3d/biblioteca";
import type { Pieza } from "@/lib/globos3d/piezas";
import { ASIGNACION_FONDOS, idCortoDeFondo } from "./asignacion-fondos";
import { idCalificado, parsearId, REPOSITORIOS_FUNDADORES, type IdParseado } from "./ids";
import { MANIFIESTOS } from "./manifiestos";
import type { IdRepositorio } from "./tipos";

/**
 * El **índice de ids locales** del catálogo (REQ-013, SPEC §5.1), sin cargar ningún repositorio: los prefijos que reclaman los
 * manifiestos (Sempertex) y los ids exactos de mobiliario y escenografía, que son los de `ASIGNACION_FONDOS`
 * (`test-catalogo-repositorios` comprueba que son exactamente los de sus cargadores). Con él, a qué repositorio va un id, una
 * pieza o un item. Entrada liviana: los tipos del motor que usa se borran al compilar (`test-catalogo-capas`).
 */

/** Quién reclama un id local: por prefijo o por id exacto. Dos reclamos = «ambiguo» (las pruebas exigen que no pase). */
export function repositorioDeIdLocal(idLocal: string): IdRepositorio | "ambiguo" | undefined {
  const reclamos = REPOSITORIOS_FUNDADORES.filter((id) => {
    const reclamo = MANIFIESTOS[id].idsLocales;
    return "prefijos" in reclamo ? reclamo.prefijos.some((p) => idLocal.startsWith(p)) : ASIGNACION_FONDOS.get(idLocal) === id;
  });
  return reclamos.length > 1 ? "ambiguo" : reclamos[0];
}

export const parsearIdCatalogo = (s: string): IdParseado => parsearId(s, repositorioDeIdLocal);

/** El id calificado de un id local; `undefined` si ningún repositorio lo reclama. */
export function calificar(idLocal: string): string | undefined {
  const r = repositorioDeIdLocal(idLocal);
  return r && r !== "ambiguo" ? idCalificado(r, idLocal) : undefined;
}

/**
 * El repositorio de una pieza (R2): un mueble o fondo del catálogo (`mueble.id`, también los generadores) es del suyo; los globos,
 * la utilería de la tienda y la escenografía dibujada dentro de una idea (sin `mueble`) son de Sempertex. `undefined`: un
 * `mueble.id` que no está en el catálogo (el motor dibuja una caja roja) o calificado con otro repositorio.
 */
export function repositorioDePieza(p: Pieza): IdRepositorio | undefined {
  if (p.tipo !== "escenografia" || p.utileria || !p.mueble) return "sempertex";
  const corto = idCortoDeFondo(p.mueble.id);
  return corto === null ? undefined : ASIGNACION_FONDOS.get(corto);
}

const piezasDe = (c: ContenidoItem): Pieza[] =>
  c.tipo === "pieza" ? [c.pieza] : c.tipo === "conjunto" ? [c.conjunto.raiz.pieza, ...c.conjunto.hijos.map((h) => h.pieza)] : c.escena.nodos.map((n) => n.pieza);

/**
 * El repositorio de un item de la biblioteca (R2): lo de fábrica y lo derivado, por su prefijo (Sempertex); lo guardado por el
 * usuario, por su contenido: con cualquier pieza de Sempertex es de Sempertex; si solo trae muebles o fondos, el del primero.
 */
export function repositorioDeItem(item: ItemBiblioteca): IdRepositorio {
  const porId = item.propio ? undefined : repositorioDeIdLocal(item.id);
  if (porId && porId !== "ambiguo") return porId;
  const repos = piezasDe(item.contenido).map(repositorioDePieza);
  return repos.includes("sempertex") ? "sempertex" : repos.find((r) => r !== undefined) ?? "sempertex";
}
