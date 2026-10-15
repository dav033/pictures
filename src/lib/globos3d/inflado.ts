import { FORMATOS_GLOBO } from "./formatos";
import { filasBomba, redondearSegundos, segundosReferencia, textoFilaInflado, textoInflarA, type CalibracionBomba, type InflableBomba } from "./bomba-segundos";

/**
 * Tabla de inflado por formato y «inflar a N cm» por capa. Reutiliza los datos que ya existen: el tamaño de decoración
 * del formato y los segundos de bomba estimados (`bomba-segundos`). No hay una segunda fuente de cifras.
 * Núcleo puro. El texto de cada fila (`textoFilaInflado`, definido en `bomba-segundos`) lo usan la hoja de armado (`HojaArmadoCapa`,
 * `HojaArmadoEstructura`), la sección «Bomba» de la lista de compra (`SeccionBomba`) y el texto copiado (`lineasBomba`).
 */
export type FilaInflado = { formatoId: string; nombre: string; infladoCm: number; segundos: number };

/** Una fila por formato con bomba: a cuántos cm se infla en decoración y cuántos segundos tarda (estimación). */
export function tablaInflado(calibracion: CalibracionBomba = {}): FilaInflado[] {
  return FORMATOS_GLOBO.flatMap((f) => {
    const segundos = segundosReferencia(f.id, calibracion);
    return segundos === undefined ? [] : [{ formatoId: f.id, nombre: f.nombre, infladoCm: f.infladoDecoracionCm, segundos }];
  });
}

export type InfladoDeCapa = { formatoId: string; cantidad: number; cmMin: number; cmMax: number; segundos: number };

/** Lo que hay que inflar en una capa: por formato, cuántos globos, a cuántos cm (rango) y los segundos de bomba (sin helio). */
export function infladoDeCapa(globos: ReadonlyArray<InflableBomba>, calibracion: CalibracionBomba = {}): InfladoDeCapa[] {
  return filasBomba(globos, calibracion).map((f) => ({ formatoId: f.formatoId, cantidad: f.cantidad, cmMin: f.cmMin, cmMax: f.cmMax, segundos: redondearSegundos(f.segundosTotal) }));
}

export { textoFilaInflado, textoInflarA };
