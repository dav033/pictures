import { nombreGenerico } from "./biblioteca";
import type { CalibracionBomba } from "./bomba-segundos";
import type { Escena, EscenaArmada, NodoArmado } from "./escena";
import { nombreYHex } from "./hoja-armado-comun";
import { llevaTubos, MAX_GLOBOS_COMPACTA, sumarFilaCompacta, type FilaCompacta } from "./hoja-armado-compacta";
import { estructuraDeNodo, unirEstructuras } from "./hoja-armado-estructura";
import { globosPorUnidad } from "./hoja-armado-local";
import type { EstructuraHoja, HojaArmado, LineaLista } from "./hoja-armado-tipos";
import { textoNombres } from "./hoja-armado-texto";
import { agruparPiezas, type GrupoDePiezas } from "./piezas-agrupadas";
import type { Pieza } from "./piezas";

/**
 * La hoja de armado de una escena armada. Las piezas iguales se juntan (`agruparPiezas`, la misma agrupación de la lista de
 * compra): una estructura de la hoja es una pieza o varias iguales, descrita UNA vez con su número de copias. Las piezas con
 * hasta tres globos por copia y las que solo llevan tubos o links van en una tabla compacta, no en una página cada una. Todo
 * sale de `armarEscena`; nada se vuelve a contar a mano.
 */

export { paginasDeHoja } from "./hoja-armado-paginas";
export type { EstructuraHoja, HojaArmado, LineaLista, ModoHoja, NotaModulo, PaginaHoja, TrozoEstructura, TrozoHoja, TrozoLista } from "./hoja-armado-tipos";

/** Lista de compra: los mismos materiales que muestra la lista del taller, del más numeroso al menos. */
function listaDe(armada: EscenaArmada): LineaLista[] {
  return [...armada.materiales]
    .sort((a, b) => b.cantidad - a.cantidad)
    .map((m) => ({ formatoId: m.formatoId, codigo: m.codigo, cantidad: m.cantidad, ...nombreYHex(m.codigo) }));
}

/**
 * Las estructuras de un grupo de piezas iguales: una, o varias si las piezas llevan lo mismo pero armado distinto (dos columnas
 * de los mismos colores, una espiral y otra zig-zag). El título no cuenta piezas (el encabezado ya dice cuántas copias iguales
 * hay): una sola variante lleva el nombre del grupo; varias, los nombres de sus piezas, para saber cuál es cuál.
 */
function estructurasDeGrupo(grupo: GrupoDePiezas, piezas: ReadonlyMap<string, Pieza>, calibracion: CalibracionBomba): EstructuraHoja[] {
  const variantes = new Map<string, EstructuraHoja[]>();
  for (const nodo of grupo.piezas) {
    const estructura = estructuraDeNodo(nodo, piezas.get(nodo.id), calibracion);
    variantes.set(estructura.firma, [...(variantes.get(estructura.firma) ?? []), estructura]);
  }
  const base = grupo.piezas.length > 1 ? grupo.nombre : (grupo.piezas[0]?.nombre ?? grupo.nombre);
  const nombreDelGrupo = grupo.sufijo ? `${base} (${grupo.sufijo})` : base;
  return [...variantes.values()].map((iguales) => unirEstructuras(iguales, variantes.size === 1 ? nombreDelGrupo : textoNombres(iguales.map((e) => e.nombre))));
}

const tieneContenido = (nodo: NodoArmado) => nodo.copias > 0 && (nodo.globos.length > 0 || llevaTubos(nodo));

/** La hoja completa de la escena. */
export function hojaDeEscena(nombre: string, escena: Escena, armada: EscenaArmada, calibracion: CalibracionBomba = {}): HojaArmado {
  const piezas = new Map(escena.nodos.map((n) => [n.id, n.pieza] as const));
  const estructuras: EstructuraHoja[] = [];
  const compactas = new Map<string, FilaCompacta>();
  const otras = new Map<string, number>();
  for (const grupo of agruparPiezas(armada.porNodo)) {
    for (const nodo of grupo.piezas) {
      // Una pieza que no se pudo poner (copias 0) no es una pieza sin globos: sus avisos ya salen arriba, en la hoja.
      if (tieneContenido(nodo) || nodo.copias === 0) continue;
      const generico = nombreGenerico(nodo.nombre);
      otras.set(generico, (otras.get(generico) ?? 0) + Math.max(1, nodo.copias));
    }
    const conContenido = grupo.piezas.filter(tieneContenido);
    if (!conContenido.length) continue;
    if (globosPorUnidad(conContenido[0]!) <= MAX_GLOBOS_COMPACTA) {
      for (const nodo of conContenido) sumarFilaCompacta(compactas, nodo, piezas.get(nodo.id), nodo.copias, calibracion);
    } else estructuras.push(...estructurasDeGrupo({ ...grupo, piezas: conContenido }, piezas, calibracion));
  }
  const filas = [...compactas.values()];
  return {
    nombre,
    piezas: escena.nodos.length,
    globos: armada.globos.length,
    estructuras,
    compactas: filas,
    otrasPiezas: [...otras.entries()].map(([generico, n]) => (n > 1 ? `${generico} × ${n}` : generico)),
    lista: listaDe(armada),
    segundosBomba: estructuras.reduce((s, e) => s + e.segundosBomba, 0) + filas.reduce((s, f) => s + f.segundosBomba, 0),
    avisos: armada.avisos,
  };
}
