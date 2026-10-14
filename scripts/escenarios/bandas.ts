import type { EstructuraOficialId } from "@/lib/plan/estructuras-oficiales";
import { formatosOrganicosDe } from "../../src/lib/globos3d/herramientas-escena-colores";
import { DENSIDAD_POR_DEFECTO, medidasDe } from "../../src/lib/globos3d/motor/medidas-espec";
import { TAMANOS_ESPEC, type DensidadEspec, type PiezaEspec, type TamanosEspec } from "../../src/lib/globos3d/motor/espec-cliente-v1";

/**
 * **La única tabla de bandas de conteo de la matriz**: globos por metro de eje de cada estructura (el eje como lo mide
 * Python en `plan.py::_eje`), con la fuente de cada rango. Un conteo se acepta si cae dentro de [min·eje, max·eje] con
 * `TOLERANCIA_GLOBOS` globos de margen (lo que pesa un tubo corto: un 0,7 m redondea mal).
 *
 * Criterio de los rangos medidos (`origen` `paridad` o `medido`): cubre a la vez la fórmula oficial, lo que cuenta Python (`PARIDAD-2026-10-09.csv`, columnas
 * `python_count / python_axis_m`) y la estimación visual de la foto de referencia (`photo_estimate / python_axis_m`). Lo que
 * el motor cuenta de más por encima de la banda es un fallo, no se ajusta la banda para que pase.
 *
 * Cada fila declara su `origen`: las de `motor` solo fijan el valor por defecto del motor (regresión) y no cuentan como cobertura medida.
 * Las estructuras sin banda (ver `ESTRUCTURAS_SIN_BANDA`) no tienen un conteo medido que defender: se marcan como `sin_banda` y no
 * cuentan como fallo ni como acierto. `test-escenarios-invariantes.ts` falla si una estructura no tiene banda ni figura ahí.
 */

export const TOLERANCIA_GLOBOS = 3;

/** Escala de un racimo de columna: cada nivel de cuartetos son 20 cm (0,8 × 25 cm, `SEGUIMIENTO.md:98-99`). */
const METROS_POR_CAPA = 0.2;

/** Las estructuras orgánicas que PARIDAD mide por densidad (las que tienen fila de conteo en el CSV). */
const ORGANICAS: readonly EstructuraOficialId[] = ["semiarco", "semiarco_asimetrico", "guirnalda", "columna", "columna_asimetrica", "aro_circular"];

/** El formato que el relleno de la guirnalda orgánica necesita (`MEZCLA_GUIRNALDA`): sin él en ningún color, `tamanosPosibles` lo descarta. */
const FORMATO_NECESARIO: Partial<Record<EstructuraOficialId, string>> = { guirnalda: "R-9" };

/** Misma regla que `tamanosPosibles`: el formato falta si ningún color de la pieza se fabrica en él. */
const sinFormatoNecesario = (pieza: PiezaEspec): boolean => {
  const formato = FORMATO_NECESARIO[pieza.oficial];
  return formato !== undefined && !pieza.colores.some((color) => formatosOrganicosDe(color.codigo).includes(formato));
};

/**
 * Las guirnaldas orgánicas cuyos colores no se fabrican en R-9 (13 de ~80 códigos: 056, 909, 912, 915, 932...) bajan del mínimo
 * más que el resto: medido con la fachada, 3,66 m sencilla da 38 globos (10,4/m) y 1,27 m sencilla 9 (7,1/m), un
 * 55-80 % del mínimo por metro. El margen por abajo escala con el largo: `TOLERANCIA_GLOBOS` más este 25 % del mínimo.
 * Es un hueco del motor (el relleno de esos colores) que la banda no corrige: ver P-087. El margen solo se aplica a esos colores; con R-9 rige el fijo.
 */
const MARGEN_BAJO_RELATIVO: Partial<Record<EstructuraOficialId, number>> = { guirnalda: 0.25 };

export type FilaBanda = {
  estructuras: readonly EstructuraOficialId[];
  /** Solo las proporciones de tamaños que PARIDAD midió: la clásica (cuartetos) y la orgánica fina (la de las ideas). */
  tamanos: readonly TamanosEspec[];
  /** Solo para orgánicas: la densidad a la que aplica la fila. */
  densidad?: DensidadEspec;
  /** Lo que se mide: el eje en metros (por defecto), el área en m² (ancho × alto) o la pieza entera (1). */
  medida?: "eje" | "area" | "pieza";
  /** Globos por unidad de `medida` (por metro, por m² o por pieza). */
  minPorMetro: number;
  maxPorMetro: number;
  /** Margen de globos a cada lado, en lugar de `TOLERANCIA_GLOBOS` (lo que pesa el borde en una pieza pequeña). */
  margenGlobos?: number;
  /** De dónde sale la fila: `paridad` (PARIDAD/foto), `medido` (barrido contra la fachada) o `motor` (el valor por defecto del motor repetido: fija una regresión, no mide cobertura). */
  origen: "paridad" | "medido" | "motor";
  fuente: string;
};

/**
 * Estructuras que no tienen banda a propósito, con el motivo. Todo lo demás de `ESTRUCTURAS_OFICIALES_IDS` tiene que
 * aparecer en `BANDAS`: el test lo comprueba y falla si una estructura nueva queda sin ninguna de las dos cosas.
 */
export const ESTRUCTURAS_SIN_BANDA: Readonly<Partial<Record<EstructuraOficialId, string>>> = {
  arco_asimetrico: "Sin conteo por metro medido para el arco asimétrico: PARIDAD solo mide el arco simétrico.",
  arco_no_denso: "Sin conteo por metro medido para el arco no denso: la densidad la decide el motor, no PARIDAD.",
  columna_no_densa: "Sin conteo por metro medido para la columna no densa.",
  pared_no_densa: "El motor la arma como pared de cinta/estructura abierta: no hay conteo medido por m².",
  pared_organica: "Sin conteo por m² medido para la pared orgánica.",
  centro_mesa: "PARIDAD tiene 5 globos en el centro de mesa de la idea 03 y ninguna otra fila: una muestra, no una banda.",
  figura: "La figura la dibuja el catálogo: su conteo no se deriva de una medida de la espec.",
};

export const BANDAS: readonly FilaBanda[] = [
  {
    estructuras: ["arco", "guirnalda"], tamanos: ["clasica"], minPorMetro: 18, maxPorMetro: 32,
    origen: "paridad", fuente: "Cuartetos R-12 a 25 cm: 5 cuartetos/m = 20 globos/m (SEGUIMIENTO.md:98-99). Python: arco 26,6/m; guirnalda clásica 21,3-26,7/m. Foto: arco 27,8-31,4/m, guirnalda clásica 31,3/m.",
  },
  {
    estructuras: ["columna"], tamanos: ["clasica"], minPorMetro: 14, maxPorMetro: 24,
    origen: "paridad", fuente: "Capas de 20 cm × 4 globos = 20/m (SEGUIMIENTO.md:98-99; armado_columna). Python: 14,7-17,9/m (08 y 29); 08 se mide con su remate.",
  },
  { estructuras: ORGANICAS, tamanos: ["organica_fina"], densidad: "sencilla", minPorMetro: 13, maxPorMetro: 20, origen: "paridad", fuente: "Densidad ligera 13-20/m (PARIDAD §2; ver la cita de la investigación arriba). Python: 15,1-17,1/m. Foto: 13,5-18,8/m." },
  { estructuras: ORGANICAS, tamanos: ["organica_fina"], densidad: "media", minPorMetro: 19, maxPorMetro: 26, origen: "paridad", fuente: "Densidad estándar 20-26/m (PARIDAD §2, que cita la investigación de guirnalda: ese archivo no está en disco; calibracion-organica.ts cabecera). Python: 19,5-21,9/m." },
  { estructuras: ORGANICAS, tamanos: ["organica_fina"], densidad: "lujosa", minPorMetro: 24, maxPorMetro: 40, origen: "paridad", fuente: "Densidad llena 26-40/m (PARIDAD §2; ver la cita de la investigación arriba). Python: 23,0-27,5/m; foto: 22,9-39,8/m." },
  {
    estructuras: ["pared_densa"], tamanos: TAMANOS_ESPEC, medida: "area", minPorMetro: 30, maxPorMetro: 44,
    origen: "medido", fuente: "Medido con la fachada (REQ-014 T63; barrido 1-6 m × 1-3 m, 1-6 colores, las 4 proporciones y densidades): 31,4-42,0 globos/m², sin depender de proporción ni densidad (36 cuando es 4,3 × 1; 42 en 1 × 1). Margen: ~5 % por abajo, ~5 % por arriba. Sin fila en PARIDAD.",
  },
  {
    estructuras: ["techo_globos"], tamanos: TAMANOS_ESPEC, medida: "area", minPorMetro: 14, maxPorMetro: 30, margenGlobos: 8,
    origen: "medido", fuente: "Medido con la fachada (REQ-014 T63; barrido 0,6-6 m × 0,6-6 m): 14,7-18,0/m² en piezas de 1,5 m de lado o más; 25-28/m² en tiras de 0,6 m; 44,4/m² en 0,6 × 0,6 (16 globos, de ahí el margen de 8). Sin fila en PARIDAD.",
  },
  {
    estructuras: ["racimo_pared"], tamanos: TAMANOS_ESPEC, medida: "pieza", minPorMetro: 9, maxPorMetro: 9, margenGlobos: 2,
    origen: "motor", fuente: "Pin de regresión (no es una medida de cobertura; REQ-014 T63): un racimo sin `unidades` lleva 9 globos (`UNIDADES_POR_DEFECTO.racimo_pared`), igual con cualquier tamaño, proporción o color. Sin fila en PARIDAD.",
  },
  {
    estructuras: ["bouquet"], tamanos: TAMANOS_ESPEC, medida: "pieza", minPorMetro: 7, maxPorMetro: 7, margenGlobos: 0,
    origen: "motor", fuente: "Pin de regresión (no es una medida de cobertura). PARIDAD-2026-10-09: el conteo del bouquet es el número de unidades en Python y en el motor (03: 6/6; 16: 12/12 y 10/10). Sin `unidades` lleva 7 (`UNIDADES_POR_DEFECTO.bouquet`, medido con cualquier altura).",
  },
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

/** Lo que mide la banda de la pieza: el eje (m), el área (m²) o 1 si la banda es de la pieza entera. `ejeM` guarda ese valor. */
function medidaDeBanda(pieza: PiezaEspec, medida: NonNullable<FilaBanda["medida"]>): number | null {
  if (medida === "pieza") return 1;
  if (medida === "eje") return ejeEnMetros(pieza);
  const m = medidasDe(pieza);
  return m.anchoM !== undefined && m.altoM !== undefined ? m.anchoM * m.altoM : null;
}

/** La banda que le toca a una pieza (con su densidad efectiva) o el motivo de que no le toque ninguna. */
export function bandaDePieza(pieza: PiezaEspec): BandaDePieza {
  const densidad = pieza.densidad ?? DENSIDAD_POR_DEFECTO[pieza.oficial] ?? "media";
  const fila = BANDAS.find((f) => f.estructuras.includes(pieza.oficial) && f.tamanos.includes(pieza.tamanos) && (f.densidad === undefined || f.densidad === densidad));
  if (!fila) return { tipo: "sin_banda", motivo: SIN_BANDA_MOTIVO };
  const ejeM = medidaDeBanda(pieza, fila.medida ?? "eje");
  if (ejeM === null || ejeM <= 0) return { tipo: "sin_banda", motivo: SIN_BANDA_MOTIVO };
  const margen = fila.margenGlobos ?? TOLERANCIA_GLOBOS;
  const minimo = Math.floor(fila.minPorMetro * ejeM);
  const relativo = fila.tamanos.includes("organica_fina") && sinFormatoNecesario(pieza) ? MARGEN_BAJO_RELATIVO[pieza.oficial] ?? 0 : 0;
  return {
    tipo: "banda", minGlobos: Math.max(0, minimo - margen - Math.ceil(relativo * fila.minPorMetro * ejeM)),
    maxGlobos: Math.ceil(fila.maxPorMetro * ejeM) + margen, ejeM, fuente: fila.fuente, densidad: fila.densidad ? densidad : null,
  };
}

/** La celda de la matriz de bandas de una pieza: estructura y densidad (o la proporción de tamaños si la banda no depende de la densidad). */
export function celdaDeBanda(pieza: PiezaEspec, banda: { densidad: DensidadEspec | null }): string {
  return `${pieza.oficial}:${banda.densidad ?? pieza.tamanos}`;
}
