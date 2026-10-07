import type { FormatoGlobo } from "./formatos";
import { armarTrenza, PATRONES_TRENZA, PASO_POR_DIAMETRO, RADIO_TRENZA_POR_DIAMETRO, type GloboDeTrenza, type PatronTrenza } from "./trenza";

/**
 * La columna de cuartetos (la «trenza» de Sempertex en vertical): cuartetos apilados sobre una cuerda, cada uno
 * girado 1/8 de vuelta respecto al de abajo. Es `armarTrenza` con un recorrido recto hacia arriba.
 */
export type PatronColumna = PatronTrenza;
export const PATRONES_COLUMNA = PATRONES_TRENZA;
export { PASO_POR_DIAMETRO, RADIO_TRENZA_POR_DIAMETRO as RADIO_COLUMNA_POR_DIAMETRO };
export type GloboDeColumna = GloboDeTrenza;

export type ColumnaArmada = {
  niveles: number;
  alturaCm: number;
  pasoCm: number;
  globos: GloboDeColumna[];
  materiales: Array<{ codigo: string; cantidad: number }>;
};

export function armarColumna(opciones: { formato: FormatoGlobo; infladoCm: number; alturaCm: number; patron: PatronColumna; colores: readonly string[] }): ColumnaArmada {
  const { formato, infladoCm, alturaCm, patron, colores } = opciones;
  const trenza = armarTrenza({ formato, infladoCm, patron, colores, recorrido: [{ x: 0, y: 0 }, { x: 0, y: alturaCm }], reparto: "paso" });
  return {
    niveles: trenza.niveles,
    // Alto real: del borde de abajo del primer cuarteto al de arriba del último (un cuarteto casi plano mide ~1 diámetro).
    alturaCm: Math.round((trenza.niveles - 1) * trenza.pasoCm + infladoCm * 1.06),
    pasoCm: trenza.pasoCm,
    globos: trenza.globos,
    materiales: trenza.materiales,
  };
}
