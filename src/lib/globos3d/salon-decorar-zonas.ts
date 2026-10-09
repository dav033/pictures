import type { Escena } from "./escena";
import type { HerramientaExtra } from "./herramientas-escena-grupos";
import { HERRAMIENTAS_CENTROS } from "./herramientas-escena-centros";
import { HERRAMIENTAS_TECHO_ZONA } from "./herramientas-escena-techo-zona";
import type { EstiloSalon } from "./salon-decoracion";
import { anclaDeZona, anotarPieza } from "./salon-registro";
import { zonasDeEscena, type ZonaSalon } from "./salon-zonas";

/**
 * **Los centros de mesa y el techo de un evento** (REQ-008), puestos con las herramientas de siempre (`decorar_mesas`, `techo_por_zona`)
 * sobre las zonas que dice el registro del salón (`zonasDeEscena`): nunca se leen los ids. El techo queda anotado en el registro como
 * adorno de su zona, así que `mover_zona`, `quitar_zona` y `armar_salon` con reemplazar lo llevan o lo quitan con ella.
 * - centros: el mismo diseño en cada mesa de invitados y en la principal (ramo de helio; racimo si el estilo es clásico);
 * - techo `pista`: festones alrededor de la pista de baile, si hay pista; `rincon`: un grupito de globos de helio sobre la mesa
 *   principal o, si no hay, sobre la de postres.
 */

export type TechoDelEvento = "pista" | "rincon" | null;
export type PedidoZonas = { colores: readonly string[]; estilo: EstiloSalon; techo: TechoDelEvento };

/** Llama a una herramienta; si falla, dice por qué en las notas y deja la escena como estaba (el salón no se tumba por un adorno). */
function llamar(escena: Escena, familia: Readonly<Record<string, HerramientaExtra>>, nombre: string, argumentos: unknown, notas: string[]): Escena {
  try {
    const r = familia[nombre]!.aplicar(escena, argumentos);
    notas.push(r.resumen);
    return r.escena;
  } catch (error) {
    notas.push(`No pude aplicar ${nombre}: ${error instanceof Error ? error.message : String(error)}`);
    return escena;
  }
}

function centros(escena: Escena, p: PedidoZonas, notas: string[]): Escena {
  const z = zonasDeEscena(escena);
  const mesas = [...z.mesas, ...(z.mesaPrincipal ? [z.mesaPrincipal.id] : [])];
  if (!mesas.length) return escena;
  const diseno = { tipo: p.estilo === "clasico" ? "racimo" : "ramo_helio", ...(p.colores.length ? { colores: [...p.colores] } : {}) };
  return llamar(escena, HERRAMIENTAS_CENTROS, "decorar_mesas", { disenos: [diseno], mesas }, notas);
}

function techo(escena: Escena, p: PedidoZonas, notas: string[]): Escena {
  if (!p.techo) return escena;
  const zona: ZonaSalon | null = p.techo === "pista" ? (anclaDeZona(escena, "pista") ? "pista" : null) : anclaDeZona(escena, "mesa_principal") ? "mesa_principal" : anclaDeZona(escena, "mesa_postres") ? "mesa_postres" : null;
  const ancla = zona && anclaDeZona(escena, zona);
  if (!zona || !ancla) return escena;
  const colores = p.colores.length ? { colores: [...p.colores] } : {};
  const pedido = p.techo === "pista"
    ? { tipo: "festones", sobre_pieza: ancla.nodo.id, margen_cm: 60, nombre: "Techo de la pista de baile", ...colores }
    : { tipo: "helio", densidad: "baja", sobre_pieza: ancla.nodo.id, margen_cm: 60, nombre: "Techo del rincón", ...colores };
  const nueva = llamar(escena, HERRAMIENTAS_TECHO_ZONA, "techo_por_zona", pedido, notas);
  const puesta = nueva.nodos.find((n) => !escena.nodos.some((x) => x.id === n.id));
  return puesta ? anotarPieza(nueva, puesta.id, { zona, rol: "adorno" }) : nueva;
}

/** Pone los centros de mesa y el techo que pide el evento sobre un salón ya armado. */
export function decorarMesasYTecho(escena: Escena, p: PedidoZonas, notas: string[]): Escena {
  return techo(centros(escena, p, notas), p, notas);
}
