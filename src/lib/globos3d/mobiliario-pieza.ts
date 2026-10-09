import type { AcabadoEscenografia, ElementoEscenografia } from "./escenografia";
import { muebleDe } from "./mobiliario-catalogo";
import type { FondoCatalogo, MuebleCatalogo } from "./mobiliario-tipos";
import type { Pieza } from "./piezas";

/**
 * El mueble **como se guarda en la escena**: la pieza de escenografía lleva `mueble: { id, opciones }` (medidas, colores,
 * acabado, texto) y NO sus sólidos —cada silla serían 17—: `elementosDeEscenografia` los arma al vuelo con el catálogo.
 * Un fondo fijo (panel redondo, cortina…) lleva sus elementos y `mueble: { id }` sin opciones.
 */

export type OpcionesGuardadas = { anchoCm: number; fondoCm: number; altoCm: number; colores: string[]; acabado?: AcabadoEscenografia; texto?: string };
export type MuebleDePieza = { id: string; opciones?: OpcionesGuardadas };
export type PiezaEscenografia = Extract<Pieza, { tipo: "escenografia" }>;

/** Los sólidos de una pieza de escenografía: los guardados, o los del mueble paramétrico armado con sus opciones. */
export function elementosDeEscenografia(p: PiezaEscenografia): ElementoEscenografia[] {
  const o = p.mueble?.opciones;
  const mueble = o && p.mueble ? muebleDe(p.mueble.id) : undefined;
  return mueble && o ? mueble.armar(o) : p.elementos;
}

/** Las opciones completas de un mueble: lo pedido y, de lo que falta, medidas y colores de partida (o el primer color, si `seguirPrimero`). */
export function opcionesDeMueble(m: MuebleCatalogo, pedido: { anchoCm?: number; fondoCm?: number; altoCm?: number; colores?: readonly string[]; acabado?: AcabadoEscenografia; texto?: string } = {}): OpcionesGuardadas {
  const pedidos = pedido.colores ?? [];
  // Los de partida y, si se piden, los opcionales que vienen después (el vidrio de una mesa hexagonal).
  const cuantos = Math.min(m.coloresDe.length, Math.max(m.colores.length, pedidos.length));
  const colores = Array.from({ length: cuantos }, (_, i) => pedidos[i] ?? (m.seguirPrimero && pedidos[0] ? pedidos[0] : m.colores[i] ?? m.colores[0]!));
  return {
    anchoCm: pedido.anchoCm ?? m.medidas.anchoCm, fondoCm: pedido.fondoCm ?? m.medidas.fondoCm, altoCm: pedido.altoCm ?? m.medidas.altoCm, colores,
    ...(pedido.acabado ? { acabado: pedido.acabado } : {}), ...(pedido.texto ? { texto: pedido.texto } : {}),
  };
}

/** Una pieza de escenografía de un mueble paramétrico (sin sólidos guardados). */
export const piezaDeMueble = (m: MuebleCatalogo, opciones: OpcionesGuardadas = opcionesDeMueble(m)): Pieza => ({ tipo: "escenografia", elementos: [], mueble: { id: m.id, opciones } });

/** La pieza de una entrada del catálogo con sus medidas y colores de partida. */
export const piezaDeEntrada = (f: FondoCatalogo): Pieza => (f.clase === "mueble" ? piezaDeMueble(f) : { tipo: "escenografia", elementos: f.elementos(), mueble: { id: f.id } });
