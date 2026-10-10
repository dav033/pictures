import { z } from "zod";
import { idCortoDeFondo } from "@/lib/catalogo/asignacion-fondos";
import type { AcabadoEscenografia, ElementoEscenografia, RotuloEscenografia } from "./escenografia";
import { entradaDeCatalogo } from "./fondos-escenografia";
import { muebleDe } from "./mobiliario-catalogo";
import { MesaGuardadaSchema, normalizarMesa, normalizarSillas, SillasGuardadasSchema, type MesaGuardada, type SillasGuardadas } from "./mobiliario-conjunto-tipos";
import { armarMesa } from "./mobiliario-mesas-param";
import { armarSillas } from "./mobiliario-sillas-param";
import { asientosDeEntrada, type FondoCatalogo, type MuebleCatalogo } from "./mobiliario-tipos";
import type { Pieza } from "./piezas";
import { cambiarRotulo, conRotulo, limpiarTexto, MAX_TEXTO_ROTULO, normalizarRotulo, RotuloSchema, soporteDeRotulo, type ModoPortador, type PedidoRotulo, type Soporte } from "./rotulos";

/**
 * El mueble **como se guarda en la escena**: la pieza de escenografía lleva `mueble: { id, opciones }` (medidas, colores,
 * acabado, texto) y NO sus sólidos —cada silla serían 17—: `elementosDeEscenografia` los arma al vuelo con el catálogo.
 * Un fondo fijo (panel redondo, cortina…) lleva sus elementos y `mueble: { id }` sin opciones. Lo que admite un rótulo en cursiva
 * (`rotulable` en el catálogo: panel redondo, arcos, lentejuelas, letrero, marco con tela) lo lleva en `mueble.rotulo` y se pone
 * al armar (`conRotulo`): quitar el rótulo es quitar ese campo.
 * Las opciones vienen de afuera (la escena guardada, la API, la IA): `normalizarOpciones` las deja siempre armables.
 */

export type OpcionesGuardadas = { anchoCm: number; fondoCm: number; altoCm: number; colores: string[]; acabado?: AcabadoEscenografia; texto?: string; /** Solo en las mesas del catálogo con sillas fijas: cuántas lleva si no son las de siempre (REQ-008). */ sillas?: number };
/**
 * `mesa` / `sillas`: la pieza es una mesa paramétrica o el grupo de sillas de una mesa (REQ-012, `mobiliario-conjunto-tipos.ts`); con
 * ellas el `id` es solo una etiqueta (`mesa_param`, `sillas_param`) y los sólidos salen de esos datos.
 */
export type MuebleDePieza = { id: string; opciones?: OpcionesGuardadas; rotulo?: RotuloEscenografia; mesa?: MesaGuardada; sillas?: SillasGuardadas; /** Fondo fijo con color cambiado: el de su parte principal (`tinte` del catálogo es el de partida). */ tinte?: string };
export type PiezaEscenografia = Extract<Pieza, { tipo: "escenografia" }>;

/** Cuánto se puede achicar o agrandar un mueble respecto a su medida de catálogo. */
export const FACTOR_MINIMO = 0.4;
export const FACTOR_MAXIMO = 2.5;
export const MAX_TEXTO_MUEBLE = MAX_TEXTO_ROTULO;
/** Los acabados que puede llevar el color principal de un mueble (la única lista: esquema, herramienta de la IA y editor). */
export const ACABADOS_MUEBLE = ["mate", "satinado", "brillante", "tela", "madera", "metal", "acrilico"] as const satisfies readonly AcabadoEscenografia[];
export const NOMBRE_ACABADO_MUEBLE: Readonly<Record<(typeof ACABADOS_MUEBLE)[number], string>> = { mate: "Mate", satinado: "Satinado", brillante: "Brillante", tela: "Tela", madera: "Madera", metal: "Metal", acrilico: "Acrílico transparente" };
export const esAcabadoMueble = (t: string): t is AcabadoEscenografia => (ACABADOS_MUEBLE as readonly string[]).includes(t);
const HEX = /^#[0-9a-fA-F]{6}$/;

/** El esquema de lo guardado en una pieza (lo usa la API de la IA de escena para no dejar pasar medidas ni colores a ciegas). */
export const MuebleDePiezaSchema = z.object({
  /** Corto o calificado con SU repositorio (`mobiliario:silla_tiffany`); el que llega calificado se guarda corto (`esquema-escena.ts`). */
  id: z.string().min(1).max(60).refine((id) => idCortoDeFondo(id) !== null, "un id calificado tiene que ser de su repositorio"),
  opciones: z.object({
    anchoCm: z.number().finite().positive().max(3000), fondoCm: z.number().finite().positive().max(3000), altoCm: z.number().finite().positive().max(1500),
    colores: z.array(z.string().regex(HEX)).min(1).max(3),
    acabado: z.enum(ACABADOS_MUEBLE).optional(), texto: z.string().max(MAX_TEXTO_MUEBLE).optional(), sillas: z.number().int().min(2).max(20).optional(),
  }).optional(),
  rotulo: RotuloSchema.optional(),
  mesa: MesaGuardadaSchema.optional(),
  sillas: SillasGuardadasSchema.optional(),
  tinte: z.string().regex(HEX).optional(),
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

/** Las sillas de un conjunto de mesa: entero dentro de lo que admite (las imperiales, par); lo que no vale se descarta (lleva las de siempre). */
function sillasValidas(m: MuebleCatalogo, v: unknown): number | undefined {
  if (!m.sillas || typeof v !== "number" || !Number.isInteger(v) || v < m.sillas.min || v > m.sillas.max || (m.sillas.par && v % 2 !== 0) || v === m.sillas.porDefecto) return undefined;
  return v;
}

/** Cuántas sillas lleva de verdad una mesa con sillas (las de su pieza, o las de siempre del catálogo); `null` si no es de ese tipo. */
export function sillasDeMueble(m: MuebleCatalogo, opciones?: { sillas?: number }): number | null {
  return m.sillas ? asientosDeEntrada(m, opciones) : null;
}

/** El nombre de un mueble como es esa pieza: una mesa con sillas dice las que lleva («Mesa redonda con 4 sillas»), no las del catálogo. */
export function nombreDeMueble(m: MuebleCatalogo, opciones?: { sillas?: number }): string {
  const sillas = sillasDeMueble(m, opciones);
  return sillas === null ? m.nombre : m.nombre.replace(/\d+ sillas/, `${sillas} sillas`);
}

/** Opciones siempre armables: medidas finitas y dentro de 0,4–2,5 veces el catálogo, fondo según el mueble, colores `#rrggbb` (los que faltan o no valen, de partida), acabado y texto válidos. */
export function normalizarOpciones(m: MuebleCatalogo, o: Partial<OpcionesGuardadas> | undefined): OpcionesGuardadas {
  const l = limitesDeMueble(m);
  const ancho = acotar(o?.anchoCm, l.ancho, m.medidas.anchoCm);
  const pedidos = Array.isArray(o?.colores) ? o.colores : [];
  const cuantos = Math.min(m.coloresDe.length, Math.max(m.colores.length, pedidos.length));
  const colores = Array.from({ length: cuantos }, (_, i) => (typeof pedidos[i] === "string" && HEX.test(pedidos[i]!) ? pedidos[i]!.toLowerCase() : m.colores[i] ?? m.colores[0]!));
  const sillas = sillasValidas(m, o?.sillas);
  return {
    anchoCm: ancho, fondoCm: sillas !== undefined && m.fondo === "proporcional" ? m.medidas.fondoCm : fondoDe(m, ancho, acotar(o?.fondoCm, l.fondo, m.medidas.fondoCm)), altoCm: acotar(o?.altoCm, l.alto, m.medidas.altoCm), colores,
    ...(sillas !== undefined ? { sillas } : {}),
    ...(typeof o?.acabado === "string" && esAcabadoMueble(o.acabado) && (!m.acabadosPropios || m.acabadosPropios.some(([id]) => id === o.acabado)) ? { acabado: o.acabado } : {}),
    ...(m.conTexto && typeof o?.texto === "string" && limpiarTexto(o.texto, m.lineasTexto ?? 1) ? { texto: limpiarTexto(o.texto, m.lineasTexto ?? 1) } : {}),
  };
}

/** Si el id no está en el catálogo (una escena de otra versión): una caja roja que se ve y el aviso que la explica. */
const MARCADOR_SIN_CATALOGO: ElementoEscenografia = { forma: "caja", centro: { x: 0, y: 25, z: 0 }, tamano: { x: 50, y: 50, z: 50 }, hex: "#d94b4b", acabado: "mate" };

/** Los elementos de una pieza sin su rótulo: los guardados, o los del mueble paramétrico armado con sus opciones. */
function elementosBase(p: PiezaEscenografia): ElementoEscenografia[] {
  if (p.mueble?.mesa) return armarMesa(normalizarMesa(p.mueble.mesa));
  if (p.mueble?.sillas) return armarSillas(normalizarSillas(p.mueble.sillas));
  if (!p.mueble?.opciones) return p.elementos;
  const mueble = muebleDe(p.mueble.id);
  return mueble ? mueble.armar(normalizarOpciones(mueble, p.mueble.opciones)) : p.elementos.length ? p.elementos : [MARCADOR_SIN_CATALOGO];
}

/** ¿Admite esta pieza un rótulo en cursiva? (su entrada del catálogo es `rotulable`). */
export const admiteRotulo = (p: PiezaEscenografia): boolean => Boolean(p.mueble && entradaDeCatalogo(p.mueble.id)?.rotulable);

/** Qué elemento de la pieza lleva el rótulo: el último o, en unos arcos escalonados, el mayor. */
const modoDe = (p: PiezaEscenografia): ModoPortador => (p.mueble && entradaDeCatalogo(p.mueble.id)?.rotulable === "mayor" ? "mayor" : "ultimo");

/** Los sólidos de una pieza de escenografía: los guardados, o los del mueble paramétrico armado con sus opciones, y su rótulo si lo lleva. */
export function elementosDeEscenografia(p: PiezaEscenografia): ElementoEscenografia[] {
  const base = elementosBase(p);
  return p.mueble?.rotulo && admiteRotulo(p) ? conRotulo(base, p.mueble.rotulo, modoDe(p)) : base;
}

/** El elemento que da la cara del rótulo de una pieza: para saber sus medidas y normalizar lo que se le pide. */
export const soporteDeRotuloPieza = (p: PiezaEscenografia): Soporte | null => soporteDeRotulo(elementosBase(p), modoDe(p));
export const portadorDeRotulo = (p: PiezaEscenografia): ElementoEscenografia | undefined => soporteDeRotuloPieza(p)?.elemento;

/** El rótulo tal como se arma (con el texto ya partido en líneas si hizo falta), o undefined si la pieza no lleva. */
export const rotuloArmado = (p: PiezaEscenografia): RotuloEscenografia | undefined => elementosDeEscenografia(p).find((e) => e.rotulo)?.rotulo;

/** La pieza con ese rótulo (normalizado a su cara) o, con `null`, sin rótulo. Una pieza que no admite rótulo vuelve igual. */
export function conRotuloPieza(p: PiezaEscenografia, rotulo: Partial<RotuloEscenografia> | null): Pieza {
  if (!p.mueble || !admiteRotulo(p)) return p;
  const mueble: MuebleDePieza = { id: p.mueble.id, ...(p.mueble.opciones ? { opciones: p.mueble.opciones } : {}), ...(p.mueble.tinte ? { tinte: p.mueble.tinte } : {}) };
  const soporte = soporteDeRotuloPieza(p);
  const nuevo = rotulo ? normalizarRotulo(rotulo, soporte?.elemento) : null;
  return { ...p, mueble: nuevo ? { ...mueble, rotulo: nuevo } : mueble };
}

/** Lo que hay que avisar de una pieza de escenografía (un mueble que ya no está en el catálogo), o null. */
export function avisoDeEscenografia(p: PiezaEscenografia): string | null {
  return p.mueble?.opciones && !muebleDe(p.mueble.id) ? `«${p.mueble.id}» no está en el catálogo de esta versión: se dibuja una caja roja en su lugar.` : null;
}

/** La pieza con su rótulo cambiado según `pedido` (texto, color, acabado, alto, altura): se crea con el texto o, si ya lo tenía, solo cambia lo pedido; un texto vacío lo quita. */
export function conTextoPieza(p: PiezaEscenografia, pedido: PedidoRotulo): Pieza {
  const soporte = soporteDeRotuloPieza(p);
  return conRotuloPieza(p, cambiarRotulo(p.mueble?.rotulo, pedido, soporte?.elemento));
}

/** Las opciones completas de un mueble: lo pedido y, de lo que falta, medidas y colores de partida (o el primer color, si `seguirPrimero`). */
export function opcionesDeMueble(m: MuebleCatalogo, pedido: { anchoCm?: number; fondoCm?: number; altoCm?: number; colores?: readonly string[]; acabado?: AcabadoEscenografia; texto?: string; sillas?: number } = {}): OpcionesGuardadas {
  const pedidos = pedido.colores ?? [];
  // Los de partida y, si se piden, los opcionales que vienen después (el vidrio de una mesa hexagonal).
  const cuantos = Math.min(m.coloresDe.length, Math.max(m.colores.length, pedidos.length));
  const colores = Array.from({ length: cuantos }, (_, i) => pedidos[i] ?? (m.seguirPrimero && pedidos[0] ? pedidos[0] : m.colores[i] ?? m.colores[0]!));
  return normalizarOpciones(m, { ...pedido, colores });
}

/** Una pieza de escenografía de un mueble paramétrico (sin sólidos guardados); `rotulo`: el que lleva (lo conservan los cambios de medida y color). */
export const piezaDeMueble = (m: MuebleCatalogo, opciones: Partial<OpcionesGuardadas> = opcionesDeMueble(m), rotulo?: RotuloEscenografia): Pieza => {
  const pieza: Pieza = { tipo: "escenografia", elementos: [], mueble: { id: m.id, opciones: normalizarOpciones(m, opciones) } };
  return rotulo && pieza.tipo === "escenografia" ? conRotuloPieza(pieza, rotulo) : pieza;
};

/** La pieza de una entrada del catálogo con sus medidas y colores de partida. */
export const piezaDeEntrada = (f: FondoCatalogo): Pieza => (f.clase === "mueble" ? piezaDeMueble(f) : { tipo: "escenografia", elementos: f.elementos(), mueble: { id: f.id } });

/**
 * El fondo fijo con su parte principal en `hex`: cambian los elementos de su color principal (el de partida del catálogo, o el que
 * dejó la foto o el último cambio) y el pie de metal, que sigue al fondo. `null` si no admite color o si no hay ninguna parte de ese color.
 * El aro y los demás elementos quedan como estaban.
 */
export function tintarFondo(p: PiezaEscenografia, hex: string): PiezaEscenografia | null {
  const f = p.mueble ? entradaDeCatalogo(p.mueble.id) : undefined;
  if (!p.mueble || !f || f.clase !== "fondo" || !f.tinte) return null;
  const desde = (p.mueble.tinte ?? f.tinte).toLowerCase();
  const principal = (e: ElementoEscenografia) => e.hex.toLowerCase() === desde;
  const pie = (e: ElementoEscenografia) => e.forma === "caja" && e.acabado === "metal";
  if (!p.elementos.some(principal)) return null;
  const nuevo = hex.toLowerCase();
  return { ...p, elementos: p.elementos.map((e) => (principal(e) || pie(e) ? { ...e, hex: nuevo } : e)), mueble: { ...p.mueble, tinte: nuevo } };
}
