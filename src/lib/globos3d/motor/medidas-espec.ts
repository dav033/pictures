import type { EstructuraOficialId } from "@/lib/plan/estructuras-oficiales";
import type { PiezaEspec, TamanosEspec } from "./espec-cliente-v1";

/**
 * Medidas, proporción de tamaños y densidad que una pieza oficial lleva cuando nadie las dijo. Las medidas son las
 * que Python completa en un salón cerrado (`_DEFAULT_MEASURES` de `plan.py`), para que el cliente vea el mismo
 * tamaño en los dos motores.
 */
export type MedidasEspec = PiezaEspec["medidas"];

export const MEDIDAS_POR_DEFECTO: Readonly<Record<EstructuraOficialId, MedidasEspec>> = {
  arco: { anchoM: 3, altoM: 2.4 },
  arco_asimetrico: { anchoM: 3, altoM: 2.4 },
  arco_no_denso: { anchoM: 3, altoM: 2.4 },
  semiarco: { anchoM: 1.2, altoM: 2.2 },
  semiarco_asimetrico: { anchoM: 1.2, altoM: 2.2 },
  columna: { altoM: 1.8 },
  columna_asimetrica: { altoM: 1.8, anchoM: 0.6 },
  columna_no_densa: { altoM: 1.8, anchoM: 0.5 },
  pared_densa: { anchoM: 2.4, altoM: 2.4 },
  pared_no_densa: { anchoM: 2.4, altoM: 2.4 },
  pared_organica: { anchoM: 2.4, altoM: 2.4 },
  guirnalda: { largoM: 2.5 },
  centro_mesa: { anchoM: 0.4, altoM: 0.5 },
  bouquet: { altoM: 1.6 },
  figura: { altoM: 1.5 },
  aro_circular: { anchoM: 1.6, altoM: 1.6 },
  techo_globos: { anchoM: 2, altoM: 1.5 },
  racimo_pared: { anchoM: 0.6, altoM: 0.6 },
};

export const TAMANOS_POR_DEFECTO: Readonly<Record<EstructuraOficialId, TamanosEspec>> = {
  arco: "clasica",
  arco_asimetrico: "organica_fina",
  arco_no_denso: "organica_fina",
  semiarco: "organica_fina",
  semiarco_asimetrico: "organica_fina",
  columna: "clasica",
  columna_asimetrica: "organica_fina",
  columna_no_densa: "organica_fina",
  pared_densa: "clasica",
  pared_no_densa: "clasica",
  pared_organica: "organica_fina",
  guirnalda: "organica_fina",
  centro_mesa: "clasica",
  bouquet: "clasica",
  figura: "clasica",
  aro_circular: "organica_fina",
  techo_globos: "clasica",
  racimo_pared: "clasica",
};

/**
 * El grosor del cuerpo (m) de cada pieza orgánica cuando nadie lo dijo. Es el que, con el relleno acotado de
 * `calibracion-organica.ts`, deja el conteo por metro de Python y de las fotos de referencia (20 a 26 por metro): el
 * del Taller y la biblioteca (guirnalda 45 cm) no se toca.
 */
export const GROSOR_ORGANICO_POR_DEFECTO_M = { guirnalda: 0.55, semiarco: 0.7, semiarcoAsimetrico: 0.72, columna: 0.7, aro: 0.3, arco: 0.7 } as const;

/** Cuántos globos lleva por defecto lo que se cuenta por unidades. */
export const UNIDADES_POR_DEFECTO: Partial<Record<EstructuraOficialId, number>> = { bouquet: 7, racimo_pared: 9, centro_mesa: 5 };

export const DENSIDAD_POR_DEFECTO: Partial<Record<EstructuraOficialId, PiezaEspec["densidad"]>> = {
  arco_no_denso: "sencilla",
  columna_no_densa: "sencilla",
  pared_no_densa: "sencilla",
  pared_densa: "lujosa",
};

/** La medida con que se arma, en cm, y si hubo que acotarla a lo que el constructor admite. */
export function enCm(metros: number | undefined, defectoM: number | undefined, rango: readonly [number, number], que: string, avisos: string[]): number {
  const pedido = Math.round((metros ?? defectoM ?? rango[0] / 100) * 100);
  const acotado = Math.min(rango[1], Math.max(rango[0], pedido));
  if (acotado !== pedido) avisos.push(`${que}: ${pedido} cm queda fuera de lo que se arma (de ${rango[0]} a ${rango[1]} cm); se usó ${acotado} cm.`);
  return acotado;
}

export function medidasDe(pieza: PiezaEspec): MedidasEspec {
  return { ...MEDIDAS_POR_DEFECTO[pieza.oficial], ...pieza.medidas };
}
