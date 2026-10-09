import { z } from "zod";
import type { AcabadoEscenografia, ElementoEscenografia } from "./escenografia";
import { muebleDe } from "./mobiliario-catalogo";
import type { FondoCatalogo, MuebleCatalogo } from "./mobiliario-tipos";
import type { Pieza } from "./piezas";

/**
 * El mueble **como se guarda en la escena**: la pieza de escenografía lleva `mueble: { id, opciones }` (medidas, colores,
 * acabado, texto) y NO sus sólidos —cada silla serían 17—: `elementosDeEscenografia` los arma al vuelo con el catálogo.
 * Un fondo fijo (panel redondo, cortina…) lleva sus elementos y `mueble: { id }` sin opciones.
 * Las opciones vienen de afuera (la escena guardada, la API, la IA): `normalizarOpciones` las deja siempre armables.
 */

export type OpcionesGuardadas = { anchoCm: number; fondoCm: number; altoCm: number; colores: string[]; acabado?: AcabadoEscenografia; texto?: string };
export type MuebleDePieza = { id: string; opciones?: OpcionesGuardadas };
export type PiezaEscenografia = Extract<Pieza, { tipo: "escenografia" }>;

/** Cuánto se puede achicar o agrandar un mueble respecto a su medida de catálogo. */
export const FACTOR_MINIMO = 0.4;
export const FACTOR_MAXIMO = 2.5;
export const MAX_TEXTO_MUEBLE = 24;
const ACABADOS_MUEBLE = ["mate", "satinado", "brillante", "tela", "madera", "metal"] as const satisfies readonly AcabadoEscenografia[];
export const esAcabadoMueble = (t: string): t is AcabadoEscenografia => (ACABADOS_MUEBLE as readonly string[]).includes(t);
const HEX = /^#[0-9a-fA-F]{6}$/;

/** El esquema de lo guardado en una pieza (lo usa la API de la IA de escena para no dejar pasar medidas ni colores a ciegas). */
export const MuebleDePiezaSchema = z.object({
  id: z.string().min(1).max(60),
  opciones: z.object({
    anchoCm: z.number().finite().positive().max(3000), fondoCm: z.number().finite().positive().max(3000), altoCm: z.number().finite().positive().max(1500),
    colores: z.array(z.string().regex(HEX)).min(1).max(3),
    acabado: z.enum(ACABADOS_MUEBLE).optional(), texto: z.string().max(MAX_TEXTO_MUEBLE).optional(),
  }).optional(),
});

const rango = (base: number) => ({ min: Math.max(2, Math.round(base * FACTOR_MINIMO)), max: Math.round(base * FACTOR_MAXIMO) });
/** Los límites (cm) de cada medida de un mueble. */
export const limitesDeMueble = (m: MuebleCatalogo) => ({ ancho: rango(m.medidas.anchoCm), fondo: rango(m.medidas.fondoCm), alto: rango(m.medidas.altoCm) });

const acotar = (v: unknown, r: { min: number; max: number }, porDefecto: number) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.min(r.max, Math.max(r.min, v)) : porDefecto);

/** El fondo que de verdad lleva un mueble: el pedido si lo respeta; si no, el que sale de su ancho o el de catálogo. */
function fondoDe(m: MuebleCatalogo, ancho: number, pedido: number): number {
  switch (m.fondo ?? "libre") {
    case "igual_ancho": return ancho;
    case "proporcional": return Math.round((ancho * m.medidas.fondoCm) / m.medidas.anchoCm);
    case "fijo": return m.medidas.fondoCm;
    default: return pedido;
  }
}

/** Opciones siempre armables: medidas finitas y dentro de 0,4–2,5 veces el catálogo, fondo según el mueble, colores `#rrggbb` (los que faltan o no valen, de partida), acabado y texto válidos. */
export function normalizarOpciones(m: MuebleCatalogo, o: Partial<OpcionesGuardadas> | undefined): OpcionesGuardadas {
  const l = limitesDeMueble(m);
  const ancho = acotar(o?.anchoCm, l.ancho, m.medidas.anchoCm);
  const pedidos = Array.isArray(o?.colores) ? o.colores : [];
  const cuantos = Math.min(m.coloresDe.length, Math.max(m.colores.length, pedidos.length));
  const colores = Array.from({ length: cuantos }, (_, i) => (typeof pedidos[i] === "string" && HEX.test(pedidos[i]!) ? pedidos[i]!.toLowerCase() : m.colores[i] ?? m.colores[0]!));
  return {
    anchoCm: ancho, fondoCm: fondoDe(m, ancho, acotar(o?.fondoCm, l.fondo, m.medidas.fondoCm)), altoCm: acotar(o?.altoCm, l.alto, m.medidas.altoCm), colores,
    ...(typeof o?.acabado === "string" && esAcabadoMueble(o.acabado) ? { acabado: o.acabado } : {}),
    ...(m.conTexto && typeof o?.texto === "string" && o.texto.trim() ? { texto: o.texto.slice(0, MAX_TEXTO_MUEBLE) } : {}),
  };
}

/** Si el id no está en el catálogo (una escena de otra versión): una caja roja que se ve y el aviso que la explica. */
const MARCADOR_SIN_CATALOGO: ElementoEscenografia = { forma: "caja", centro: { x: 0, y: 25, z: 0 }, tamano: { x: 50, y: 50, z: 50 }, hex: "#d94b4b", acabado: "mate" };

/** Los sólidos de una pieza de escenografía: los guardados, o los del mueble paramétrico armado con sus opciones. */
export function elementosDeEscenografia(p: PiezaEscenografia): ElementoEscenografia[] {
  if (!p.mueble?.opciones) return p.elementos;
  const mueble = muebleDe(p.mueble.id);
  return mueble ? mueble.armar(normalizarOpciones(mueble, p.mueble.opciones)) : p.elementos.length ? p.elementos : [MARCADOR_SIN_CATALOGO];
}

/** Lo que hay que avisar de una pieza de escenografía (un mueble que ya no está en el catálogo), o null. */
export function avisoDeEscenografia(p: PiezaEscenografia): string | null {
  return p.mueble?.opciones && !muebleDe(p.mueble.id) ? `«${p.mueble.id}» no está en el catálogo de esta versión: se dibuja una caja roja en su lugar.` : null;
}

/** Las opciones completas de un mueble: lo pedido y, de lo que falta, medidas y colores de partida (o el primer color, si `seguirPrimero`). */
export function opcionesDeMueble(m: MuebleCatalogo, pedido: { anchoCm?: number; fondoCm?: number; altoCm?: number; colores?: readonly string[]; acabado?: AcabadoEscenografia; texto?: string } = {}): OpcionesGuardadas {
  const pedidos = pedido.colores ?? [];
  // Los de partida y, si se piden, los opcionales que vienen después (el vidrio de una mesa hexagonal).
  const cuantos = Math.min(m.coloresDe.length, Math.max(m.colores.length, pedidos.length));
  const colores = Array.from({ length: cuantos }, (_, i) => pedidos[i] ?? (m.seguirPrimero && pedidos[0] ? pedidos[0] : m.colores[i] ?? m.colores[0]!));
  return normalizarOpciones(m, { ...pedido, colores });
}

/** Una pieza de escenografía de un mueble paramétrico (sin sólidos guardados). */
export const piezaDeMueble = (m: MuebleCatalogo, opciones: Partial<OpcionesGuardadas> = opcionesDeMueble(m)): Pieza => ({ tipo: "escenografia", elementos: [], mueble: { id: m.id, opciones: normalizarOpciones(m, opciones) } });

/** La pieza de una entrada del catálogo con sus medidas y colores de partida. */
export const piezaDeEntrada = (f: FondoCatalogo): Pieza => (f.clase === "mueble" ? piezaDeMueble(f) : { tipo: "escenografia", elementos: f.elementos(), mueble: { id: f.id } });
