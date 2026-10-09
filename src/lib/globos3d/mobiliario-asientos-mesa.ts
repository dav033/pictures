import type { Escena, NodoEscena } from "./escena";
import { muebleDe } from "./mobiliario-catalogo";
import { esGrupoDeSillas, esMesaParametrica, sillasDePieza } from "./mobiliario-conjunto";
import { SILLAS } from "./mobiliario-sillas-param";
import { asientosDeEntrada, type MuebleCatalogo } from "./mobiliario-tipos";

/**
 * **Una sola respuesta a «¿cuántas sillas, de qué tipo, son de esta mesa?»** (REQ-008 y REQ-012). El mobiliario con sillas tiene tres
 * representaciones y todas se leen aquí, y solo aquí:
 * - el conjunto fijo del catálogo (`mesa_redonda_sillas`, `mesa_imperial_sillas`, `mesa_redonda10_sillas`): las sillas van dentro de
 *   la pieza y son `opciones.sillas` (lo que fijó el salón o el usuario) o, si falta, las de siempre del catálogo (`asientos`);
 * - la mesa paramétrica con su grupo de sillas: un nodo aparte, `sobre` la mesa, con un puesto por silla;
 * - la silla suelta (`asiento` en el catálogo): una cada una.
 * Ver escena, la verificación, las comprobaciones de honestidad, el inventario en inglés, la lista de compra y los resúmenes cuentan por
 * estas funciones; ninguno cuenta por el nombre de la pieza ni por un número propio. Puro: sin red ni React.
 */

/** Los asientos que lleva ESTA pieza en sí: las sillas de un grupo, las de un conjunto fijo, 1 de una silla suelta, 0 del resto (una mesa paramétrica sola no lleva). */
export function asientosPropios(n: NodoEscena): number {
  if (n.pieza.tipo !== "escenografia" || !n.pieza.mueble) return 0;
  const s = sillasDePieza(n.pieza);
  if (s) return s.puestos.length;
  if (n.pieza.mueble.mesa) return 0;
  const m = muebleDe(n.pieza.mueble.id);
  return m ? asientosDeEntrada(m, n.pieza.mueble.opciones) : 0;
}

/** El mueble del catálogo que es esta pieza, o undefined. */
export const muebleDeNodo = (n: NodoEscena): MuebleCatalogo | undefined => (n.pieza.tipo === "escenografia" && n.pieza.mueble ? muebleDe(n.pieza.mueble.id) : undefined);

/** Mesas del catálogo donde se sienta la gente (las que cuentan como mesa del evento aunque no traigan sillas). */
const MESAS_PARA_SENTARSE = new Set(["mesa_imperial", "mesa_imperial_mantel", "mesa_redonda", "mesa_redonda_mantel", "mesa_coctel", "mesa_coctel_licra", "mesa_mantel"]);

/** ¿Es una mesa del evento (paramétrica, conjunto con sillas o mesa para sentarse del catálogo)? */
export function esMesaDeEvento(n: NodoEscena): boolean {
  if (esMesaParametrica(n.pieza)) return true;
  const m = muebleDeNodo(n);
  return Boolean(m && (m.sillas || MESAS_PARA_SENTARSE.has(m.id)));
}

export type SillasDeMesa = {
  /** Las sillas que son de la mesa: las de su grupo y las de su pieza. */
  total: number;
  /** Por tipo («Silla Tiffany»), con su plural para los resúmenes. */
  tipos: Array<{ tipo: string; nombre: string; plural: string; cantidad: number }>;
  /** Ids de los nodos que las llevan (la mesa si las trae dentro, y su grupo). */
  nodos: string[];
};

/** El grupo de sillas de una mesa: el nodo `sobre` ella con `mueble.sillas`, o null. */
export function grupoDeSillasDe(escena: Escena, mesaId: string): NodoEscena | null {
  return escena.nodos.find((n) => n.colocacion.en === "sobre" && n.colocacion.padreId === mesaId && n.id !== mesaId && esGrupoDeSillas(n.pieza)) ?? null;
}

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
  const dentro = asientosPropios(mesa);
  // Las sillas que trae dentro un conjunto fijo del catálogo son Tiffany; una silla suelta no es «de» una mesa.
  if (dentro > 0 && muebleDeNodo(mesa)?.sillas) sumar("tiffany", dentro, mesa.id);
  const grupo = esMesaParametrica(mesa.pieza) ? grupoDeSillasDe(escena, mesa.id) : null;
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
    if (esMesaDeEvento(n)) mesas++;
    sillas += asientosPropios(n);
  }
  return { mesas, sillas };
}

/** «3 mesas, 24 sillas» (solo lo que hay). */
export function textoConteo(c: ConteoMobiliario): string {
  return [c.mesas ? `${c.mesas} ${c.mesas === 1 ? "mesa" : "mesas"}` : "", c.sillas ? `${c.sillas} ${c.sillas === 1 ? "silla" : "sillas"}` : ""].filter(Boolean).join(", ") || "sin mesas ni sillas";
}
