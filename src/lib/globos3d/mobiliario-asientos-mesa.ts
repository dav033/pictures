import type { Escena, NodoEscena } from "./escena";
import { entradaDeCatalogo } from "./fondos-escenografia";
import { esGrupoDeSillas, esMesaParametrica, sillasDePieza } from "./mobiliario-conjunto";
import { SILLAS } from "./mobiliario-sillas-param";
import type { Pieza } from "./piezas";
import { asientosDeEntrada } from "./mobiliario-tipos";

/**
 * **Mesas y sillas de una escena, leídas de las piezas** (REQ-008 y REQ-012): una sola respuesta a «¿es una mesa?», «¿qué mesa admite algo
 * encima?» y «¿cuántas sillas, de qué tipo, son de esta mesa?». El mobiliario con sillas tiene tres representaciones y todas se leen
 * aquí, y solo aquí:
 * - el conjunto fijo del catálogo (`mesa_redonda_sillas`, `mesa_imperial_sillas`, `mesa_redonda10_sillas`): las sillas van dentro de la
 *   pieza y son `opciones.sillas` (lo que fijó el salón) o, si falta, las de siempre del catálogo (`asientosDeEntrada`);
 * - la mesa paramétrica con su grupo de sillas: un nodo aparte, `sobre` la mesa, con un puesto por silla;
 * - la silla suelta (`asiento` en el catálogo): una cada una.
 * Ver escena, la verificación, las comprobaciones de honestidad, el inventario en inglés, la lista de compra y los resúmenes cuentan por
 * estas funciones; ninguno cuenta por el nombre de la pieza ni por un número propio. Puro: sin red ni React.
 */

/** Las entradas del catálogo con varias mesas en una pieza (un juego nido): no tienen una sola cubierta donde apoyar algo. */
const JUEGO_DE_MESAS = /^mesas_nido/;
/** Mesas que ya llevan cosas encima de fábrica (regalos, dulces): su cubierta existe pero no admite un centro sin forzar. */
const DE_FABRICA_CON_COSAS = /^(mesa_regalos|carrito_dulces)$/;

const idDeMueble = (n: NodoEscena): string | undefined => (n.pieza.tipo === "escenografia" ? n.pieza.mueble?.id : undefined);

/** ¿Es una mesa (paramétrica o una entrada del catálogo del grupo mesa)? */
export function esMesa(n: NodoEscena): boolean {
  if (esMesaParametrica(n.pieza)) return true;
  const id = idDeMueble(n);
  return id !== undefined && entradaDeCatalogo(id)?.grupo === "mesa";
}

export type TapaDeMesa = { id: string; deFabricaConCosas: boolean };

/** La mesa que tiene una cubierta donde apoyar algo (no un juego de mesas nido), y si trae cosas encima de fábrica; null si no lo es. */
export function tapaDeMesa(n: NodoEscena): TapaDeMesa | null {
  const id = idDeMueble(n);
  if (!id || !esMesa(n) || JUEGO_DE_MESAS.test(id)) return null;
  return { id, deFabricaConCosas: DE_FABRICA_CON_COSAS.test(id) };
}

/** Los asientos que lleva una pieza en sí: las sillas de un grupo, las de un conjunto fijo, 1 de una silla suelta, 0 del resto (una mesa paramétrica sola no lleva). */
export function asientosDePieza(p: Pieza): number {
  if (p.tipo !== "escenografia" || !p.mueble) return 0;
  const grupo = sillasDePieza(p);
  if (grupo) return grupo.puestos.length;
  if (p.mueble.mesa) return 0;
  const entrada = entradaDeCatalogo(p.mueble.id);
  return entrada?.clase === "mueble" ? asientosDeEntrada(entrada, p.mueble.opciones) : 0;
}

export const asientosPropios = (n: NodoEscena): number => asientosDePieza(n.pieza);

/** Cuántas unidades cuenta una pieza de escenografía en una lista o en la descripción: las sillas de un grupo, 1 de lo demás. */
export function unidadesDeEscenografia(p: Pieza): number {
  return esGrupoDeSillas(p) ? Math.min(asientosDePieza(p), 400) : 1;
}

/** El grupo de sillas de una mesa: el nodo `sobre` ella con `mueble.sillas`, o null. */
export function grupoDeSillasDe(escena: Escena, mesaId: string): NodoEscena | null {
  return escena.nodos.find((n) => n.colocacion.en === "sobre" && n.colocacion.padreId === mesaId && n.id !== mesaId && esGrupoDeSillas(n.pieza)) ?? null;
}

export type SillasDeMesa = {
  /** Las sillas que son de la mesa: las de su pieza (conjunto fijo) y las de su grupo. */
  total: number;
  /** Por tipo («Silla Tiffany»), con su plural para los resúmenes. */
  tipos: Array<{ tipo: string; nombre: string; plural: string; cantidad: number }>;
  /** Ids de los nodos que las llevan (la mesa si las trae dentro, y su grupo). */
  nodos: string[];
};

/** Cuántas sillas, de qué tipo, son de esta mesa (cualquiera de las tres representaciones). */
export function sillasDeMesaNodo(escena: Escena, mesa: NodoEscena): SillasDeMesa {
  const tipos = new Map<string, { nombre: string; plural: string; cantidad: number }>();
  const nodos: string[] = [];
  const sumar = (tipo: keyof typeof SILLAS, cantidad: number, id: string) => {
    if (cantidad <= 0) return;
    const previo = tipos.get(tipo);
    tipos.set(tipo, { nombre: SILLAS[tipo].nombre, plural: SILLAS[tipo].plural, cantidad: (previo?.cantidad ?? 0) + cantidad });
    nodos.push(id);
  };
  // Un conjunto fijo del catálogo trae sus sillas dentro y son Tiffany; una silla suelta no es «de» una mesa.
  if (!esMesaParametrica(mesa.pieza) && esMesa(mesa)) sumar("tiffany", asientosPropios(mesa), mesa.id);
  // El grupo de sillas de la mesa se cuenta sea cual sea la mesa: lo que está dibujado es lo que cuenta (`contarMobiliario` suma las mismas piezas).
  const grupo = esMesa(mesa) ? grupoDeSillasDe(escena, mesa.id) : null;
  const s = grupo ? sillasDePieza(grupo.pieza) : null;
  if (grupo && s) sumar(s.tipo, s.puestos.length, grupo.id);
  return { total: [...tipos.values()].reduce((a, t) => a + t.cantidad, 0), tipos: [...tipos].map(([tipo, t]) => ({ tipo, ...t })), nodos };
}

/** «8 sillas Tiffany», «1 silla Tiffany», «3 sillas crossback y 2 bancas»: las sillas de una mesa dichas por lo que son. */
export function textoSillasDeMesa(s: SillasDeMesa): string {
  return s.tipos.map((t) => `${t.cantidad} ${t.cantidad === 1 ? t.nombre.toLowerCase() : t.plural}`).join(" y ") || "sin sillas";
}

export type ConteoMobiliario = { mesas: number; sillas: number };

/** Las mesas y sillas que HAY en la escena, leídas de las piezas por las funciones de arriba (nunca del nombre). */
export function contarMobiliario(escena: Escena): ConteoMobiliario {
  let mesas = 0, sillas = 0;
  for (const n of escena.nodos) {
    if (esMesa(n)) mesas++;
    sillas += asientosPropios(n);
  }
  return { mesas, sillas };
}
