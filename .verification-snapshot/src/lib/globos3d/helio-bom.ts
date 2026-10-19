import { AVISO_ALCANCE_HELIO, LITROS_POR_TANQUE, litrosDeHelio, PERDIDA_HELIO, type ResumenHelio } from "./helio-cinta";
import { textoNumero } from "./texto-cantidad";

/** Núcleo puro; lo muestran SeccionHelio (lista de compra) y HojaArmadoHelio (hoja de armado). */

/** Litros por pie cúbico: 1 ft³ = 28,316846592 L. */
export const LITROS_POR_PIE3 = 28.316846592;

export const litrosAPies3 = (litros: number): number => Math.round((litros / LITROS_POR_PIE3) * 100) / 100;

export type LineaBomHelio = { formatoId: string; infladoCm: number; cantidad: number; litros: number; pies3: number; litrosPorGlobo: number };
export type BomHelio = { lineas: LineaBomHelio[]; litros: number; pies3: number; metrosCinta: number; metrosCintaPorGlobo: number; cintaUniforme: boolean };

/** La línea de helio y cinta para la lista de materiales: por tamaño en litros y ft³, y la cinta total y por globo (promedio si no es la misma en todos). `null` sin helio. */
export function bomHelio(resumen: ResumenHelio | null): BomHelio | null {
  if (!resumen) return null;
  return {
    lineas: resumen.filas.map((f) => ({ formatoId: f.formatoId, infladoCm: f.infladoCm, cantidad: f.cantidad, litros: f.litros, pies3: litrosAPies3(f.litros), litrosPorGlobo: litrosDeHelio(f.infladoCm, 1) })),
    litros: resumen.litros,
    pies3: litrosAPies3(resumen.litros),
    metrosCinta: resumen.metrosCinta,
    metrosCintaPorGlobo: Math.round((resumen.metrosCinta / resumen.globos) * 100) / 100,
    cintaUniforme: resumen.cintaUniforme,
  };
}

const nf2 = (n: number): string => n.toLocaleString("es-CO", { maximumFractionDigits: 2 });

/** «5,34 ft³» (coma decimal, hasta dos decimales). */
export const textoPies3 = (pies3: number): string => `${nf2(pies3)} ft³`;

const perdida = `${Math.round(PERDIDA_HELIO * 100)} %`;

/** «m por globo» solo si es el corte de cada globo; si la cinta varía entre piezas, se dice que es un promedio. */
const textoCintaPorGlobo = (bom: BomHelio): string =>
  bom.cintaUniforme ? `${nf2(bom.metrosCintaPorGlobo)} m por globo` : `promedio ${nf2(bom.metrosCintaPorGlobo)} m por globo`;

/** «Helio (con pérdida del 7 %): 151,3 L (5,34 ft³) · cinta: 12 m en total, 1,2 m por globo»: la única línea de litros y cinta de la lista de materiales. */
export const textoVolumenYCinta = (bom: BomHelio): string =>
  `Helio (con pérdida del ${perdida}): ${nf2(bom.litros)} L (${textoPies3(bom.pies3)}) · cinta: ${nf2(bom.metrosCinta)} m en total, ${textoCintaPorGlobo(bom)}`;

/** Las líneas de helio para el texto copiado, con su aviso de estimación (vacío si no hay helio); lo mismo que dice la pantalla. */
export function lineasHelio(resumen: ResumenHelio | null): string[] {
  const bom = bomHelio(resumen);
  if (!resumen || !bom) return [];
  return [
    "",
    "HELIO Y CINTA (estimación)",
    ...resumen.filas.map((f, i) => `${f.cantidad} × ${f.formatoId} a ${textoNumero(f.infladoCm)} cm: ${textoNumero(f.litros)} L (${textoPies3(bom.lineas[i]!.pies3)}) de helio con ${perdida} de pérdida`),
    `${textoVolumenYCinta(bom)} · ${resumen.tanques} ${resumen.tanques === 1 ? "tanque" : "tanques"} de ${textoNumero(LITROS_POR_TANQUE)} L nominales (confirmar con el proveedor)`,
    AVISO_ALCANCE_HELIO,
  ];
}
