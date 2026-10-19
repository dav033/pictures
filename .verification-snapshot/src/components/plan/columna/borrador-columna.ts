import { ArmadoColumnaV1Schema, type ArmadoColumnaV1, type RemateColumna, type TamanoColumna } from "@/lib/plan/armado-columna";
import type { ControlPatronColumna, LimitesColumna, PatronColumnaAdmitido } from "@/lib/plan/opciones-armado-columna";
import { jsonEstable } from "../bouquet/borrador-armado";

/**
 * El borrador del editor de columnas (ADR-0035, paso 3): el `armado_columna` que el decorador va cambiando mientras
 * el motor lo dibuja. Puro: sin React, para poder probarlo sin montar nada.
 *
 * **Aquí no se calcula nada.** Cada función devuelve el mismo armado con UN campo cambiado y marcado como del
 * decorador; lo que ese campo provoca (cuántas capas caben, qué tan ancha queda la columna, qué remate guarda
 * proporción) lo decide el motor cuando se le pide el dibujo, y lo que corrige lo dice en español en sus avisos. Los
 * rangos y los valores por defecto de los mandos salen de `opciones` y `limites`, que el motor devuelve con cada
 * dibujo (`opciones_admitidas` y `limites_de`); lo único que el cliente sabe por sí mismo es la forma del contrato
 * `armado-columna.v1`.
 */

/** Un armado es el mismo aunque cambie quién lo firmó (`origen`): lo que cuenta es cómo se arma. */
export function mismoArmadoColumna(a: ArmadoColumnaV1, b: ArmadoColumnaV1): boolean {
  return jsonEstable({ ...a, origen: null }) === jsonEstable({ ...b, origen: null });
}

/** Qué hace distinto a un dibujo de otro: el armado entero, sin importar el orden de sus claves. */
export function claveArmadoColumna(armado: ArmadoColumnaV1): string {
  return jsonEstable(armado);
}

/** Todo cambio del editor es una decisión del decorador, venga el armado de donde venga. */
function delDecorador(armado: ArmadoColumnaV1): ArmadoColumnaV1 {
  return armado.origen === "decorador" ? armado : { ...armado, origen: "decorador" };
}

// --- El patrón y sus mandos -------------------------------------------------------------------------

/** El valor de un mando en el armado, o el que el motor trae por defecto si el armado no lo dice. */
export function valorDeControl(armado: ArmadoColumnaV1, control: Pick<ControlPatronColumna, "clave" | "defecto">): number {
  const propios: Readonly<Record<string, number | undefined>> = armado.opciones;
  return propios[control.clave] ?? control.defecto;
}

/**
 * Cambia un mando del patrón. El contrato decide qué claves y qué valores caben en el armado: un mando que no cabe
 * deja el borrador como estaba. El motor acota además lo que se salga de su rango.
 */
export function conControl(armado: ArmadoColumnaV1, clave: string, valor: number): ArmadoColumnaV1 {
  const siguiente = ArmadoColumnaV1Schema.shape.opciones.safeParse({ ...armado.opciones, [clave]: valor });
  if (!siguiente.success) return armado;
  return delDecorador({ ...armado, opciones: siguiente.data });
}

/** Un patrón se puede elegir si la pieza lleva al menos los colores que pide (`min_colores`). */
export function patronDisponible(patron: Pick<PatronColumnaAdmitido, "min_colores">, coloresDePieza: number): boolean {
  return coloresDePieza >= patron.min_colores;
}

/** Cuántos colores nombra a lo sumo un armado de columna (`materiales` del contrato). */
export const MAX_COLORES_COLUMNA = 8;

/**
 * Los colores de la pieza que toma un patrón al elegirlo: los primeros, en el orden de `materiales` de la pieza
 * (el primero es el principal). El sólido usa uno; los demás, todos los de la pieza hasta el tope del contrato, que es
 * como los reparte el motor. Elegir uno a uno qué color va en cada lugar es otra tarea.
 */
export function materialesParaPatron(patron: Pick<PatronColumnaAdmitido, "id" | "min_colores">, coloresDePieza: number): number[] {
  const cuantos = patron.id === "solido" ? 1 : Math.min(coloresDePieza, MAX_COLORES_COLUMNA);
  return Array.from({ length: Math.max(cuantos, Math.min(patron.min_colores, coloresDePieza)) }, (_, indice) => indice);
}

/**
 * Cambia de patrón. Sus mandos arrancan en los valores por defecto del motor (el armado no los trae: el motor
 * rellena los que falten) y toma los colores de la pieza que el patrón admite. Pasar a un patrón desde un armado por
 * capas lo devuelve a «por altura»: en el modo por capas la lista de capas es el diseño y el patrón no decide nada.
 */
export function conPatron(armado: ArmadoColumnaV1, patron: PatronColumnaAdmitido, coloresDePieza: number): ArmadoColumnaV1 {
  if (armado.patron === patron.id && armado.modo === "altura") return armado;
  return delDecorador({ ...armado, modo: "altura", patron: patron.id, opciones: {}, materiales: materialesParaPatron(patron, coloresDePieza), capas: [] });
}

/** Pasa de «por capas» a «por altura»: se pierde la lista de capas y el patrón vuelve a decidir el color y el tamaño. */
export function conModoAltura(armado: ArmadoColumnaV1): ArmadoColumnaV1 {
  if (armado.modo === "altura") return armado;
  return delDecorador({ ...armado, modo: "altura", capas: [] });
}

// --- Qué colores de la pieza cumplen cada lugar del patrón ----------------------------------------------------

/** Elige qué color de la pieza ocupa la posición `posicion` de la lista de colores del patrón (Color 1, Color 2…). */
export function conColor(armado: ArmadoColumnaV1, posicion: number, indice: number): ArmadoColumnaV1 {
  if (!Number.isInteger(posicion) || posicion < 0 || posicion >= armado.materiales.length) return armado;
  if (armado.materiales[posicion] === indice) return armado;
  return delDecorador({ ...armado, materiales: armado.materiales.map((actual, lugar) => (lugar === posicion ? indice : actual)) });
}

/** Cuántas posiciones de color admite el patrón: desde los que pide hasta el tope del contrato; el sólido, una. */
export function rangoDeColores(patron: Pick<PatronColumnaAdmitido, "id" | "min_colores">): { min: number; max: number } {
  return patron.id === "solido" ? { min: 1, max: 1 } : { min: patron.min_colores, max: MAX_COLORES_COLUMNA };
}

/** Agrega una posición de color, con el primer color de la pieza que el armado todavía no usa (o el primero). */
export function conColorAgregado(armado: ArmadoColumnaV1, patron: Pick<PatronColumnaAdmitido, "id" | "min_colores">, coloresDePieza: number): ArmadoColumnaV1 {
  const { max } = rangoDeColores(patron);
  if (armado.materiales.length >= max || coloresDePieza === 0) return armado;
  const libre = Array.from({ length: coloresDePieza }, (_, indice) => indice).find((indice) => !armado.materiales.includes(indice));
  return delDecorador({ ...armado, materiales: [...armado.materiales, libre ?? 0] });
}

/** Quita la última posición de color. Nada si ya está en el mínimo del patrón. */
export function conUltimoColorQuitado(armado: ArmadoColumnaV1, patron: Pick<PatronColumnaAdmitido, "id" | "min_colores">): ArmadoColumnaV1 {
  const { min } = rangoDeColores(patron);
  if (armado.materiales.length <= min) return armado;
  return delDecorador({ ...armado, materiales: armado.materiales.slice(0, -1) });
}

// --- El cuerpo: alto, globos por capa, tamaños, escalonado y base --------------------------------------------

export function conAlto(armado: ArmadoColumnaV1, altoM: number): ArmadoColumnaV1 {
  return delDecorador({ ...armado, cuerpo: { ...armado.cuerpo, alto_m: altoM } });
}

export function conGlobosCapa(armado: ArmadoColumnaV1, globosCapa: number): ArmadoColumnaV1 {
  if (armado.cuerpo.globos_capa === globosCapa) return armado;
  return delDecorador({ ...armado, cuerpo: { ...armado.cuerpo, globos_capa: globosCapa } });
}

export function conTamanoAbajo(armado: ArmadoColumnaV1, tamano: TamanoColumna): ArmadoColumnaV1 {
  if (armado.cuerpo.abajo === tamano) return armado;
  return delDecorador({ ...armado, cuerpo: { ...armado.cuerpo, abajo: tamano } });
}

export function conTamanoArriba(armado: ArmadoColumnaV1, tamano: TamanoColumna): ArmadoColumnaV1 {
  if (armado.cuerpo.arriba === tamano) return armado;
  return delDecorador({ ...armado, cuerpo: { ...armado.cuerpo, arriba: tamano } });
}

export function conEscalonado(armado: ArmadoColumnaV1, escalonado: boolean): ArmadoColumnaV1 {
  if (armado.cuerpo.escalonado === escalonado) return armado;
  return delDecorador({ ...armado, cuerpo: { ...armado.cuerpo, escalonado } });
}

export function conBase(armado: ArmadoColumnaV1, base: boolean): ArmadoColumnaV1 {
  if (armado.cuerpo.base === base) return armado;
  return delDecorador({ ...armado, cuerpo: { ...armado.cuerpo, base } });
}

// --- El remate ---------------------------------------------------------------------------------------------

export function conRemateTipo(armado: ArmadoColumnaV1, tipo: RemateColumna): ArmadoColumnaV1 {
  if (armado.remate.tipo === tipo) return armado;
  return delDecorador({ ...armado, remate: { ...armado.remate, tipo } });
}

/**
 * Pone o quita el globo grande de la punta (el remate de un solo globo): encendido es `globo`, apagado es `ninguno`.
 * Si la columna llevaba otro remate (racimo, estrella, corazón), encenderlo lo reemplaza. El tamaño del globo es el
 * que ya tenía el remate; si no guarda proporción con la columna, el motor lo ajusta y lo dice en sus avisos.
 */
export function conGloboGrande(armado: ArmadoColumnaV1, activo: boolean): ArmadoColumnaV1 {
  return conRemateTipo(armado, activo ? "globo" : "ninguno");
}

export function conRemateTamano(armado: ArmadoColumnaV1, tamano: TamanoColumna): ArmadoColumnaV1 {
  if (armado.remate.tamano === tamano) return armado;
  return delDecorador({ ...armado, remate: { ...armado.remate, tamano } });
}

export function conRemateCantidad(armado: ArmadoColumnaV1, cantidad: number): ArmadoColumnaV1 {
  return delDecorador({ ...armado, remate: { ...armado.remate, cantidad } });
}

export function conRemateFoil(armado: ArmadoColumnaV1, foilM: number): ArmadoColumnaV1 {
  return delDecorador({ ...armado, remate: { ...armado.remate, foil_m: foilM } });
}

/** El color del remate es un material de la pieza, por índice. */
export function conRemateColor(armado: ArmadoColumnaV1, indice: number): ArmadoColumnaV1 {
  if (armado.remate.material === indice) return armado;
  return delDecorador({ ...armado, remate: { ...armado.remate, material: indice } });
}

/**
 * Qué tamaños caben como remate con este armado puesto: un globo grande o un racimo guarda proporción con el
 * diámetro de la columna, y eso lo sabe el motor (`limites.rematesGlobo` y `rematesRacimo`).
 */
export function tamanosDeRemate(limites: Pick<LimitesColumna, "rematesGlobo" | "rematesRacimo">, tipo: RemateColumna): readonly number[] {
  return tipo === "globo" ? limites.rematesGlobo : tipo === "racimo" ? limites.rematesRacimo : [];
}

// --- Cómo se infla ----------------------------------------------------------------------------------------

export type CampoInflado = keyof ArmadoColumnaV1["inflado"];

export function conInfladoCampo(armado: ArmadoColumnaV1, campo: CampoInflado, valor: number): ArmadoColumnaV1 {
  return delDecorador({ ...armado, inflado: { ...armado.inflado, [campo]: valor } });
}

/** Otra variación de la misma columna: la semilla sigue; el motor es determinista, así que la misma semilla da la misma. */
export function conOtraVariacion(armado: ArmadoColumnaV1): ArmadoColumnaV1 {
  const semilla = armado.inflado.semilla >= 99999 ? 1 : armado.inflado.semilla + 1;
  return conInfladoCampo(armado, "semilla", semilla);
}

// --- Los rangos --------------------------------------------------------------------------------------------

export type RangoControl = { min: number; max: number; paso: number };

/**
 * El rango de un campo numérico de `inflado` lo publica el contrato `armado-columna.v1` (el propio motor lo usa para
 * acotarlo), no `opciones_admitidas`: se lee del esquema y no se vuelve a escribir aquí.
 */
export function rangoDeInflado(campo: Exclude<CampoInflado, "semilla">, paso: number): RangoControl {
  const numero = ArmadoColumnaV1Schema.shape.inflado.shape[campo];
  return { min: numero.minValue ?? 0, max: numero.maxValue ?? 1, paso };
}

/** Pasos de los deslizadores que el motor no publica. */
export const PASO_ALTO_M = 0.1;
export const PASO_FOIL_M = 0.1;

/** El alto que el motor admite con este armado puesto: sube con el tamaño del globo y con los globos por capa. */
export function rangoDeAlto(limites: LimitesColumna): RangoControl {
  return { min: limites.altoMin, max: limites.altoMax, paso: PASO_ALTO_M };
}

/** El alto de la estrella o del corazón de foil, con lo que cabe sobre esta columna. */
export function rangoDeFoil(limites: LimitesColumna): RangoControl {
  return { min: limites.foilMin, max: limites.foilMax, paso: PASO_FOIL_M };
}

/** Los mandos de un patrón van de uno en uno salvo los que el motor mide en fracciones. */
const PASO_DEL_MANDO: Readonly<Record<string, number>> = { inclinacion: 0.1, amplitud: 0.1, grueso: 0.05, suavidad: 0.05 };

export function pasoDeMando(control: Pick<ControlPatronColumna, "clave">): number {
  return PASO_DEL_MANDO[control.clave] ?? 1;
}

/**
 * Dónde se pinta un valor dentro de su rango. Solo presentación: el armado que se guarda y se manda al motor es el que
 * el decorador pidió y el motor es quien lo corrige y lo dice; pero un control no puede enseñar un 0,5 m si su rango
 * ya empieza en 1,2 m, porque eso contradiría al dibujo y al aviso del motor.
 */
export function valorEnRango(valor: number, rango: Pick<RangoControl, "min" | "max">): number {
  return Math.min(Math.max(valor, rango.min), rango.max);
}
