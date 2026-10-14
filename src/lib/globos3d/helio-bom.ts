import { litrosDeHelio, type ResumenHelio } from "./helio-cinta";

/** Núcleo puro, todavía sin conectar a SeccionHelio, HojaArmadoHelio ni a la lista de compra. */

/** Litros por pie cúbico: 1 ft³ = 28,316846592 L. */
export const LITROS_POR_PIE3 = 28.316846592;

export const litrosAPies3 = (litros: number): number => Math.round((litros / LITROS_POR_PIE3) * 100) / 100;

export type LineaBomHelio = { formatoId: string; infladoCm: number; cantidad: number; litros: number; pies3: number; litrosPorGlobo: number };
export type BomHelio = { lineas: LineaBomHelio[]; litros: number; pies3: number; metrosCinta: number; metrosCintaPorGlobo: number };

/** La línea de helio y cinta para la lista de materiales: por tamaño en litros y ft³, y la cinta total y por globo. `null` sin helio. */
export function bomHelio(resumen: ResumenHelio | null): BomHelio | null {
  if (!resumen) return null;
  return {
    lineas: resumen.filas.map((f) => ({ formatoId: f.formatoId, infladoCm: f.infladoCm, cantidad: f.cantidad, litros: f.litros, pies3: litrosAPies3(f.litros), litrosPorGlobo: litrosDeHelio(f.infladoCm, 1) })),
    litros: resumen.litros,
    pies3: litrosAPies3(resumen.litros),
    metrosCinta: resumen.metrosCinta,
    metrosCintaPorGlobo: Math.round((resumen.metrosCinta / resumen.globos) * 100) / 100,
  };
}
