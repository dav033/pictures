import type { NodoArmado } from "./escena";
import { gruposDeHelio, LITROS_POR_TANQUE, METROS_CINTA_POR_GLOBO, PERDIDA_HELIO, resumenHelio, type FilaHelio, type ResumenHelio } from "./helio-cinta";
import type { Pieza } from "./piezas";
import { plural, textoGlobos, textoNumero } from "./texto-cantidad";

/**
 * El helio y la cinta de la hoja de armado. No hay cuentas nuevas: son las de la lista de compra (`SeccionHelio`), que salen de
 * `resumenHelio` sobre `gruposDeHelio`; aquí solo se agrupan por estructura y se escriben para el papel.
 */

/** Más tamaños distintos que esto en un resumen: la hoja da los totales y manda a la lista de compra por el detalle de cada tamaño. */
export const MAX_FILAS_HELIO = 6;

/** El helio de unas piezas armadas (todas sus copias), con las mismas cuentas de la lista de compra; `undefined` si no llevan helio. */
export function helioDeNodos(nodos: readonly NodoArmado[], piezas: ReadonlyMap<string, Pieza>): ResumenHelio | undefined {
  const conPieza = nodos.flatMap((n) => { const pieza = piezas.get(n.id); return pieza ? [{ id: n.id, pieza }] : []; });
  return resumenHelio(gruposDeHelio(conPieza, nodos)) ?? undefined;
}

/** Las filas por formato y tamaño que caben en el papel; `null` si son demasiadas. */
export const filasDeHelio = (resumen: ResumenHelio): readonly FilaHelio[] | null => (resumen.filas.length <= MAX_FILAS_HELIO ? resumen.filas : null);

/** «6 × R-12 inflado a 28 cm». */
export const textoGloboDeHelio = (f: FilaHelio): string => `${f.cantidad} × ${f.formatoId} inflado a ${textoNumero(f.infladoCm)} cm`;

/** «0,7 % de un tanque de 10.000 L» o, de uno en adelante, «1,3 tanques de 10.000 L»: lo que pide una estructura sola, sin redondear a tanques enteros. */
export function textoParteDeTanque(litros: number): string {
  const tanques = litros / LITROS_POR_TANQUE;
  const nominal = textoNumero(LITROS_POR_TANQUE);
  if (tanques >= 1) return `${textoNumero(tanques)} ${plural(Math.round(tanques * 10) / 10, "tanque", "tanques")} de ${nominal} L`;
  const porcentaje = tanques * 100;
  return porcentaje < 0.1 ? `menos de 0,1 % de un tanque de ${nominal} L` : `${textoNumero(porcentaje)} % de un tanque de ${nominal} L`;
}

const perdida = `${Math.round(PERDIDA_HELIO * 100)} % de pérdida`;

/** El cierre del bloque de una estructura: globos, litros, cinta y la parte de un tanque. */
export const textoCierreDeEstructura = (r: ResumenHelio): string =>
  `${textoGlobos(r.globos)} de helio · ${textoNumero(r.litros)} L con ${perdida} · cinta: ${textoNumero(r.metrosCinta)} m · ${textoParteDeTanque(r.litros)}`;

/** El cierre del total de la hoja: litros, tanques enteros y cinta. */
export const textoCierreDeTotal = (r: ResumenHelio): string =>
  `Total: ${textoNumero(r.litros)} L de helio con ${perdida} · ${r.tanques} ${plural(r.tanques, "tanque", "tanques")} de ${textoNumero(LITROS_POR_TANQUE)} L nominales · cinta: ${textoNumero(r.metrosCinta)} m`;

/** Lo que la estimación no cuenta ni supone, escrito para quien arma con la hoja en la mano. */
export const NOTA_ESTIMACION_HELIO =
  `Estimación: litros de la esfera de cada globo inflado. La cinta es la de la pieza; sin dato, ${textoNumero(METROS_CINTA_POR_GLOBO)} m por globo. No cuenta los metalizados (foil). Confirmar el tanque con el proveedor.`;

/** Lo que el papel remite a la lista de compra cuando hay demasiados tamaños para escribirlos. */
export const textoDetalleEnLista = (resumen: ResumenHelio): string => `${resumen.filas.length} tamaños distintos: el detalle por tamaño está en la lista de compra.`;
