import { avisar } from "./avisos-usuario";
import type { Escena } from "./escena";
import type { HerramientaExtra } from "./herramientas-escena-grupos";
import { centrosDe, padreDeCentro } from "./centros-mesa";
import { HERRAMIENTAS_CENTROS } from "./herramientas-escena-centros";
import { HERRAMIENTAS_TECHO_ZONA } from "./herramientas-escena-techo-zona";
import { coloresReconocidos, type EstiloSalon } from "./salon-piezas";
import { anclaDeZona, anotarPieza } from "./salon-registro";
import { zonasDeEscena, type ZonaSalon } from "./salon-zonas";

/**
 * **Los centros de mesa y el techo de un evento** (REQ-008), puestos con las herramientas de siempre (`decorar_mesas`, `techo_por_zona`)
 * sobre las zonas que dice el registro del salón (`zonasDeEscena`): nunca se leen los ids. El techo queda anotado en el registro como
 * adorno de su zona, así que `mover_zona`, `quitar_zona` y `armar_salon` con reemplazar lo llevan o lo quitan con ella.
 * - centros: el mismo diseño en cada mesa de invitados y en la principal (ramo de helio; racimo si el estilo es clásico);
 * - techo `pista`: festones alrededor de la pista de baile, si hay pista; `rincon`: un grupito de globos de helio sobre la mesa
 *   principal o, si no hay, sobre la de postres; `fondo`: globos de helio sobre el fondo de fotos (la composición «columnas y techo»).
 */

export type TechoDelEvento = "pista" | "rincon" | "fondo";
export type PedidoZonas = { colores: readonly string[]; estilo: EstiloSalon; centros: boolean; techos: readonly TechoDelEvento[] };

/** Llama a una herramienta; si falla, dice por qué en las notas y deja la escena como estaba (el salón no se tumba por un adorno). */
function llamar(escena: Escena, familia: Readonly<Record<string, HerramientaExtra>>, nombre: string, argumentos: unknown, notas: string[]): Escena {
  try {
    const r = familia[nombre]!.aplicar(escena, argumentos);
    notas.push(r.resumen);
    return r.escena;
  } catch (error) {
    avisar(notas, `No pude aplicar ${nombre}: ${error instanceof Error ? error.message : String(error)}`, "no pude", nombre);
    return escena;
  }
}

/** Centros cada vez más chicos para las mesas de tapa chica (una redonda de 2 sillas mide ~60 cm de tapa): el de siempre no cabe en ellas. */
const CENTROS_CHICOS = [{ tipo: "racimo", alto_cm: 15 }, { tipo: "columna", alto_cm: 25 }] as const;

function centros(escena: Escena, p: PedidoZonas, notas: string[]): Escena {
  const z = zonasDeEscena(escena);
  const mesas = [...z.mesas, ...(z.mesaPrincipal ? [z.mesaPrincipal.id] : [])];
  if (!mesas.length) return escena;
  const colores = p.colores.length ? { colores: [...p.colores] } : {};
  const diseno = { tipo: p.estilo === "clasico" ? "racimo" : "ramo_helio", ...colores };
  const decoradas = (e: Escena) => new Set(centrosDe(e).map((c) => padreDeCentro(c)));
  const primeras: string[] = [];
  let actual = llamar(escena, HERRAMIENTAS_CENTROS, "decorar_mesas", { disenos: [diseno], mesas }, primeras);
  let faltan = mesas.filter((id) => !decoradas(actual).has(id));
  const chicas: string[] = [];
  for (const chico of CENTROS_CHICOS) {
    if (!faltan.length) break;
    // Las mesas donde no cupo el centro de siempre llevan uno más chico (lo dice el resumen), no se quedan peladas.
    actual = llamar(actual, HERRAMIENTAS_CENTROS, "decorar_mesas", { disenos: [{ ...chico, ...colores }], mesas: faltan }, chicas);
    faltan = mesas.filter((id) => !decoradas(actual).has(id));
  }
  // Si todas quedaron con centro, el aviso de «no cupo» de la primera pasada ya no vale: solo se dice lo que se puso.
  notas.push(...(faltan.length ? primeras : primeras.filter((n) => !n.startsWith("No pude aplicar")).map((n) => n.split(" No quedaron")[0]!)), ...chicas.map((n) => n.split(" No quedaron")[0]!));
  if (faltan.length) avisar(notas, `${faltan.length} mesa(s) no llevan centro: ni el más chico cabe en su tapa.`, "no llevan centro", "sin centro", "no cabe");
  return actual;
}

/** Dónde y cómo va cada techo: la zona que cubre, la herramienta con que se pide y su nombre. */
const TECHOS: Readonly<Record<TechoDelEvento, { zonas: readonly ZonaSalon[]; pedido: Record<string, unknown> }>> = {
  pista: { zonas: ["pista"], pedido: { tipo: "festones", margen_cm: 60, nombre: "Techo de la pista de baile" } },
  rincon: { zonas: ["mesa_principal", "mesa_postres"], pedido: { tipo: "helio", densidad: "baja", margen_cm: 60, nombre: "Techo del rincón" } },
  fondo: { zonas: ["fondo_fotos"], pedido: { tipo: "helio", densidad: "media", margen_cm: 120, nombre: "Techo del fondo de fotos" } },
};

function techo(escena: Escena, cual: TechoDelEvento, p: PedidoZonas, notas: string[]): Escena {
  const { zonas, pedido } = TECHOS[cual];
  const zona = zonas.find((z) => anclaDeZona(escena, z));
  const ancla = zona && anclaDeZona(escena, zona);
  if (!zona || !ancla) return escena;
  const nueva = llamar(escena, HERRAMIENTAS_TECHO_ZONA, "techo_por_zona", { ...pedido, sobre_pieza: ancla.nodo.id, ...(p.colores.length ? { colores: [...p.colores] } : {}) }, notas);
  const puesta = nueva.nodos.find((n) => !escena.nodos.some((x) => x.id === n.id));
  return puesta ? anotarPieza(nueva, puesta.id, { zona, rol: "adorno" }) : nueva;
}

/** Pone los centros de mesa y el techo que pide el evento sobre un salón ya armado. */
export function decorarMesasYTecho(escena: Escena, pedido: PedidoZonas, notas: string[]): Escena {
  // Un color que no se fabrica se salta (y se avisa) en vez de tumbar los centros y el techo; sin ninguno, las herramientas usan blanco y dorado.
  const p = { ...pedido, colores: pedido.colores.length ? coloresReconocidos(pedido.colores, notas) : [] };
  return p.techos.reduce((e, cual) => techo(e, cual, p, notas), p.centros ? centros(escena, p, notas) : escena);
}
