import type { Colocacion, NodoEscena } from "./escena";
import {
  COLOR_MANTEL, COLOR_PATAS, NOMBRE_MESA, normalizarMesa, normalizarSillas, PARTIDA_MESA,
  type DisposicionSillas, type MesaGuardada, type SillasGuardadas, type TipoMesa, type TipoSilla,
} from "./mobiliario-conjunto-tipos";
import type { PiezaEscenografia } from "./mobiliario-pieza";
import { repartirSillas } from "./mobiliario-perimetro";
import { SILLAS } from "./mobiliario-sillas-param";
import type { Pieza } from "./piezas";

/**
 * **El conjunto de mesa como función pura** (REQ-012): `armarConjuntoMesa(mesa, sillas)` devuelve los dos nodos —la mesa y,
 * aparte, su grupo de sillas— listos para meter en una escena. Las sillas van `sobre` la mesa (así se mueven, giran y duplican
 * con ella: `escena.ts` las arma en el marco de la mesa) y no cuentan como decoración. Lo usan las herramientas de la IA
 * (`herramientas-escena-mesas.ts`) y lo puede llamar cualquier otra (el salón con `sillas_por_mesa`): no toca la escena.
 */

/** Lo que se pide de una mesa: el tipo y, de lo demás, solo lo que se quiere cambiar (todo `#rrggbb`). */
export type PedidoMesa = { tipo: TipoMesa } & Partial<Omit<MesaGuardada, "tipo">>;

/** Lo que se pide de las sillas de una mesa; lo que falta sale de las que ya tenía o del tipo. `colorCojin: null` = sin cojín. */
export type PedidoSillas = {
  cantidad: number; tipo?: TipoSilla; colorEstructura?: string; colorCojin?: string | null; disposicion?: DisposicionSillas;
  /** Con `frente`: hacia dónde miran, en grados en el marco de la mesa (0 = +z, 90 = +x). */
  haciaGrados?: number;
};

export const esMesaParametrica = (p: Pieza): p is PiezaEscenografia & { mueble: { id: string; mesa: MesaGuardada } } => p.tipo === "escenografia" && Boolean(p.mueble?.mesa);
export const esGrupoDeSillas = (p: Pieza): p is PiezaEscenografia & { mueble: { id: string; sillas: SillasGuardadas } } => p.tipo === "escenografia" && Boolean(p.mueble?.sillas);

/** La mesa de una pieza paramétrica ya normalizada (lo guardado puede venir de fuera). */
export const mesaDePieza = (p: Pieza): MesaGuardada | null => (esMesaParametrica(p) ? normalizarMesa(p.mueble.mesa) : null);
export const sillasDePieza = (p: Pieza): SillasGuardadas | null => (esGrupoDeSillas(p) ? normalizarSillas(p.mueble.sillas) : null);

export const piezaDeMesa = (m: MesaGuardada): Pieza => ({ tipo: "escenografia", elementos: [], mueble: { id: "mesa_param", mesa: normalizarMesa(m) } });
export const piezaDeSillas = (s: SillasGuardadas): Pieza => ({ tipo: "escenografia", elementos: [], mueble: { id: "sillas_param", sillas: normalizarSillas(s) } });

/** La medida que identifica a una mesa: «Ø150», «90×90», «240×90». */
export function medidaDeMesa(m: MesaGuardada): string {
  const r = Math.round;
  if (m.tipo === "redonda" || m.tipo === "coctel" || m.tipo === "media_luna") return `Ø${r(m.anchoCm)}`;
  return m.tipo === "cuadrada" ? `${r(m.anchoCm)}×${r(m.anchoCm)}` : `${r(m.anchoCm)}×${r(m.fondoCm)}`;
}

export const PLURAL_MESA: Readonly<Record<TipoMesa, string>> = {
  redonda: "mesas redondas", cuadrada: "mesas cuadradas", rectangular: "mesas rectangulares", ovalada: "mesas ovaladas", coctel: "mesas cóctel",
  media_luna: "mesas media luna", serpentina: "mesas serpentina", u: "banquetes en U",
};

/** «Mesa redonda Ø150». */
export const nombreDeMesa = (m: MesaGuardada): string => `${NOMBRE_MESA[m.tipo]} ${medidaDeMesa(m)}`;
/** «Silla Tiffany (mesa-redonda)»: el paréntesis dice de qué mesa son (la lista de compra lo quita y junta todas las Tiffany). */
export const nombreDeSillas = (s: SillasGuardadas, mesaId: string): string => `${SILLAS[s.tipo].nombre} (${mesaId})`;

export const MANTEL_TEXTO = { piso: "mantel hasta el piso", corto: "mantel corto", ninguno: "sin mantel" } as const;

/** Las sillas que resultan de un pedido sobre una mesa: el pedido, lo que ya tenían y los valores del tipo. `null` si no queda ninguna. */
export function sillasParaMesa(mesa: MesaGuardada, pedido: PedidoSillas, previas?: SillasGuardadas | null): { sillas: SillasGuardadas | null; nota: string | null; capacidad: number } {
  const tipo = pedido.tipo ?? previas?.tipo ?? "tiffany";
  const datos = SILLAS[tipo];
  // Al cambiar de tipo sin decir colores, los colores son los del tipo nuevo (un dorado de Tiffany no sirve en una de madera).
  const mismoTipo = previas?.tipo === tipo;
  const colorEstructura = pedido.colorEstructura ?? (mismoTipo ? previas!.colorEstructura : datos.estructura);
  const colorCojin = datos.cojin ? (pedido.colorCojin !== undefined ? pedido.colorCojin : mismoTipo ? previas!.colorCojin : datos.cojin) : null;
  const disposicion = pedido.disposicion ?? previas?.disposicion ?? "alrededor";
  const haciaGrados = pedido.haciaGrados ?? previas?.haciaGrados ?? 0;
  const cantidad = Math.max(0, Math.round(pedido.cantidad));
  if (cantidad === 0) return { sillas: null, nota: null, capacidad: 0 };
  const r = repartirSillas(mesa, { tipo, cantidad, disposicion, haciaGrados });
  if (!r.puestos.length) return { sillas: null, nota: r.nota ?? `En esa mesa no cabe ninguna ${datos.nombre.toLowerCase()} con la disposición «${disposicion.replace(/_/g, " ")}».`, capacidad: r.capacidad };
  return { sillas: { tipo, colorEstructura, colorCojin, disposicion, haciaGrados: disposicion === "frente" ? haciaGrados : 0, pedida: r.pedida, puestos: r.puestos }, nota: r.nota, capacidad: r.capacidad };
}

/** La mesa completa de un pedido: los valores del tipo y, encima, lo pedido. */
export function mesaDePedido(p: PedidoMesa): MesaGuardada {
  const partida = PARTIDA_MESA[p.tipo];
  return normalizarMesa({ ...partida, colorMantel: COLOR_MANTEL, colorPatas: COLOR_PATAS, camino: null, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) });
}

export type ConjuntoArmado = {
  /** La mesa y, si lleva, sus sillas (en ese orden). */
  nodos: NodoEscena[];
  mesa: NodoEscena;
  sillas: NodoEscena | null;
  /** Lo que se ajustó (no caben todas las sillas pedidas…). */
  notas: string[];
};

/**
 * La mesa y su grupo de sillas como nodos de escena. `ids` son los ids ya reservados; `colocacion` es la de la mesa en el piso
 * (centro y giro: las sillas la siguen). Sin `sillas` (o con 0) solo sale la mesa.
 */
export function armarConjuntoMesa(p: { ids: { mesa: string; sillas: string }; mesa: PedidoMesa; sillas?: PedidoSillas | null; colocacion: Extract<Colocacion, { en: "piso" }>; nombre?: string }): ConjuntoArmado {
  const mesaGuardada = mesaDePedido(p.mesa);
  const mesa: NodoEscena = { id: p.ids.mesa, nombre: p.nombre ?? nombreDeMesa(mesaGuardada), pieza: piezaDeMesa(mesaGuardada), colocacion: p.colocacion };
  const notas: string[] = [];
  const hecho = p.sillas ? sillasParaMesa(mesaGuardada, p.sillas) : null;
  if (hecho?.nota) notas.push(hecho.nota);
  const sillas: NodoEscena | null = hecho?.sillas
    ? { id: p.ids.sillas, nombre: nombreDeSillas(hecho.sillas, p.ids.mesa), pieza: piezaDeSillas(hecho.sillas), colocacion: colocacionDeSillas(p.ids.mesa) }
    : null;
  return { nodos: sillas ? [mesa, sillas] : [mesa], mesa, sillas, notas };
}

/** Las sillas van `sobre` su mesa en su origen: `escena.ts` las arma en el marco de la mesa, sin tocar el punto ni la normal. */
export const colocacionDeSillas = (mesaId: string): Colocacion => ({ en: "sobre", padreId: mesaId, puntoCm: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 }, giroGrados: 0 });

/** Cuántas unidades cuenta una pieza de escenografía en una lista o en la descripción: las sillas de un grupo, 1 de lo demás. */
export function unidadesDeEscenografia(p: Pieza): number {
  const s = p.tipo === "escenografia" ? p.mueble?.sillas : undefined;
  return s ? Math.min(s.puestos?.length ?? 0, 400) : 1;
}
