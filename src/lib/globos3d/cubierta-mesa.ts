import { puntoAlMundo, puntoALocal, type MarcoPieza, type NodoArmado, type NodoEscena } from "./escena";
import { puntosSolido } from "./escenografia";
import { muebleDeMesa } from "./descripcion-mobiliario";
import type { Vec3 } from "./modulos";

/**
 * **La cubierta de una mesa**: la cara de arriba donde se apoya lo que va encima (el centro de mesa), medida de la geometría armada y no
 * de una constante, así una mesa de cóctel (110 cm), una redonda (75 cm) o un conjunto con sillas (cuya caja llega al respaldo) dan cada una la suya.
 * Es la misma regla de `centros-mesa.ts` de la rama feat/salon-evento (esa rama debería importar `cubiertaDe` de aquí al fusionarlas):
 * entre los sólidos, los que tienen al menos la mitad del área del mayor (la tapa, el sobremantel; no las sillas) y, de ellos, el más alto.
 * Puro: sin React ni three.js.
 */

/** La cara de arriba de una mesa: su centro y sus medidas en el espacio de la mesa, y el centro en el mundo. */
export type Cubierta = { local: Vec3; centro: Vec3; anchoCm: number; fondoCm: number; topeMundo: { minX: number; maxX: number; minZ: number; maxZ: number } };

/**
 * La cubierta de una mesa armada: entre los sólidos, los que tienen al menos la mitad del área del mayor (la tapa, el sobremantel;
 * no las sillas) y, de ellos, el más alto. Se mide en el espacio de la mesa para que girarla no cambie sus medidas.
 */
export function cubiertaDe(hecho: NodoArmado, marco: MarcoPieza): Cubierta | null {
  const piezas = hecho.solidos.filter((s) => !s.oculto).map((s) => {
    const mundo = puntosSolido(s);
    const local = mundo.map((p) => puntoALocal(marco, p));
    const caja = (puntos: Vec3[]) => ({ minX: Math.min(...puntos.map((p) => p.x)), maxX: Math.max(...puntos.map((p) => p.x)), minZ: Math.min(...puntos.map((p) => p.z)), maxZ: Math.max(...puntos.map((p) => p.z)), maxY: Math.max(...puntos.map((p) => p.y)) });
    const l = caja(local), m = caja(mundo);
    return { l, m, area: (l.maxX - l.minX) * (l.maxZ - l.minZ) };
  });
  if (!piezas.length) return null;
  const mayor = Math.max(...piezas.map((p) => p.area));
  const grandes = piezas.filter((p) => p.area >= mayor * 0.5);
  const tope = Math.max(...grandes.map((p) => p.l.maxY));
  const tapa = grandes.filter((p) => p.l.maxY >= tope - 0.01).sort((a, b) => b.area - a.area)[0]!;
  const local: Vec3 = { x: (tapa.l.minX + tapa.l.maxX) / 2, y: tope, z: (tapa.l.minZ + tapa.l.maxZ) / 2 };
  return { local, centro: puntoAlMundo(marco, local), anchoCm: tapa.l.maxX - tapa.l.minX, fondoCm: tapa.l.maxZ - tapa.l.minZ, topeMundo: { minX: tapa.m.minX, maxX: tapa.m.maxX, minZ: tapa.m.minZ, maxZ: tapa.m.maxZ } };
}

/** La cubierta de este nodo si es una mesa puesta y armada; null si no lo es o no quedó puesta. */
export function cubiertaDeNodo(nodo: NodoEscena, armado: NodoArmado | undefined): { cubierta: Cubierta; marco: MarcoPieza } | null {
  const marco = armado?.puestas[0]?.marco;
  if (!armado || !marco || armado.copias === 0 || !muebleDeMesa(nodo)) return null;
  const cubierta = cubiertaDe(armado, marco);
  return cubierta ? { cubierta, marco } : null;
}
