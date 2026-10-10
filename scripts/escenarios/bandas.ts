import type { EstructuraOficialId } from "@/lib/plan/estructuras-oficiales";
import { DENSIDAD_POR_DEFECTO, medidasDe } from "../../src/lib/globos3d/motor/medidas-espec";
import type { DensidadEspec, PiezaEspec, TamanosEspec } from "../../src/lib/globos3d/motor/espec-cliente-v1";

/**
 * **La única tabla de bandas de conteo de la matriz**: globos por metro de eje de cada estructura (el eje como lo mide
 * Python en `plan.py::_eje`), con la fuente de cada rango. Un conteo se acepta si cae dentro de [min·eje, max·eje] con
 * `TOLERANCIA_GLOBOS` globos de margen (lo que pesa un tubo corto: un 0,7 m redondea mal).
 *
 * Criterio de los rangos: cubre a la vez la fórmula oficial, lo que cuenta Python (`PARIDAD-2026-10-09.csv`, columnas
 * `python_count / python_axis_m`) y la estimación visual de la foto de referencia (`photo_estimate / python_axis_m`). Lo que
 * el motor cuenta de más por encima de la banda es un fallo, no se ajusta la banda para que pase.
 *
 * Las estructuras sin banda (pared, techo, racimo, bouquet, centro de mesa, figura) no tienen dato de conteo por metro en
 * PARIDAD: se marcan como `sin_banda` y no cuentan como fallo ni como acierto.
 */

export const TOLERANCIA_GLOBOS = 3;

/** Escala de un racimo de columna: cada nivel de cuartetos son 20 cm (0,8 × 25 cm, `SEGUIMIENTO.md:98-99`). */
const METROS_POR_CAPA = 0.2;

/** Las estructuras orgánicas que PARIDAD mide por densidad (las que tienen fila de conteo en el CSV). */
const ORGANICAS: readonly EstructuraOficialId[] = ["semiarco", "semiarco_asimetrico", "guirnalda", "columna", "columna_asimetrica", "aro_circular"];

export type FilaBanda = {
  estructuras: readonly EstructuraOficialId[];
  /** Solo las proporciones de tamaños que PARIDAD midió: la clásica (cuartetos) y la orgánica fina (la de las ideas). */
  tamanos: readonly TamanosEspec[];
  /** Solo para orgánicas: la densidad a la que aplica la fila. */
  densidad?: DensidadEspec;
  minPorMetro: number;
  maxPorMetro: number;
  fuente: string;
};

export const BANDAS: readonly FilaBanda[] = [
  {
    estructuras: ["arco", "guirnalda"], tamanos: ["clasica"], minPorMetro: 18, maxPorMetro: 32,
    fuente: "Cuartetos R-12 a 25 cm: 5 cuartetos/m = 20 globos/m (SEGUIMIENTO.md:98-99). Python: arco 26,6/m; guirnalda clásica 21,3-26,7/m. Foto: arco 27,8-31,4/m, guirnalda clásica 31,3/m.",
  },
  {
    estructuras: ["columna"], tamanos: ["clasica"], minPorMetro: 14, maxPorMetro: 24,
    fuente: "Capas de 20 cm × 4 globos = 20/m (SEGUIMIENTO.md:98-99; armado_columna). Python: 14,7-17,9/m (08 y 29); 08 se mide con su remate.",
  },
  { estructuras: ORGANICAS, tamanos: ["organica_fina"], densidad: "sencilla", minPorMetro: 13, maxPorMetro: 20, fuente: "Densidad ligera 13-20/m (PARIDAD §2; ver la cita de la investigación arriba). Python: 15,1-17,1/m. Foto: 13,5-18,8/m." },
  { estructuras: ORGANICAS, tamanos: ["organica_fina"], densidad: "media", minPorMetro: 19, maxPorMetro: 26, fuente: "Densidad estándar 20-26/m (PARIDAD §2, que cita la investigación de guirnalda: ese archivo no está en disco; calibracion-organica.ts cabecera). Python: 19,5-21,9/m." },
  { estructuras: ORGANICAS, tamanos: ["organica_fina"], densidad: "lujosa", minPorMetro: 24, maxPorMetro: 40, fuente: "Densidad llena 26-40/m (PARIDAD §2; ver la cita de la investigación arriba). Python: 23,0-27,5/m; foto: 22,9-39,8/m." },
];

/** Por qué una estructura queda sin banda: lo que la matriz registra en vez de contar como fallo. */
export const SIN_BANDA_MOTIVO = "Sin dato de conteo por metro para esta estructura y proporción de tamaños en PARIDAD-2026-10-09: no se acepta ni se rechaza.";

/** Longitud del eje (m) como la mide Python en `plan.py::_eje`: el arco es media elipse, el semiarco un cuarto, el aro la vuelta. */
function elipsePerimetro(a: number, b: number): number {
  const h = ((a - b) / (a + b)) ** 2;
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

export function ejeEnMetros(pieza: PiezaEspec): number | null {
  const m = medidasDe(pieza);
  const ancho = m.anchoM ?? 0, alto = m.altoM ?? 0;
  switch (pieza.oficial) {
    case "arco": case "arco_asimetrico": case "arco_no_denso": return elipsePerimetro(ancho / 2, alto) / 2;
    case "semiarco": case "semiarco_asimetrico": return elipsePerimetro(ancho, alto) / 4;
    case "columna": case "columna_asimetrica": case "columna_no_densa": {
      // La regla de `constructores-clasicos.ts::alturaDeColumna`: las capas mandan si el alto pedido cae a dos niveles de ellas.
      if (!pieza.capas) return alto;
      const porCapas = pieza.capas * METROS_POR_CAPA;
      return pieza.medidas.altoM === undefined || Math.abs(pieza.medidas.altoM - porCapas) <= 2 * METROS_POR_CAPA ? porCapas : pieza.medidas.altoM;
    }
    case "guirnalda": return m.largoM ?? null;
    case "aro_circular": return Math.PI * ancho;
    default: return null;
  }
}

export type BandaDePieza =
  | { tipo: "banda"; minGlobos: number; maxGlobos: number; ejeM: number; fuente: string; densidad: DensidadEspec | null }
  | { tipo: "sin_banda"; motivo: string };

/** La banda que le toca a una pieza (con su densidad efectiva) o el motivo de que no le toque ninguna. */
export function bandaDePieza(pieza: PiezaEspec): BandaDePieza {
  const ejeM = ejeEnMetros(pieza);
  if (ejeM === null || ejeM <= 0) return { tipo: "sin_banda", motivo: SIN_BANDA_MOTIVO };
  const densidad = pieza.densidad ?? DENSIDAD_POR_DEFECTO[pieza.oficial] ?? "media";
  const fila = BANDAS.find((f) => f.estructuras.includes(pieza.oficial) && f.tamanos.includes(pieza.tamanos) && (f.densidad === undefined || f.densidad === densidad));
  if (!fila) return { tipo: "sin_banda", motivo: SIN_BANDA_MOTIVO };
  return {
    tipo: "banda", minGlobos: Math.max(0, Math.floor(fila.minPorMetro * ejeM) - TOLERANCIA_GLOBOS),
    maxGlobos: Math.ceil(fila.maxPorMetro * ejeM) + TOLERANCIA_GLOBOS, ejeM, fuente: fila.fuente, densidad: fila.densidad ? densidad : null,
  };
}

/** La celda de la matriz de bandas de una pieza: estructura y densidad (o `clasica` si la banda es de cuartetos). */
export function celdaDeBanda(pieza: PiezaEspec, banda: { densidad: DensidadEspec | null }): string {
  return `${pieza.oficial}:${banda.densidad ?? "clasica"}`;
}
