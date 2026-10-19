import type { Caja, Colocacion } from "./escena";

/** Medidas de una estructura en metros, redondeadas al cm: ancho, alto y fondo. */
export type MedidasCaja = { anchoM: number; altoM: number; fondoM: number };

const aMetros = (cm: number) => Math.round(cm) / 100;

/** Las medidas de una caja tal cual, en sus propios ejes: ancho (x), alto (y) y fondo (z). */
export function medidasCajaEnMetros(caja: Caja): MedidasCaja {
  return {
    anchoM: aMetros(caja.max.x - caja.min.x),
    altoM: aMetros(caja.max.y - caja.min.y),
    fondoM: aMetros(caja.max.z - caja.min.z),
  };
}

/** Las colocaciones que solo giran la pieza sobre el eje vertical (su x propia sigue siendo horizontal) y la ponen una sola vez. */
const GIRA_SOLO_EN_VERTICAL: ReadonlySet<Colocacion["en"]> = new Set(["piso", "libre", "pared", "techo"]);

/**
 * Las medidas de una pieza puesta en la escena. Donde la pieza solo gira sobre la vertical (piso, libre, pared, techo), el
 * ancho y el fondo son los de la pieza en SU marco (`local`: la caja de `armarPieza`, antes de colocarla): no cambian por
 * girarla, y un arco de 3,46 m girado 90° sigue midiendo 3,46 m, no los 0,47 m de su caja en los ejes del mundo; el alto
 * se lee en el mundo (`mundo`). Lo que cuelga de un ancla o va `sobre` otra pieza puede quedar con su x propia en cualquier
 * dirección (y repetirse en varias anclas): ahí no hay un ancho propio que leer y vale la caja puesta, tal cual.
 */
export function medidasDePieza(local: Caja | undefined, mundo: Caja, colocacion: Pick<Colocacion, "en">): MedidasCaja {
  if (!local || !GIRA_SOLO_EN_VERTICAL.has(colocacion.en)) return medidasCajaEnMetros(mundo);
  const propias = medidasCajaEnMetros(local);
  return { anchoM: propias.anchoM, altoM: medidasCajaEnMetros(mundo).altoM, fondoM: propias.fondoM };
}

/** Un metro con coma decimal y dos cifras: «2,40 m». */
export function textoMetros(metros: number): string {
  return `${metros.toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`;
}
