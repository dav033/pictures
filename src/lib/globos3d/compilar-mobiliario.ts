import type { Colocacion } from "./escena";
import type { Pieza } from "./piezas";
import { CATALOGO_MOBILIARIO, type MuebleCatalogo } from "./mobiliario-catalogo";
import { puestosEnFila } from "./mobiliario-disposicion";
import type { PiezaLeida } from "./lectura-foto";

/**
 * **Mobiliario leído de una foto** (`compilar-lectura.ts`, pieza «fondo» con el id de una silla, mesa, sofá, aro…): se
 * arma con el mismo generador del catálogo a la medida leída (acotada a un rango razonable de la de catálogo, para que un
 * error de lectura no dé una silla de 3 m), con los colores leídos, y se coloca en el piso delante de la pared (o en la
 * pared, el neón). Con `cantidad` > 1 y un asiento, salen en fila a lo ancho de lo leído.
 */

export type FondoLeido = Extract<PiezaLeida, { tipo: "fondo" }>;
export type NodoMobiliario = { base: string; nombre: string; pieza: Pieza; colocacion: Colocacion };

export const MUEBLE_POR_ID: ReadonlyMap<string, MuebleCatalogo> = new Map(CATALOGO_MOBILIARIO.map((m) => [m.id, m]));

const r0 = (n: number) => Math.round(n);
const entre = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Los nodos de un mueble leído, o null si el id no es de mobiliario. `anchoCm`/`altoCm`/`xCm`/`yBaseCm` ya vienen en cm de la sala. */
export function mobiliarioLeido(p: FondoLeido, medida: { anchoCm: number; altoCm: number; xCm: number; yBaseCm: number; muroZ: number }): NodoMobiliario[] | null {
  const mueble = MUEBLE_POR_ID.get(p.id);
  if (!mueble) return null;
  const base = mueble.medidas;
  const n = mueble.asiento ? Math.max(1, p.cantidad ?? 1) : 1;
  const colores = [...p.colores.slice(0, 3).map((c) => c.hex), ...mueble.colores.slice(p.colores.length)];
  // Una fila de asientos: lo ancho leído es de todo el grupo, así que cada uno queda a su medida de catálogo.
  const anchoCm = n > 1 ? base.anchoCm : r0(entre(medida.anchoCm, base.anchoCm * 0.5, base.anchoCm * 2.2));
  const altoCm = r0(entre(medida.altoCm, base.altoCm * 0.5, base.altoCm * 2.2));
  const fondoCm = r0(base.fondoCm * entre(anchoCm / base.anchoCm, 0.7, 1.5));
  const pieza: Pieza = { tipo: "escenografia", catalogoId: p.id, elementos: mueble.armar({ anchoCm, fondoCm, altoCm, colores, ...(p.texto ? { texto: p.texto } : {}) }) };
  const idBase = p.id.replace(/_/g, "-");
  if (mueble.lugar === "pared") return [{ base: idBase, nombre: mueble.nombre, pieza, colocacion: { en: "pared", pared: "fondo", aLoLargoCm: r0(medida.xCm), alturaCm: r0(Math.max(0, medida.yBaseCm)) } }];
  const z = medida.muroZ + (mueble.retiroCm ?? 120);
  const separacionCm = n > 1 ? Math.max(anchoCm + 6, (medida.anchoCm - anchoCm) / (n - 1)) : 0;
  return puestosEnFila({ cx: medida.xCm, cz: z, cantidad: n, separacionCm }).map((q, i) => ({
    base: idBase, nombre: n > 1 ? `${mueble.nombre} ${i + 1}` : mueble.nombre, pieza,
    colocacion: { en: "piso", xCm: r0(q.x), zCm: q.z, giroGrados: 0 },
  }));
}
