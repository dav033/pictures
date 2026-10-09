import { puntoAlMundo, type EscenaArmada, type NodoEscena } from "./escena";
import { dentroDelContorno, elipse } from "./mobiliario-contornos";
import { muebleDe } from "./mobiliario-catalogo";
import { mesaDePieza } from "./mobiliario-conjunto";
import { superficieDeMesa } from "./mobiliario-mesas-param";
import { armarPieza } from "./piezas";
import type { Punto2 } from "./trenza";

/**
 * **La superficie de arriba de una mesa** (REQ-012): dónde puede apoyarse algo sobre ella, en el mundo. `superficieSuperior(nodo,
 * armada)` da el alto de la tapa, el contorno, el centro útil y el radio de un círculo que cabe entero encima (un centro de mesa), tanto de
 * las mesas paramétricas (por su contorno real: media luna, U, serpentina…) como de las del catálogo (por su caja). Es lo que
 * usa quien pone algo sobre una mesa (`poner_sobre`, la base de pastel). `null` si la pieza no es una mesa con tapa.
 */

export type SuperficieSuperior = {
  nodoId: string;
  forma: "circulo" | "rectangulo" | "contorno";
  /** El centro útil de la tapa: (x, z) del mundo y su alto (y). */
  centro: { x: number; y: number; z: number };
  /** Alto de la tapa sobre el piso (cm). */
  altoCm: number;
  /** Radio de un círculo que cabe entero en la tapa alrededor de `centro` (cm). */
  radioUtilCm: number;
  /** Tamaño de la caja de la tapa en el marco de la mesa (cm). */
  anchoCm: number;
  fondoCm: number;
  /** El contorno de la tapa en el mundo, (x, z). */
  contorno: Punto2[];
};

/** Mesas del catálogo con una tapa plana donde se apoya algo (no el conjunto con sillas, ni las de varias tapas ni la que ya lleva regalos). */
function esMesaConTapa(id: string): boolean {
  const m = muebleDe(id);
  if (id === "mesa_mantel") return true;
  return m?.grupo === "mesa" && !/_sillas$|^carrito|^mesas_nido|^mesa_regalos/.test(id);
}

const aMundo = (marco: Parameters<typeof puntoAlMundo>[0], x: number, y: number, z: number) => puntoAlMundo(marco, { x, y, z });

/** La superficie de arriba de una mesa puesta en la escena, o null si la pieza no es una mesa con tapa o no quedó puesta. */
export function superficieSuperior(nodo: NodoEscena, armada: EscenaArmada): SuperficieSuperior | null {
  const marco = armada.porNodo.find((n) => n.id === nodo.id)?.puestas[0]?.marco;
  if (!marco || nodo.pieza.tipo !== "escenografia") return null;
  const mesa = mesaDePieza(nodo.pieza);
  if (mesa) {
    const s = superficieDeMesa(mesa);
    const c = aMundo(marco, s.centro.x, s.altoCm, s.centro.y);
    return {
      nodoId: nodo.id, forma: mesa.tipo === "redonda" || mesa.tipo === "coctel" ? "circulo" : mesa.tipo === "cuadrada" || mesa.tipo === "rectangular" ? "rectangulo" : "contorno",
      centro: c, altoCm: c.y, radioUtilCm: s.radioUtilCm, anchoCm: mesa.anchoCm, fondoCm: mesa.fondoCm,
      contorno: s.contorno.map((p) => { const q = aMundo(marco, p.x, s.altoCm, p.y); return { x: q.x, y: q.z }; }),
    };
  }
  const id = nodo.pieza.mueble?.id;
  if (!id || !esMesaConTapa(id)) return null;
  const { min, max } = armarPieza(nodo.pieza).caja;
  const ancho = max.x - min.x, fondo = max.z - min.z, cx = (min.x + max.x) / 2, cz = (min.z + max.z) / 2;
  const redonda = /redonda|coctel|hexagonal/.test(id);
  const local: Punto2[] = redonda ? elipse(ancho / 2, fondo / 2, 24).map((p) => ({ x: p.x + cx, y: p.y + cz })) : [{ x: min.x, y: min.z }, { x: max.x, y: min.z }, { x: max.x, y: max.z }, { x: min.x, y: max.z }];
  const c = aMundo(marco, cx, max.y, cz);
  return {
    nodoId: nodo.id, forma: redonda ? "circulo" : "rectangulo", centro: c, altoCm: c.y, radioUtilCm: Math.round((Math.min(ancho, fondo) / 2) * 10) / 10,
    anchoCm: ancho, fondoCm: fondo, contorno: local.map((p) => { const q = aMundo(marco, p.x, max.y, p.y); return { x: q.x, y: q.z }; }),
  };
}

/** ¿Cae el punto (x, z) del mundo sobre la tapa (con `margenCm` de tolerancia)? */
export function puntoEnSuperficie(s: SuperficieSuperior, x: number, z: number, margenCm = 0): boolean {
  return dentroDelContorno(s.contorno, x, z, margenCm);
}
