import type { EstructuraOficialId } from "@/lib/plan/estructuras-oficiales";
import { formatosOrganicosDe } from "../../src/lib/globos3d/herramientas-escena-colores";
import { DENSIDAD_POR_DEFECTO, ejeCuartoElipse, GROSOR_ORGANICO_POR_DEFECTO_M, medidasDe, perimetroElipse } from "../../src/lib/globos3d/motor/medidas-espec";
import { DIAMETRO_ARO_MAX_M, DIAMETRO_ARO_MIN_M, FILAS_ARO_ORGANICO } from "./bandas-aro";
import { FILAS_COLUMNA_ORGANICA, GROSOR_COLUMNA_MAX_M, GROSOR_COLUMNA_MIN_M } from "./bandas-columna";
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
const ORGANICAS: readonly EstructuraOficialId[] = ["semiarco", "semiarco_asimetrico", "guirnalda"];

type FilaBandaBase = {
  estructuras: readonly EstructuraOficialId[];
  /** Solo las proporciones de tamaños que PARIDAD midió: la clásica (cuartetos) y la orgánica fina (la de las ideas). */
  tamanos: readonly TamanosEspec[];
  /** Solo para orgánicas: la densidad a la que aplica la fila. */
  densidad?: DensidadEspec;
  /** Solo columnas orgánicas: el tramo de grosor (m, bordes incluidos) al que aplica la fila; el grosor se acota a lo que arma el motor. */
  grosorM?: readonly [desde: number, hasta: number];
  /** Solo el aro orgánico: el tramo de diámetro (m, bordes incluidos) al que aplica la fila; el diámetro se acota a lo que se midió. */
  diametroM?: readonly [desde: number, hasta: number];
  /** Fracción del mínimo que se perdona a las piezas sin R-9 en ningún color (rellenan menos: ver `bandas-columna.ts`). */
  margenBajoSinR9?: number;
  /** Lo que se mide: el eje en metros (por defecto), el área en m² (ancho × alto) o la pieza entera (1). */
  medida?: "eje" | "area" | "pieza";
  /** Mínimo de globos por unidad de `medida` (por metro, por m² o por pieza). */
  minPorMetro: number;
  /** Margen bajo, y también alto si no se especifica `margenMaxGlobos`. */
  margenGlobos?: number;
  /** Margen alto explícito cuando el máximo ya incluye un margen porcentual medido. */
  margenMaxGlobos?: number;
  /** De dónde sale la fila: `paridad` (PARIDAD/foto), `medido` (barrido contra la fachada) o `motor` (el valor por defecto del motor repetido: fija una regresión, no mide cobertura). */
  origen: "paridad" | "medido" | "motor";
  fuente: string;
};

export type FilaBanda = FilaBandaBase & (
  | { maxPorMetro: number; maxGlobosPorDiametro?: never }
  | { maxPorMetro?: never; /** Solo aro: [diámetro m, máximo entero de globos ya marginado]. */ maxGlobosPorDiametro: readonly (readonly [diametroM: number, maxGlobos: number])[] }
);

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
  ...FILAS_COLUMNA_ORGANICA,
  ...FILAS_ARO_ORGANICO,
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

export function ejeEnMetros(pieza: PiezaEspec): number | null {
  const m = medidasDe(pieza);
  const ancho = m.anchoM ?? 0, alto = m.altoM ?? 0;
  switch (pieza.oficial) {
    case "arco": case "arco_asimetrico": case "arco_no_denso": return perimetroElipse(ancho / 2, alto) / 2;
    case "semiarco": case "semiarco_asimetrico": return ejeCuartoElipse(ancho, alto);
    case "columna": case "columna_asimetrica": case "columna_no_densa": {
      // La regla de `constructores-clasicos.ts::alturaDeColumna`: las capas mandan si el alto pedido cae a dos niveles de ellas.
      // Solo la columna clásica (cuartetos) las lee: la orgánica se arma por su alto y ignora `capas` (T61: E-01214, E-01910).
      if (!pieza.capas || pieza.tamanos !== "clasica") return alto;
      const porCapas = pieza.capas * METROS_POR_CAPA;
      return pieza.medidas.altoM === undefined || Math.abs(pieza.medidas.altoM - porCapas) <= 2 * METROS_POR_CAPA ? porCapas : pieza.medidas.altoM;
    }
    case "guirnalda": return m.largoM ?? null;
    case "aro_circular": return Math.PI * diametroDeAro(pieza);
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

/** El grosor del tubo como lo arma `construirColumnaOrganica` (`grosorM`, si no `anchoM`, si no el de por defecto), acotado a lo que el motor acepta. */
function grosorDeColumna(pieza: PiezaEspec): number {
  const m = medidasDe(pieza);
  return Math.min(GROSOR_COLUMNA_MAX_M, Math.max(GROSOR_COLUMNA_MIN_M, m.grosorM ?? m.anchoM ?? GROSOR_ORGANICO_POR_DEFECTO_M.columna));
}

/** El diámetro del aro como lo arma `construirAro`: redondeo al centímetro y límite superior del constructor, sin subir los menores de 1 m. */
function diametroDeAro(pieza: PiezaEspec): number {
  const m = medidasDe(pieza);
  const solicitado = m.anchoM ?? m.altoM ?? 0;
  if (solicitado < DIAMETRO_ARO_MIN_M) return solicitado;
  return Math.min(DIAMETRO_ARO_MAX_M, Math.round(solicitado * 100) / 100);
}

/** Busca el tope medido a la resolución en centímetros que utiliza el constructor. */
function maximoAroEnDiametro(puntos: readonly (readonly [number, number])[], diametroM: number): number {
  const punto = puntos.find(([diametro]) => diametro === diametroM);
  if (!punto) throw new Error(`Falta el máximo medido del aro de ${diametroM} m`);
  return punto[1];
}

/** Ningún color de la pieza se fabrica en R-9: el relleno de ese hueco queda corto (la regla de `tamanosPosibles`). */
const sinR9 = (pieza: PiezaEspec): boolean => !pieza.colores.some((color) => formatosOrganicosDe(color.codigo).includes("R-9"));

/** La banda que le toca a una pieza (con su densidad efectiva) o el motivo de que no le toque ninguna. */
export function bandaDePieza(pieza: PiezaEspec): BandaDePieza {
  const densidad = pieza.densidad ?? DENSIDAD_POR_DEFECTO[pieza.oficial] ?? "media";
  const grosor = grosorDeColumna(pieza);
  const diametro = diametroDeAro(pieza);
  const fila = BANDAS.find((f) => f.estructuras.includes(pieza.oficial) && f.tamanos.includes(pieza.tamanos) && (f.densidad === undefined || f.densidad === densidad)
    && (f.grosorM === undefined || (grosor >= f.grosorM[0] && grosor <= f.grosorM[1]))
    && (f.diametroM === undefined || (diametro >= f.diametroM[0] && diametro <= f.diametroM[1])));
  if (!fila) return { tipo: "sin_banda", motivo: SIN_BANDA_MOTIVO };
  const ejeM = medidaDeBanda(pieza, fila.medida ?? "eje");
  if (ejeM === null || ejeM <= 0) return { tipo: "sin_banda", motivo: SIN_BANDA_MOTIVO };
  const margen = fila.margenGlobos ?? TOLERANCIA_GLOBOS;
  const minimo = Math.floor(fila.minPorMetro * ejeM);
  const maxGlobos = fila.maxGlobosPorDiametro !== undefined
    ? maximoAroEnDiametro(fila.maxGlobosPorDiametro, diametro)
    : Math.ceil(fila.maxPorMetro * ejeM) + (fila.margenMaxGlobos ?? margen);
  return {
    tipo: "banda", minGlobos: Math.max(0, minimo - margen - Math.ceil((fila.margenBajoSinR9 ?? 0) * minimo * (sinR9(pieza) ? 1 : 0))),
    maxGlobos, ejeM, fuente: fila.fuente, densidad: fila.densidad ? densidad : null,
  };
}

/** La celda de la matriz de bandas de una pieza: estructura y densidad (o la proporción de tamaños si la banda no depende de la densidad). */
export function celdaDeBanda(pieza: PiezaEspec, banda: { densidad: DensidadEspec | null }): string {
  return `${pieza.oficial}:${banda.densidad ?? pieza.tamanos}`;
}
