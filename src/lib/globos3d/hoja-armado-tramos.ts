import { filasBomba, type CalibracionBomba, type FilaBomba } from "./bomba-segundos";
import {
  agruparDesdePrimero, colorear, globoHoja, marcasDe, sumaSinRedondear, tamanosDe,
  type GloboHoja, type LineaColorCapa, type LineaTamano,
} from "./hoja-armado-comun";
import type { CentroLocal } from "./hoja-armado-local";

/**
 * Las tablas de la hoja para lo que no se arma en anillos. Siempre en el espacio de la pieza (no el del salón):
 * - por **altura** (arcos orgánicos, racimos, techos, formas): franjas de `ALTO_TRAMO_CM`, medidas sobre el punto más bajo de la
 *   pieza; es una tabla para contar y preparar los globos de cada franja, NO un orden de armado por capas;
 * - por **pared** (mallas y trenzas): tramos de `ANCHO_TRAMO_PARED_CM` a lo largo de la pared, numerados desde un extremo,
 *   que `sentidoDePared` nombra;
 * - por **capa** (`nivel`): un tramo por capa, para lo que tiene capas pero no del tamaño de un módulo (un cono de anillos).
 */

/** Altura de cada tramo de una pieza que no es anillo (cm). */
export const ALTO_TRAMO_CM = 20;
/** Ancho de cada tramo a lo largo de una pared (cm). */
export const ANCHO_TRAMO_PARED_CM = 60;

export type GloboNumerado = GloboHoja & { numero: number };

/** Un tramo de una pieza sin anillos: sus globos, colores, tamaños y bomba. */
export type TramoHoja = {
  numero: number;
  etiqueta: string;
  desdeCm: number;
  hastaCm: number;
  globos: GloboNumerado[];
  colores: LineaColorCapa[];
  tamanos: LineaTamano[];
  /** Cuántos van de helio, impresos o con confeti (ver `marcasDe`). */
  marcas: string[];
  filasBomba: FilaBomba[];
  segundosBomba: number;
};

/** Eje a lo largo de la pieza: el de mayor extensión entre x y z (en una pared, el de la pared). */
export function ejeLargo(centros: readonly { x: number; z: number }[]): "x" | "z" {
  const rango = (v: (c: { x: number; z: number }) => number) => Math.max(...centros.map(v)) - Math.min(...centros.map(v));
  return rango((c) => c.x) >= rango((c) => c.z) ? "x" : "z";
}

/** Dónde queda el globo 1 de una pared y hacia dónde sube la numeración (x local es la derecha vista de frente, desde el salón). */
export function sentidoDePared(centros: readonly CentroLocal[]): string {
  if (!centros.length) return "";
  return ejeLargo(centros) === "x"
    ? "El globo 1 está en el extremo izquierdo de la pared, visto de frente (desde el salón); la numeración sube hacia la derecha."
    : "El globo 1 está en el extremo del fondo de la pared; la numeración sube hacia el frente.";
}

function tramoDe(grupo: readonly CentroLocal[], numero: number, primerNumero: number, etiqueta: string, desdeCm: number, hastaCm: number, posicion: (c: CentroLocal) => number, calibracion: CalibracionBomba): TramoHoja {
  const ordenados = [...grupo].sort((a, b) => posicion(a) - posicion(b));
  const globos: GloboNumerado[] = ordenados.map((c, k) => ({ ...globoHoja(c, posicion(c)), numero: primerNumero + k }));
  const filas = filasBomba(grupo.map((c) => c.globo), calibracion);
  return { numero, etiqueta, desdeCm, hastaCm, globos, colores: colorear(globos), tamanos: tamanosDe(globos), marcas: marcasDe(globos), filasBomba: filas, segundosBomba: sumaSinRedondear(filas) };
}

/**
 * Tramos de una pieza sin anillos. Por altura: cada tramo cubre `ALTO_TRAMO_CM` desde su primer globo. Por pared: cada
 * tramo cubre `ANCHO_TRAMO_PARED_CM` a lo largo de la pared, de menor a mayor. La numeración es continua de un extremo al
 * otro (monótona en la posición a lo largo de la pieza).
 */
export function tramosDeGlobos(centros: readonly CentroLocal[], modo: "alturas" | "paredes", calibracion: CalibracionBomba = {}): TramoHoja[] {
  if (!centros.length) return [];
  const eje = ejeLargo(centros);
  const minEje = Math.min(...centros.map((c) => c[eje]));
  const pos = (c: CentroLocal) => c[eje] - minEje;
  const minAltura = Math.min(...centros.map((c) => c.y));
  const grupos = modo === "paredes"
    ? agruparDesdePrimero(centros, pos, ANCHO_TRAMO_PARED_CM)
    : agruparDesdePrimero(centros, (c) => c.y, ALTO_TRAMO_CM);
  let primerNumero = 1;
  return grupos.map((grupo, i) => {
    const posiciones = grupo.map(pos);
    const alturas = grupo.map((c) => c.y - minAltura);
    const desde = Math.round(Math.min(...posiciones)), hasta = Math.round(Math.max(...posiciones));
    const etiqueta = modo === "paredes"
      ? `Tramo ${i + 1}: de ${desde} a ${hasta} cm a lo largo de la pared`
      : `Tramo ${i + 1}: de ${Math.round(Math.min(...alturas))} a ${Math.round(Math.max(...alturas))} cm de altura`;
    const tramo = tramoDe(grupo, i + 1, primerNumero, etiqueta, desde, hasta, pos, calibracion);
    primerNumero += grupo.length;
    return tramo;
  });
}

/** Un tramo por capa (`nivel`), de la de abajo a la de arriba: lo que tiene capas pero no del tamaño de un módulo. */
export function tramosPorCapa(niveles: readonly (readonly CentroLocal[])[], calibracion: CalibracionBomba = {}): TramoHoja[] {
  if (!niveles.length) return [];
  const base = Math.min(...niveles.flat().map((c) => c.y - c.globo.infladoCm / 2));
  let primerNumero = 1;
  return niveles.map((grupo, i) => {
    const altura = Math.round(grupo.reduce((s, c) => s + c.y, 0) / grupo.length - base);
    const etiqueta = `Capa ${i + 1}: a ${altura} cm de la base`;
    const tramo = tramoDe(grupo, i + 1, primerNumero, etiqueta, altura, altura, (c) => c.y, calibracion);
    primerNumero += grupo.length;
    return tramo;
  });
}
