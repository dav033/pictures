import { formaSemiarco, RELLENO_TUPIDO, type ColorOrganico, type OpcionesOrganico } from "./organico";
import type { OpcionesFlores } from "./flores-artificiales";
import type { PatronTrenza, Punto2 } from "./trenza";

/**
 * Dos piezas que las escenas necesitan y que el taller no tenía como pieza propia, descritas por medidas (para
 * poder cambiarlas con deslizadores) en vez de por recorridos sueltos:
 *
 * - **Arco orgánico**: dos semiarcos orgánicos (`formaSemiarco`) que nacen en el piso a cada lado y se juntan arriba,
 *   gruesos en las patas y más finos en la clave. Sin remate en la clave: los dos tramos se encuentran.
 * - **Guirnalda clásica**: la trenza de cuartetos de Sempertex sobre una curva del plano XY: un festón (cuelga
 *   `caidaCm` en el medio entre dos puntos a `anchoCm`), recta si la caída es 0, o una curva libre (`recorrido`).
 *
 * Espacio local: cm, y hacia arriba, x a lo ancho y +z hacia quien mira (el frente).
 */
export type OpcionesArcoOrganico = {
  /** Ancho entre los ejes de las dos patas. */
  anchoCm: number;
  /** Alto de la clave (cara de arriba de los globos). */
  altoCm: number;
  /** Radio de la envoltura en las patas y en la clave. */
  radioBaseCm: number;
  radioPuntaCm: number;
  semilla: number;
  /** Multiplica los globos de estructura (1 = envoltura cubierta). */
  densidad: number;
  colores: ColorOrganico[];
  /** Flores artificiales en los huecos (`null`: sin flores). */
  flores: OpcionesFlores | null;
  huecosFlores: number;
};

/** Inflados de la técnica orgánica (los del preset de XV, medidos sobre la foto). */
const INFLADOS_ORGANICO: Readonly<Record<string, number>> = { "R-24": 48, "R-18": 34, "R-12": 25, "R-9": 17, "R-5": 12 };

/** Los radios de un arco orgánico de ese grosor (el diámetro de su base): la punta, un tercio. */
export const radiosDeArco = (grosorCm: number) => ({ radioBaseCm: grosorCm / 2, radioPuntaCm: Math.round(grosorCm * 0.34) });

/** Las opciones del motor orgánico para un arco: semiarco izquierdo hacia +x y derecho hacia −x. */
export function opcionesArcoOrganico(a: OpcionesArcoOrganico): OpcionesOrganico {
  const mitad = Math.max(30, a.anchoCm / 2);
  const comun = { altoCm: a.altoCm, radioBaseCm: a.radioBaseCm, radioPuntaCm: a.radioPuntaCm };
  const izquierdo = { ...formaSemiarco({ ...comun, id: "pata_izquierda", nombre: "Pata izquierda", anchoCm: mitad, origen: { x: -mitad, y: 0, z: 0 } }), tapas: {} };
  const derecho = { ...formaSemiarco({ ...comun, id: "pata_derecha", nombre: "Pata derecha", anchoCm: -mitad, origen: { x: mitad, y: 0, z: 0 } }), tapas: {} };
  return {
    semilla: a.semilla,
    tramos: [izquierdo, derecho],
    inflados: INFLADOS_ORGANICO,
    variacionInflado: 0.07,
    relleno: RELLENO_TUPIDO,
    colores: a.colores,
    suelo: true,
    huecosFlores: a.flores ? a.huecosFlores : 0,
    vista: { x: 0, y: 0, z: 1 },
    densidad: a.densidad,
  };
}

export type OpcionesGuirnalda = {
  formatoId: string;
  infladoCm: number;
  patron: PatronTrenza;
  colores: string[];
  /** Distancia entre los dos extremos. */
  anchoCm: number;
  /** Cuánto cuelga en el medio (0: recta). */
  caidaCm: number;
  /** Curva libre (cm, plano XY); si viene, manda sobre ancho y caída. */
  recorrido: Punto2[] | null;
};

const MUESTRAS_FESTON = 80;

/** El eje de la guirnalda: la curva libre o un festón (parábola, casi una catenaria con poca caída) de extremo a extremo. */
export function recorridoGuirnalda(g: OpcionesGuirnalda): Punto2[] {
  if (g.recorrido && g.recorrido.length >= 2) return g.recorrido;
  const a = Math.max(20, g.anchoCm / 2);
  const puntos: Punto2[] = [];
  for (let i = 0; i <= MUESTRAS_FESTON; i++) {
    const x = -a + (2 * a * i) / MUESTRAS_FESTON;
    puntos.push({ x, y: g.caidaCm * ((x / a) ** 2 - 1) });
  }
  return puntos;
}
