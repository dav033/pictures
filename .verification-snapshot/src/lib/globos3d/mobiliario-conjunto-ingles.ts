import type { MesaGuardada, SillasGuardadas, TipoMesa } from "./mobiliario-conjunto-tipos";
import { SILLAS } from "./mobiliario-sillas-param";
import { tonoEnIngles } from "./render-ia";

/**
 * Las mesas y sillas del conjunto de mesa (REQ-012) en inglés para FLUX (`fraseDeEscenografia`): lo que de verdad son, con su
 * medida, su mantel y sus colores, sin inferirlo del nombre que lleve la pieza. «round banquet table 150 cm in diameter with a
 * floor-length tablecloth in white»; «Tiffany (chiavari) chair in gold with an ivory cushion». Una frase por pieza: el conteo
 * («24 × …») lo hace `escenaEnIngles` con las unidades de cada grupo de sillas.
 */

const cm = (n: number) => `${Math.round(n)} cm`;

const MESA_EN: Readonly<Record<TipoMesa, (m: MesaGuardada) => string>> = {
  redonda: (m) => `round banquet table ${cm(m.anchoCm)} in diameter`,
  cuadrada: (m) => `square table ${cm(m.anchoCm)} on each side`,
  rectangular: (m) => `long rectangular banquet table ${cm(m.anchoCm)} long and ${cm(m.fondoCm)} wide`,
  ovalada: (m) => `oval banquet table ${cm(m.anchoCm)} long and ${cm(m.fondoCm)} wide`,
  coctel: (m) => `tall round cocktail table ${cm(m.anchoCm)} in diameter and ${cm(m.altoCm)} high`,
  media_luna: (m) => `half-moon shaped table ${cm(m.anchoCm)} wide with the curved side to the front`,
  serpentina: (m) => `curved serpentine S-shaped table ${cm(m.anchoCm)} long and ${cm(m.fondoCm)} wide`,
  u: (m) => `U-shaped banquet table layout ${cm(m.anchoCm)} wide and ${cm(m.fondoCm)} deep, open to the front`,
};

/** Una mesa paramétrica para FLUX. */
export function fraseDeMesaParametrica(m: MesaGuardada): string {
  const color = tonoEnIngles(m.colorMantel);
  const mantel = m.mantel === "piso" ? `with a floor-length tablecloth in ${color}` : m.mantel === "corto" ? `with a short tablecloth in ${color} that shows the legs` : `with a bare ${color} top and ${tonoEnIngles(m.colorPatas)} legs, no tablecloth`;
  const camino = m.camino ? `, with a ${tonoEnIngles(m.camino)} table runner` : "";
  return `${MESA_EN[m.tipo](m)} ${mantel}${camino}`;
}

/** Una silla del grupo (singular, sin artículo) para FLUX. */
export function fraseDeSillaParametrica(s: SillasGuardadas): string {
  const d = SILLAS[s.tipo];
  const cojin = s.colorCojin && d.cojin ? ` with a ${tonoEnIngles(s.colorCojin)} cushion` : "";
  return `${d.ingles} in ${s.tipo === "ghost" ? "clear acrylic" : tonoEnIngles(s.colorEstructura)}${cojin}`;
}
