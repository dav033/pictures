import { formatoPorId } from "./formatos";
import type { Pieza } from "./piezas";
import { textoNumero } from "./texto-cantidad";

/**
 * Helio y cinta para la lista de compra del taller. Son estimaciones de taller, no datos de Sempertex: los litros salen
 * de la esfera del diámetro inflado de CADA globo (`infladoCm`), la pérdida y el tanque son constantes que el dueño puede
 * cambiar aquí, y la cinta sale de la pieza si la tiene (techo: `cintaCm`; ramo: su alto) o, si no, de 1,2 m por globo.
 */

/** Fracción de helio que se pierde al llenar y en la manguera (7 %). */
export const PERDIDA_HELIO = 0.07;

/**
 * Litros de un tanque de helio de fiesta: 50 L a 200 bar, sin descontar la reserva (≈ 10 000 L de gas a presión normal).
 * Estimación nominal: confirmar con el proveedor del taller.
 */
export const LITROS_POR_TANQUE = 10000;

/** Metros de cinta por globo de helio cuando la pieza no dice su cinta (la cinta de techo por defecto, `cintaCm: 120`). */
export const METROS_CINTA_POR_GLOBO = 1.2;

/**
 * Las partes que ya son de helio por lo que son: los globos de helio del techo («helio») y los del ramo de helio («ramo»).
 * Todo otro globo flotante lo marca su fuente con `helio: true` (ver `GloboDecoracion.helio`); un globo sin marca es de aire.
 */
const PARTES_HELIO: ReadonlySet<string> = new Set(["helio", "ramo"]);

/**
 * Lo que la estimación no cuenta ni supone (para la pantalla y el texto copiado): los metalizados (foil) no entran en los
 * litros, del globo dentro de globo cuenta el de fuera, y solo cuentan los marcados como de helio.
 */
export const AVISO_ALCANCE_HELIO =
  "No cuenta los metalizados (foil); del globo dentro de globo cuenta el de fuera. Solo cuentan los globos marcados como de helio: las piezas de la biblioteca ya lo traen; en una escena guardada antes, márcalo en los parámetros del globo.";

/** Los formatos que flotan: redondos y corazones (el tubito y el Link-O-Loon no se llenan con helio). */
export function formatoFlota(formatoId: string): boolean {
  const tipo = formatoPorId(formatoId)?.tipo;
  return tipo === "redondo" || tipo === "corazon";
}

/** ¿Lleva helio la pieza, entera (`Pieza.helio`) o en el globo de su decoración (`ParteGlobo.helio`)? */
export const llevaHelio = (pieza: Pieza): boolean => pieza.helio === true || (pieza.tipo === "decoracion" && JSON.stringify(pieza.decoracion).includes('"helio":true'));

/** El nombre con que se distingue en la biblioteca el que flota del de aire: «R-12 Fashion Arena» / «R-12 Fashion Arena con helio». */
export const nombreConHelio = (pieza: Pieza | undefined, nombre: string): string => (pieza && llevaHelio(pieza) && !/helio/i.test(nombre) ? `${nombre} con helio` : nombre);

/** Las decoraciones de un globo con algo encima (cara, tallo, lunares) o dentro de otro: las que pueden ir en un ramo de helio. */
const DECORACIONES_QUE_FLOTAN: ReadonlySet<string> = new Set(["figura", "calabaza", "calabaza_bruja", "burbuja"]);

/** ¿Es una pieza que puede flotar con helio y que no lo es ya por su parte (como el ramo de helio)? */
export function puedeFlotar(pieza: Pieza): boolean {
  switch (pieza.tipo) {
    case "globo": case "modulo": return formatoFlota(pieza.formatoId);
    // Un solo nivel (un cuarteto que flota): una columna de verdad no se llena con helio.
    case "columna": return formatoFlota(pieza.formatoId) && pieza.alturaCm <= pieza.infladoCm * 1.5;
    case "decoracion": return DECORACIONES_QUE_FLOTAN.has(pieza.decoracion.tipo);
    default: return false;
  }
}

/**
 * ¿Sale la casilla «Flota con helio»? En lo que puede flotar y en lo que ya está marcado: una pieza marcada que después cambia
 * de tipo, de formato o de tamaño y ya no podría flotar sigue contando sus litros, así que su casilla tiene que seguir a la vista
 * para poder desmarcarla (nunca cuenta helio una pieza cuya casilla no se ve).
 */
export const muestraMarcaHelio = (pieza: Pieza): boolean => pieza.helio === true || puedeFlotar(pieza);

/** ¿Es de helio este globo de la escena? Lo dice su parte («helio» o «ramo») o su marca `helio`, y su formato tiene que flotar. */
export function esGloboDeHelio(globo: { formatoId: string; parte?: string; helio?: true }): boolean {
  return (globo.helio === true || (globo.parte !== undefined && PARTES_HELIO.has(globo.parte))) && formatoFlota(globo.formatoId);
}

/** Litros de un globo esférico: volumen de la esfera del diámetro inflado (cm → L). */
export function litrosDeEsfera(diametroCm: number): number {
  const radio = diametroCm / 2;
  return ((4 / 3) * Math.PI * radio ** 3) / 1000;
}

/** Litros que hacen falta para `cantidad` globos de `diametroCm`, con la pérdida, redondeados a 0,1 L. */
export function litrosDeHelio(diametroCm: number, cantidad: number, perdida: number = PERDIDA_HELIO): number {
  return Math.round(litrosDeEsfera(diametroCm) * cantidad * (1 + perdida) * 10) / 10;
}

/**
 * Metros de cinta que pone una pieza entera, si lo dice: el techo suma `cintaCm` de cada globo de helio; el ramo de helio
 * pone su alto por globo. `undefined` si la pieza no lo dice (se usa la cinta por defecto).
 */
export function metrosCintaDePieza(pieza: Pieza | undefined, cantidadHelio: number): number | undefined {
  if (!pieza) return undefined;
  if (pieza.tipo === "techo") {
    const metros = pieza.techo.elementos.reduce((suma, e) => (e.tipo === "helio" ? suma + (e.puntos.length * e.cintaCm) / 100 : suma), 0);
    return metros > 0 ? metros : undefined;
  }
  if (pieza.tipo === "decoracion" && pieza.decoracion.tipo === "ramo_helio") return (cantidadHelio * pieza.decoracion.propiedades.alturaCm) / 100;
  return undefined;
}

export type GloboParaHelio = { formatoId: string; infladoCm: number; parte?: string; helio?: true };
/** Un trozo de la escena (una pieza armada): sus globos y, si los dice, sus metros de cinta. */
export type GrupoHelio = { globos: ReadonlyArray<GloboParaHelio>; metrosCinta?: number };

export type FilaHelio = { formatoId: string; infladoCm: number; cantidad: number; litros: number };
export type ResumenHelio = { filas: FilaHelio[]; globos: number; litros: number; tanques: number; metrosCinta: number };

const redondear1 = (n: number) => Math.round(n * 10) / 10;

/** El resumen de helio de la escena (`null` si no hay ningún globo de helio: la sección no se muestra). */
export function resumenHelio(grupos: ReadonlyArray<GrupoHelio>): ResumenHelio | null {
  const porTamano = new Map<string, FilaHelio>();
  let globos = 0, metros = 0;
  for (const grupo of grupos) {
    const helio = grupo.globos.filter(esGloboDeHelio);
    if (!helio.length) continue;
    globos += helio.length;
    metros += grupo.metrosCinta ?? helio.length * METROS_CINTA_POR_GLOBO;
    for (const g of helio) {
      const infladoCm = redondear1(g.infladoCm);
      const clave = `${g.formatoId}|${infladoCm}`;
      const fila = porTamano.get(clave);
      if (fila) fila.cantidad += 1;
      else porTamano.set(clave, { formatoId: g.formatoId, infladoCm, cantidad: 1, litros: 0 });
    }
  }
  if (!globos) return null;
  const filas = [...porTamano.values()]
    .sort((a, b) => a.formatoId.localeCompare(b.formatoId) || a.infladoCm - b.infladoCm)
    .map((f) => ({ ...f, litros: litrosDeHelio(f.infladoCm, f.cantidad) }));
  const litros = redondear1(filas.reduce((suma, f) => suma + f.litros, 0));
  return { filas, globos, litros, tanques: Math.ceil(litros / LITROS_POR_TANQUE), metrosCinta: redondear1(metros) };
}

/** Cuántas piezas de globo metalizado (foil) lleva la escena, contando sus copias (una pieza repetida en varias anclas). */
export function contarMetalizados(nodos: ReadonlyArray<{ id: string; pieza: Pieza }>, porNodo: ReadonlyArray<{ id: string; copias: number }>): number {
  return nodos.filter((n) => n.pieza.tipo === "metalizado").reduce((suma, n) => suma + (porNodo.find((x) => x.id === n.id)?.copias ?? 1), 0);
}

/** Una línea para la lista: los foil se llenan con helio y no entran en los litros (sale aunque la escena no tenga helio de látex). */
export const avisoMetalizados = (cantidad: number): string =>
  `La escena lleva ${cantidad} ${cantidad === 1 ? "pieza metalizada (foil)" : "piezas metalizadas (foil)"}: se llenan con helio (salvo las de varilla) y no entran en estos litros; pide su helio aparte.`;

/** Las líneas de helio para el texto copiado, con su aviso de estimación (vacío si no hay helio). */
export function lineasHelio(resumen: ResumenHelio | null): string[] {
  if (!resumen) return [];
  return [
    "",
    "HELIO Y CINTA (estimación)",
    ...resumen.filas.map((f) => `${f.cantidad} × ${f.formatoId} a ${textoNumero(f.infladoCm)} cm: ${textoNumero(f.litros)} L de helio con 7 % de pérdida`),
    `Total: ${textoNumero(resumen.litros)} L → ${resumen.tanques} ${resumen.tanques === 1 ? "tanque" : "tanques"} de ${textoNumero(LITROS_POR_TANQUE)} L nominales (confirmar con el proveedor)`,
    `Cinta: ${textoNumero(resumen.metrosCinta)} m (la de la pieza; 1,2 m por globo si no la dice)`,
    AVISO_ALCANCE_HELIO,
  ];
}

/**
 * Los grupos de helio de una escena armada: cada nodo con sus globos y la cinta que dice su pieza (si la dice).
 * Úsese con `resumenHelio`.
 */
export function gruposDeHelio(nodos: ReadonlyArray<{ id: string; pieza: Pieza }>, porNodo: ReadonlyArray<{ id: string; globos: ReadonlyArray<GloboParaHelio> }>): GrupoHelio[] {
  return porNodo.map((n) => {
    const pieza = nodos.find((x) => x.id === n.id)?.pieza;
    const cantidadHelio = n.globos.filter(esGloboDeHelio).length;
    return { globos: n.globos, metrosCinta: metrosCintaDePieza(pieza, cantidadHelio) };
  });
}
