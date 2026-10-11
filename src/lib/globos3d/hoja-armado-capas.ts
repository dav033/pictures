import { filasBomba, type CalibracionBomba, type FilaBomba } from "./bomba-segundos";
import {
  claveDeGlobo, colorear, globoHoja, marcasDe, secuenciaDeColor, sumaSinRedondear,
  type GloboHoja, type LineaColorCapa, type TramoColor,
} from "./hoja-armado-comun";
import type { CentroLocal } from "./hoja-armado-local";

/**
 * Las capas (anillos) de una columna o un módulo. Se dibujan solo cuando la pieza trae sus capas de verdad: cada globo lleva
 * el `nivel` con que lo armó la trenza, así que una columna parada, acostada o colgada de un ancla da las mismas capas, y
 * todas del tamaño del módulo (4 globos en un cuarteto). Si alguna capa no tiene ese tamaño, no se dibuja: se da la tabla.
 * Cada capa se lee «vista desde arriba»: los globos se numeran en sentido horario y el 1 queda en su azimut real, de modo
 * que la capa de arriba se ve girada respecto a la de abajo, como se arma (1/8 de vuelta por cuarteto en la espiral).
 */

/** Un anillo con más globos que esto no se dibuja: se da solo su tabla. */
export const MAX_GLOBOS_ANILLO = 24;

export type GloboEnCapa = GloboHoja & { numero: number; x: number; y: number };

export type CapaHoja = {
  /** Número de la primera capa de este bloque (1 es la de abajo). */
  numero: number;
  /** Número de la última capa del bloque: las capas seguidas que son iguales se dan juntas. */
  hasta: number;
  repeticiones: number;
  /** Altura del centro de la primera capa del bloque sobre el punto más bajo de la pieza (cm). */
  alturaCm: number;
  /** Cuánto gira cada capa del bloque respecto a la de abajo, en grados (+ es sentido horario visto desde arriba); `null` si no hay capa de abajo. */
  giroGrados: number | null;
  /** Los globos de la primera capa del bloque, en el orden del anillo. */
  globos: GloboEnCapa[];
  /** Hacia dónde sube la numeración del anillo vista desde arriba (del 1 al 2 y así). */
  sentidoNumeracion: "horario" | "antihorario";
  /** Radio del anillo esquemático (cm). */
  radioAnilloCm: number;
  /** Mitad del lado del cuadro del dibujo (cm). */
  extensionCm: number;
  /** Si hay dibujo: un anillo de hasta `MAX_GLOBOS_ANILLO` globos. */
  dibujable: boolean;
  /** Por capa. */
  colores: LineaColorCapa[];
  /** Por capa: cuántos van de helio, impresos o con confeti (ver `marcasDe`). */
  marcas: string[];
  /** El orden de color alrededor de UNA capa (no se unen tramos de capas distintas). */
  secuencia: TramoColor[];
  /** Por capa. */
  filasBomba: FilaBomba[];
  /** Segundos de bomba de UNA capa, sin redondear (se redondea al mostrar). */
  segundosBomba: number;
};

const aGrados = (radianes: number) => (radianes * 180) / Math.PI;

/** Un giro llevado al intervalo (−180, 180]. */
function giroNormalizado(grados: number): number {
  const g = (((grados + 180) % 360) + 360) % 360 - 180;
  return g === -180 ? 180 : g;
}

/** Radio del anillo esquemático: lo mayor entre el que da el perímetro de los diámetros y el que deja tocarse a los vecinos. */
function radioDelAnillo(diametros: readonly number[]): number {
  const n = diametros.length;
  if (n <= 1) return 0;
  const porPerimetro = diametros.reduce((s, d) => s + d, 0) / (2 * Math.PI);
  const porContacto = Math.max(...diametros.map((d, i) => (d + diametros[(i + 1) % n]!) / 2)) / (2 * Math.sin(Math.PI / n));
  return Math.max(porPerimetro, porContacto);
}

/** El azimut de cada globo alrededor del centro de su capa, en el plano horizontal de la pieza (de x hacia z: sentido horario visto desde arriba). */
function azimutes(grupo: readonly CentroLocal[]): number[] {
  const cx = grupo.reduce((s, c) => s + c.x, 0) / grupo.length;
  const cz = grupo.reduce((s, c) => s + c.z, 0) / grupo.length;
  return grupo.map((c) => Math.atan2(c.z - cz, c.x - cx));
}

/** De globo en globo, en el orden del anillo: si los azimutes crecen (de x hacia z), la numeración va en sentido horario. */
function sentidoDeNumeracion(azimut: readonly number[]): CapaHoja["sentidoNumeracion"] {
  const avance = azimut.slice(1).reduce((s, a, k) => s + giroNormalizado(aGrados(a - azimut[k]!)), 0);
  return avance < 0 ? "antihorario" : "horario";
}

const firmaDeCapa = (grupo: readonly CentroLocal[]) => grupo.map((c) => claveDeGlobo(globoHoja(c))).join(";");

type CapaCruda = { grupo: readonly CentroLocal[]; azimut: number[]; giro: number | null; firma: string };

function capaDeBloque(cruda: CapaCruda, numero: number, hasta: number, giro: number | null, referencia: number, base: number, calibracion: CalibracionBomba): CapaHoja {
  const radio = radioDelAnillo(cruda.grupo.map((c) => c.globo.infladoCm));
  const globos: GloboEnCapa[] = cruda.grupo.map((c, k) => {
    const angulo = cruda.azimut[k]! - referencia - Math.PI / 2;
    return { ...globoHoja(c), numero: k + 1, x: radio * Math.cos(angulo) || 0, y: radio * Math.sin(angulo) || 0 };
  });
  const filas = filasBomba(cruda.grupo.map((c) => c.globo), calibracion);
  const mayor = Math.max(...cruda.grupo.map((c) => c.globo.infladoCm));
  const altura = cruda.grupo.reduce((s, c) => s + c.y, 0) / cruda.grupo.length - base;
  return {
    numero, hasta, repeticiones: hasta - numero + 1,
    alturaCm: Math.round(altura),
    giroGrados: giro,
    globos,
    sentidoNumeracion: sentidoDeNumeracion(cruda.azimut),
    radioAnilloCm: radio,
    extensionCm: radio + mayor / 2 + 2,
    dibujable: globos.length <= MAX_GLOBOS_ANILLO,
    colores: colorear(globos),
    marcas: marcasDe(globos, { tipo: "posicion", de: hasta > numero ? "de cada capa" : "de la capa" }),
    secuencia: secuenciaDeColor(globos),
    filasBomba: filas,
    segundosBomba: sumaSinRedondear(filas),
  };
}

/**
 * Las capas de una pieza de anillos, de la de abajo a la de arriba. `grupos` trae cada capa con sus globos en el orden del
 * anillo. Devuelve `null` si alguna capa no tiene `globosPorCapa` globos (el tamaño del módulo): entonces no se dibujan
 * anillos. Las capas seguidas con los mismos globos y el mismo giro se juntan en un solo bloque.
 */
export function capasDeAnillos(grupos: readonly (readonly CentroLocal[])[], globosPorCapa: number, calibracion: CalibracionBomba = {}): CapaHoja[] | null {
  if (!grupos.length || grupos.some((g) => g.length !== globosPorCapa)) return null;
  const base = Math.min(...grupos.flat().map((c) => c.y - c.globo.infladoCm / 2));
  const azimutPorCapa = grupos.map(azimutes);
  const referencia = azimutPorCapa[0]![0]!;
  const crudas: CapaCruda[] = grupos.map((grupo, k) => ({
    grupo,
    azimut: azimutPorCapa[k]!,
    giro: k === 0 ? null : Math.round(giroNormalizado(aGrados(azimutPorCapa[k]![0]! - azimutPorCapa[k - 1]![0]!))),
    firma: firmaDeCapa(grupo),
  }));
  const bloques: CapaHoja[] = [];
  let i = 0;
  while (i < crudas.length) {
    let j = i;
    let giro = crudas[i]!.giro;
    while (j + 1 < crudas.length && crudas[j + 1]!.firma === crudas[i]!.firma && (giro === null || crudas[j + 1]!.giro === giro)) {
      j += 1;
      giro ??= crudas[j]!.giro;
    }
    bloques.push(capaDeBloque(crudas[i]!, i + 1, j + 1, giro, referencia, base, calibracion));
    i = j + 1;
  }
  return bloques;
}

/** Cuántas capas hay en total (contando las repetidas de cada bloque). */
export const totalDeCapas = (capas: readonly CapaHoja[]): number => capas.reduce((s, c) => s + c.repeticiones, 0);
