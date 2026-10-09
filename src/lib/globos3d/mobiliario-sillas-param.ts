import type { AcabadoEscenografia, ElementoEscenografia } from "./escenografia";
import { banca, sillaModerna, sillaTiffany, taburete, type OpcionesAsiento } from "./mobiliario-asientos";
import { mat, trasladarGirar } from "./mobiliario-base";
import { sillaCrossback, sillaGhost, sillaPlegable } from "./mobiliario-sillas-extra";
import type { SillasGuardadas, TipoSilla } from "./mobiliario-conjunto-tipos";

/**
 * **Los tipos de silla del conjunto de mesa** (REQ-012): tiffany/chiavari, crossback, ghost (acrílica), plegable, moderna, banca y
 * taburete —las cuatro últimas reutilizan los modelos del catálogo—, con sus medidas de partida, su color, si llevan cojín y cómo
 * se llaman (en español para la lista y en inglés para FLUX). Un grupo de sillas (`SillasGuardadas`) se arma repitiendo UN modelo
 * en cada puesto: el visor junta todos los sólidos del mismo material en una malla, así que 300 sillas son 3 mallas.
 */

export type DatosSilla = {
  nombre: string; plural: string; ingles: string;
  anchoCm: number; fondoCm: number; altoCm: number;
  /** Colores de partida: estructura y cojín (`null`: no lleva). */
  estructura: string; cojin: string | null;
  acabado: AcabadoEscenografia;
  armar: (o: OpcionesAsiento) => ElementoEscenografia[];
};

export const SILLAS: Readonly<Record<TipoSilla, DatosSilla>> = {
  tiffany: { nombre: "Silla Tiffany", plural: "sillas Tiffany", ingles: "Tiffany (chiavari) chair", anchoCm: 45, fondoCm: 45, altoCm: 90, estructura: "#d6b25a", cojin: "#f4efe4", acabado: "satinado", armar: sillaTiffany },
  crossback: { nombre: "Silla crossback", plural: "sillas crossback", ingles: "wooden crossback chair", anchoCm: 44, fondoCm: 46, altoCm: 90, estructura: "#8a6a45", cojin: "#e8e0d0", acabado: "madera", armar: sillaCrossback },
  ghost: { nombre: "Silla ghost", plural: "sillas ghost (acrílicas)", ingles: "clear acrylic ghost chair", anchoCm: 45, fondoCm: 47, altoCm: 90, estructura: "#dfe9ee", cojin: null, acabado: "acrilico", armar: sillaGhost },
  plegable: { nombre: "Silla plegable", plural: "sillas plegables", ingles: "folding chair", anchoCm: 44, fondoCm: 46, altoCm: 82, estructura: "#f7f6f2", cojin: null, acabado: "mate", armar: sillaPlegable },
  moderna: { nombre: "Silla moderna", plural: "sillas modernas", ingles: "modern chair with slim black legs", anchoCm: 45, fondoCm: 48, altoCm: 82, estructura: "#2b2b2b", cojin: "#d8d1c3", acabado: "metal", armar: sillaModerna },
  banca: { nombre: "Banca", plural: "bancas", ingles: "cushioned bench", anchoCm: 120, fondoCm: 38, altoCm: 45, estructura: "#8a6a45", cojin: "#e8e0d0", acabado: "madera", armar: banca },
  taburete: { nombre: "Taburete", plural: "taburetes", ingles: "round stool", anchoCm: 43, fondoCm: 43, altoCm: 75, estructura: "#2b2b2b", cojin: "#8a6a45", acabado: "metal", armar: taburete },
};

/** Lo que mide a lo ancho (frente) y a lo fondo un asiento de este tipo (cm): con eso se reparten por el borde de la mesa. */
export const medidaDeAsiento = (tipo: TipoSilla) => ({ frenteCm: SILLAS[tipo].anchoCm, fondoCm: SILLAS[tipo].fondoCm, altoCm: SILLAS[tipo].altoCm });

const MEMO = new Map<string, ElementoEscenografia[]>();
const MAX_MEMO = 8;

/** Los sólidos de un grupo de sillas, en el marco de la mesa. Se recuerdan los últimos (el mismo grupo se arma varias veces por cuadro: visor, lista, render). */
export function armarSillas(s: SillasGuardadas): ElementoEscenografia[] {
  const clave = JSON.stringify(s);
  const hecho = MEMO.get(clave);
  if (hecho) return hecho;
  const d = SILLAS[s.tipo];
  const estructura = mat(s.colorEstructura, d.acabado);
  // Sin cojín el asiento queda del color de la estructura.
  const cojin = s.colorCojin && d.cojin ? mat(s.colorCojin, "tela") : estructura;
  const una = d.armar({ anchoCm: d.anchoCm, fondoCm: d.fondoCm, altoCm: d.altoCm, estructura, cojin });
  const todas = s.puestos.flatMap((p) => trasladarGirar(una, p.x, p.z, p.giroGrados));
  MEMO.set(clave, todas);
  while (MEMO.size > MAX_MEMO) { const primera = MEMO.keys().next().value; if (primera === undefined) break; MEMO.delete(primera); }
  return todas;
}
