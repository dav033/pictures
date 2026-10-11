import { filasBomba, inflablesDeEscena, type CalibracionBomba } from "./bomba-segundos";
import type { NodoArmado } from "./escena";
import { formatoPorId } from "./formatos";
import { nombreGenerico } from "./biblioteca";
import { esGloboDeHelio } from "./helio-cinta";
import { floresDeUnidad, rellenoDe, textoFlores, type LineaFlor } from "./hoja-armado-anexos";
import { claveDeGlobo, nombreYHex, sumaSinRedondear, type LineaColorCapa } from "./hoja-armado-comun";
import { impresoDe, type ImpresoHoja } from "./hoja-armado-impresos";
import { textoNombres } from "./hoja-armado-texto";
import { globosDeUnidad } from "./hoja-armado-local";
import type { GloboDePieza, Pieza } from "./piezas";

/**
 * La tabla de piezas pequeñas: las que llevan hasta `MAX_GLOBOS_COMPACTA` globos por copia y las que solo llevan tubos o links
 * (un tubito enrollado, un Link-O-Loon 660). Ocuparían una página cada una; aquí las iguales se juntan en una fila.
 */

export const MAX_GLOBOS_COMPACTA = 3;

/** Una línea de lo que lleva UNA copia: globos (con su tamaño inflado) o tubos y links (enteros). */
export type LineaContenido = LineaColorCapa & {
  /** Distingue la línea: dos globos del mismo color y tamaño, uno de helio o impreso y el otro no, van en líneas distintas. */
  clave: string;
  infladoCm?: number;
  helio: boolean;
  impreso?: ImpresoHoja;
  /** Un cristal relleno de confeti. */
  confeti: boolean;
  /** La parte de la pieza (el cuerpo y la cabeza de una araña, el exterior de una burbuja). */
  parte?: string;
};

/** Lo que se imprime junto a una línea: de helio, el impreso, el confeti y la parte de la pieza. */
export const marcasDeLinea = (l: LineaContenido): string[] =>
  [l.helio ? "de helio" : "", l.impreso?.texto ?? "", l.confeti ? "con confeti dentro" : "", l.parte ? `(${l.parte})` : ""].filter(Boolean);

/** «Dónde: sobre «Columna…» (arriba a la izquierda)»: dónde van los globos impresos de la fila; `undefined` si no se sabe. */
export const dondeDeFila = (f: Pick<FilaCompacta, "lugares">): string | undefined => (f.lugares.length ? `Dónde: ${textoNombres(f.lugares)}` : undefined);

/** Las flores y el relleno de cada copia de una fila, como se imprimen. */
export const anexosDeFila = (f: Pick<FilaCompacta, "flores" | "relleno">): string[] => [...(f.flores.length ? [textoFlores(f.flores)] : []), ...(f.relleno ? [f.relleno] : [])];

export type FilaCompacta = {
  /** Nombres genéricos de las piezas que se juntaron en la fila. */
  nombres: string[];
  /** Cuántas copias de estas piezas hay en total. */
  unidades: number;
  /** Lo que lleva cada copia. */
  contenido: LineaContenido[];
  /** Lo que lleva cada copia además de globos y tubos: sus flores y el relleno de una burbuja (ver `hoja-armado-anexos.ts`). */
  flores: LineaFlor[];
  relleno?: string;
  /** Dónde va cada pieza de la fila (ver `dondeVaNodo`); solo las filas con globos impresos lo dicen. */
  lugares: string[];
  /** Globos de todas las copias. */
  globos: number;
  /** Segundos de bomba de todas las copias, sin redondear. */
  segundosBomba: number;
};

/** Tubitos y Link-O-Loon 660: los formatos con largo propio (se compran y se inflan enteros, no por burbuja). */
export const esFormatoDeTubo = (formatoId: string): boolean => formatoPorId(formatoId)?.largoCm !== undefined;

/** Los tubos y links de UNA copia de la pieza, por formato y color. */
export function tubosDeUnidad(nodo: NodoArmado): LineaColorCapa[] {
  if (nodo.copias <= 0) return [];
  return nodo.materiales
    .filter((m) => esFormatoDeTubo(m.formatoId))
    .map((m) => ({ formatoId: m.formatoId, codigo: m.codigo, ...nombreYHex(m.codigo), cantidad: Math.round(m.cantidad / nodo.copias) }))
    .filter((l) => l.cantidad > 0);
}

/** Cuántos tubos o links lleva la pieza en total. */
export const llevaTubos = (nodo: NodoArmado): boolean => nodo.copias > 0 && nodo.materiales.some((m) => esFormatoDeTubo(m.formatoId) && m.cantidad > 0);

/** Los globos de una copia contados por formato, color, tamaño inflado, helio, impreso, confeti y parte de la pieza. */
function globosContados(globos: readonly GloboDePieza[]): LineaContenido[] {
  const cuenta = new Map<string, LineaContenido>();
  for (const g of globos) {
    const { formatoId, codigo, infladoCm, parte } = g;
    const helio = esGloboDeHelio(g), impreso = impresoDe(g.estampado), confeti = g.confeti === true;
    // El tamaño al cm, el que se imprime: dos globos de 27,5 y 28,4 cm se inflan igual («a 28 cm») y van en la misma fila.
    const clave = `${claveDeGlobo({ formatoId, codigo, infladoCm: Math.round(infladoCm), helio, impreso, confeti })}|${parte ?? ""}`;
    const previo = cuenta.get(clave);
    if (previo) { previo.cantidad += 1; continue; }
    cuenta.set(clave, { formatoId, codigo, ...nombreYHex(codigo), cantidad: 1, infladoCm, clave, helio, impreso, confeti, parte });
  }
  return [...cuenta.values()];
}

/** Lo que lleva UNA copia de la pieza: sus globos y, después, sus tubos y links. */
export function contenidoDeUnidad(nodo: NodoArmado): LineaContenido[] {
  const tubos = tubosDeUnidad(nodo).map((l) => ({ ...l, clave: `tubo|${l.formatoId}|${l.codigo}`, helio: false, confeti: false }));
  return [...globosContados(globosDeUnidad(nodo)), ...tubos];
}

/** Segundos de bomba de UNA copia de la pieza (globos y tubitos), sin redondear. */
export function segundosDeUnidad(nodo: NodoArmado, calibracion: CalibracionBomba): number {
  const materiales = tubosDeUnidad(nodo).map((l) => ({ formatoId: l.formatoId, cantidad: l.cantidad }));
  return sumaSinRedondear(filasBomba(inflablesDeEscena({ globos: globosDeUnidad(nodo), materiales }), calibracion));
}

const claveDeFila = (contenido: readonly LineaContenido[], anexos: readonly string[]) => JSON.stringify([contenido.map((l) => `${l.clave}|${l.cantidad}`), anexos]);

/** Suma `copias` copias de una pieza pequeña a la tabla: las que llevan lo mismo (aunque se llamen distinto) quedan en una fila. */
export function sumarFilaCompacta(filas: Map<string, FilaCompacta>, nodo: NodoArmado, pieza: Pieza | undefined, copias: number, calibracion: CalibracionBomba, lugar?: string): void {
  const contenido = contenidoDeUnidad(nodo);
  const flores = floresDeUnidad(nodo), relleno = rellenoDe(pieza, nodo);
  const clave = claveDeFila(contenido, anexosDeFila({ flores, relleno }));
  const porUnidad = globosDeUnidad(nodo).length;
  const fila = filas.get(clave) ?? { nombres: [], unidades: 0, contenido, flores, relleno, lugares: [], globos: 0, segundosBomba: 0 };
  if (lugar && contenido.some((l) => l.impreso) && !fila.lugares.includes(lugar)) fila.lugares.push(lugar);
  const nombre = nombreGenerico(nodo.nombre);
  if (!fila.nombres.includes(nombre)) fila.nombres.push(nombre);
  fila.unidades += copias;
  fila.globos += porUnidad * copias;
  fila.segundosBomba += segundosDeUnidad(nodo, calibracion) * copias;
  filas.set(clave, fila);
}
