import { GloboArcoSchema, OpcionesPatronArcoSchema, type ArmadoArcoV1, type FormaArco, type TamanoArco } from "@/lib/plan/armado-arco";
import type { ControlPatronArco, LimitesArco, PatronArcoAdmitido } from "@/lib/plan/opciones-armado-arco";
import { jsonEstable } from "../bouquet/borrador-armado";

/**
 * El borrador del editor de arcos (ADR-0035, paso 1): el `armado_arco` que el decorador va cambiando mientras
 * el motor lo dibuja. Puro: sin React, para poder probarlo sin montar nada.
 *
 * **Aquí no se calcula nada.** Cada función devuelve el mismo armado con UN campo cambiado y marcado como del
 * decorador; lo que ese campo provoca (cuántos globos caben, qué ancho necesita un globo R36, qué se compra)
 * lo decide el motor cuando se le pide el dibujo, y lo que corrige lo dice en español en sus avisos. Los
 * rangos y los valores por defecto de los mandos salen de `opciones` y `limites`, que el motor devuelve con
 * cada dibujo (`opciones_admitidas` y `limites_de`); lo único que el cliente sabe por sí mismo es la forma del
 * contrato `armado-arco.v1`.
 */

/** Un armado es el mismo aunque cambie quién lo firmó (`origen`): lo que cuenta es cómo se arma. */
export function mismoArmadoArco(a: ArmadoArcoV1, b: ArmadoArcoV1): boolean {
  return jsonEstable({ ...a, origen: null }) === jsonEstable({ ...b, origen: null });
}

/** Qué hace distinto a un dibujo de otro: el armado entero, sin importar el orden de sus claves. */
export function claveArmadoArco(armado: ArmadoArcoV1): string {
  return jsonEstable(armado);
}

/** Todo cambio del editor es una decisión del decorador, venga el armado de donde venga. */
function delDecorador(armado: ArmadoArcoV1): ArmadoArcoV1 {
  return armado.origen === "decorador" ? armado : { ...armado, origen: "decorador" };
}

// --- El patrón y sus mandos -------------------------------------------------------------------------

/** El valor de un mando en el armado, o el que el motor trae por defecto si el armado no lo dice. */
export function valorDeControl(armado: ArmadoArcoV1, control: Pick<ControlPatronArco, "clave" | "defecto">): number {
  const propios: Readonly<Record<string, number | undefined>> = armado.opciones;
  return propios[control.clave] ?? control.defecto;
}

/**
 * Cambia un mando del patrón. El contrato (`OpcionesPatronArcoSchema`) decide qué claves y qué valores caben en el
 * armado: un mando que no cabe deja el borrador como estaba. El motor acota además lo que se salga de su rango.
 */
export function conControl(armado: ArmadoArcoV1, clave: string, valor: number): ArmadoArcoV1 {
  const siguiente = OpcionesPatronArcoSchema.safeParse({ ...armado.opciones, [clave]: valor });
  if (!siguiente.success) return armado;
  return delDecorador({ ...armado, opciones: siguiente.data });
}

/**
 * Cuántos colores de la pieza puede usar un patrón: ninguno si la pieza lleva menos de los que el patrón pide
 * (`min_colores`). Es lo único que impide ofrecer un patrón; los demás se ofrecen y el motor responde.
 */
export function patronDisponible(patron: Pick<PatronArcoAdmitido, "min_colores">, coloresDePieza: number): boolean {
  return coloresDePieza >= patron.min_colores;
}

/**
 * Los colores de la pieza que toma un patrón al elegirlo: los primeros, en el orden de `materiales` de la pieza
 * (el primero es el principal). Los patrones de lista usan todos hasta su máximo; los de colores fijos, los que
 * piden. Qué color cumple cada papel (Centro, Pétalos…) lo decide ese orden; elegirlos uno a uno es otra tarea.
 */
export function materialesParaPatron(patron: Pick<PatronArcoAdmitido, "lista" | "min_colores" | "max_colores">, coloresDePieza: number): number[] {
  const cuantos = Math.min(coloresDePieza, patron.lista ? patron.max_colores : patron.min_colores);
  return Array.from({ length: cuantos }, (_, indice) => indice);
}

/**
 * Cambia de patrón. Sus mandos arrancan en los valores por defecto del motor (el armado no los trae: el motor
 * rellena los que falten) y toma los colores de la pieza que el patrón admite. Lo que ese cambio provoque en la
 * geometría —el arcoíris pide una banda por color— lo corrige el motor y lo dice en sus avisos.
 *
 * Las capas y las secciones se quitan: nombran POSICIONES de `materiales` y con otro patrón y otros colores esas
 * posiciones ya no son las mismas (con tres colores y una capa en la tercera, pasar a un patrón de dos dejaba una
 * capa que apuntaba a ninguna y el motor rechazaba el borrador sin que hubiera con qué arreglarlo).
 */
export function conPatron(armado: ArmadoArcoV1, patron: PatronArcoAdmitido, coloresDePieza: number): ArmadoArcoV1 {
  if (armado.patron === patron.id) return armado;
  return delDecorador({ ...armado, patron: patron.id, opciones: {}, materiales: materialesParaPatron(patron, coloresDePieza), capas: [], secciones: [] });
}

// --- Qué colores de la pieza cumplen cada papel del patrón ---------------------------------------------------

/**
 * Elige qué color de la pieza ocupa la posición `posicion` de la lista de colores del patrón (Centro, Franja 2…).
 * El índice es de `materiales` de la pieza; el motor comprueba que exista y el aviso de colores sin uso dice si
 * alguno de la pieza se queda sin globos.
 */
export function conColor(armado: ArmadoArcoV1, posicion: number, indice: number): ArmadoArcoV1 {
  if (!Number.isInteger(posicion) || posicion < 0 || posicion >= armado.materiales.length) return armado;
  if (armado.materiales[posicion] === indice) return armado;
  const materiales = armado.materiales.map((actual, lugar) => (lugar === posicion ? indice : actual));
  return delDecorador({ ...armado, materiales });
}

/** Cuántas posiciones de color admite el patrón (su lista de longitud variable), según el motor. */
export function rangoDeColores(patron: Pick<PatronArcoAdmitido, "lista" | "min_colores" | "max_colores">): { min: number; max: number } {
  return patron.lista ? { min: patron.lista.min, max: patron.lista.max } : { min: patron.min_colores, max: patron.max_colores };
}

/** Quita de las capas y las secciones lo que apunta a posiciones que ya no existen (a partir de `cuantas`). */
function sinPosicionesDesde(secuencias: ArmadoArcoV1["capas"], cuantas: number): ArmadoArcoV1["capas"] {
  return secuencias.map((secuencia) => {
    if (secuencia === null) return null;
    const quedan = secuencia.filter((posicion) => posicion < cuantas);
    return quedan.length > 0 ? quedan : null;
  });
}

/**
 * Agrega una posición de color a un patrón de lista (otra franja, otro bloque), con el primer color de la pieza
 * que el patrón todavía no usa, o el primero si ya los usa todos. Nada si el patrón ya está en su máximo.
 */
export function conColorAgregado(armado: ArmadoArcoV1, patron: Pick<PatronArcoAdmitido, "lista" | "min_colores" | "max_colores">, coloresDePieza: number): ArmadoArcoV1 {
  const { max } = rangoDeColores(patron);
  if (!patron.lista || armado.materiales.length >= max || coloresDePieza === 0) return armado;
  const libre = Array.from({ length: coloresDePieza }, (_, indice) => indice).find((indice) => !armado.materiales.includes(indice));
  return delDecorador({ ...armado, materiales: [...armado.materiales, libre ?? 0] });
}

/** Quita la última posición de color de un patrón de lista. Nada si ya está en su mínimo. */
export function conUltimoColorQuitado(armado: ArmadoArcoV1, patron: Pick<PatronArcoAdmitido, "lista" | "min_colores" | "max_colores">): ArmadoArcoV1 {
  const { min } = rangoDeColores(patron);
  if (!patron.lista || armado.materiales.length <= min) return armado;
  const materiales = armado.materiales.slice(0, -1);
  return delDecorador({ ...armado, materiales, capas: sinPosicionesDesde(armado.capas, materiales.length), secciones: sinPosicionesDesde(armado.secciones, materiales.length) });
}

// --- La forma y el tamaño ------------------------------------------------------------------------------

export function conForma(armado: ArmadoArcoV1, forma: FormaArco): ArmadoArcoV1 {
  if (armado.geometria.forma === forma) return armado;
  return delDecorador({ ...armado, geometria: { ...armado.geometria, forma } });
}

export function conAncho(armado: ArmadoArcoV1, anchoM: number): ArmadoArcoV1 {
  return delDecorador({ ...armado, geometria: { ...armado.geometria, anchoM } });
}

export function conAlto(armado: ArmadoArcoV1, altoM: number): ArmadoArcoV1 {
  return delDecorador({ ...armado, geometria: { ...armado.geometria, altoM } });
}

export function conGlobosAncho(armado: ArmadoArcoV1, globosAncho: number): ArmadoArcoV1 {
  return delDecorador({ ...armado, geometria: { ...armado.geometria, globosAncho } });
}

// --- El globo -------------------------------------------------------------------------------------------

export function conTamanoGlobo(armado: ArmadoArcoV1, nominal: TamanoArco): ArmadoArcoV1 {
  if (armado.globo.nominal === nominal) return armado;
  return delDecorador({ ...armado, globo: { ...armado.globo, nominal } });
}

export function conInflado(armado: ArmadoArcoV1, inflado: number): ArmadoArcoV1 {
  return delDecorador({ ...armado, globo: { ...armado.globo, inflado } });
}

// --- Los rangos ------------------------------------------------------------------------------------------

export type RangoControl = { min: number; max: number; paso: number };

/**
 * El inflado no lo publica `opciones_admitidas`: su rango es el del contrato `armado-arco.v1`
 * (`GloboArcoSchema`), que el propio motor usa para acotarlo. Se lee del esquema, no se vuelve a escribir aquí.
 */
export function rangoDeInflado(): RangoControl {
  const campo = GloboArcoSchema.shape.inflado;
  return { min: campo.minValue ?? 0.8, max: campo.maxValue ?? 1.1, paso: PASO_INFLADO };
}

/** Pasos de los deslizadores que el motor no publica: el motor redondea sus propios límites a décimas de metro. */
export const PASO_MEDIDA_M = 0.1;
export const PASO_INFLADO = 0.05;

/** El ancho que el motor admite con este armado puesto: sube con el tamaño del globo y con los globos a lo ancho. */
export function rangoDeAncho(limites: LimitesArco): RangoControl {
  return { min: limites.anchoMin, max: limites.anchoMax, paso: PASO_MEDIDA_M };
}

/** El alto depende de la forma de la línea guía. */
export function rangoDeAlto(limites: LimitesArco): RangoControl {
  return { min: limites.altoMin, max: limites.altoMax, paso: PASO_MEDIDA_M };
}

/** Globos a lo ancho de la banda; el arcoíris solo admite múltiplos de sus bandas (`nPaso`). */
export function rangoDeGlobosAncho(limites: LimitesArco): RangoControl {
  return { min: limites.nMin, max: limites.nMax, paso: limites.nPaso };
}

/**
 * Dónde se pinta un valor dentro de su rango. Solo presentación: el armado que se guarda y se manda al motor es
 * el que el decorador pidió, y el motor es quien lo corrige y lo dice; pero un control no puede enseñar un 3,0 m
 * si su rango ya empieza en 4,2 m, porque eso contradiría al dibujo y al aviso del motor.
 */
export function valorEnRango(valor: number, rango: Pick<RangoControl, "min" | "max">): number {
  return Math.min(Math.max(valor, rango.min), rango.max);
}
