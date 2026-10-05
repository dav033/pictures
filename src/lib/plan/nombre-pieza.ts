import type { EstructuraOficialId } from "./estructuras-oficiales";

/**
 * Cómo se nombra una pieza en los textos de su editor: «Editar semiarco», «Armado de la columna», «Guardar
 * pared». Es el sustantivo común de la pieza (no su nombre oficial completo, que va en la etiqueta y en el
 * encabezado de la tarjeta: «Semiarco orgánico», «Pared de globos densa») y su género, que decide el artículo.
 *
 * Existe porque los bloques de los motores decían «Armado del arco» y «Editar arco» también sobre un semiarco
 * —el arco orgánico arma las dos piezas—, y el decorador leía que estaba editando otra cosa.
 *
 * Puro: sin React, sin proveedor ni HTTP.
 */
export type NombrePieza = {
  /** En minúscula y en singular: «arco», «semiarco», «centro de mesa». */
  sustantivo: string;
  genero: "m" | "f";
};

const ARCO: NombrePieza = { sustantivo: "arco", genero: "m" };
const SEMIARCO: NombrePieza = { sustantivo: "semiarco", genero: "m" };
const COLUMNA: NombrePieza = { sustantivo: "columna", genero: "f" };
const PARED: NombrePieza = { sustantivo: "pared", genero: "f" };
const GUIRNALDA: NombrePieza = { sustantivo: "guirnalda", genero: "f" };
const CENTRO_MESA: NombrePieza = { sustantivo: "centro de mesa", genero: "m" };
const PIEZA: NombrePieza = { sustantivo: "pieza", genero: "f" };

const POR_OFICIAL: Readonly<Record<EstructuraOficialId, NombrePieza>> = {
  arco: ARCO,
  arco_asimetrico: ARCO,
  arco_no_denso: ARCO,
  semiarco: SEMIARCO,
  semiarco_asimetrico: SEMIARCO,
  columna: COLUMNA,
  columna_asimetrica: COLUMNA,
  columna_no_densa: COLUMNA,
  pared_densa: PARED,
  pared_no_densa: PARED,
  pared_organica: PARED,
  guirnalda: GUIRNALDA,
  centro_mesa: CENTRO_MESA,
  bouquet: { sustantivo: "bouquet", genero: "m" },
  figura: { sustantivo: "figura", genero: "f" },
  aro_circular: { sustantivo: "aro", genero: "m" },
  techo_globos: { sustantivo: "techo", genero: "m" },
};

/** Respaldo por `tipo` para una pieza sin estructura oficial (un plan viejo o una pieza libre). */
const POR_TIPO: Readonly<Record<string, NombrePieza>> = {
  arco: ARCO,
  semiarco: SEMIARCO,
  columna: COLUMNA,
  pared: PARED,
  guirnalda: GUIRNALDA,
  centro_mesa: CENTRO_MESA,
};

/** El nombre de la pieza por su estructura oficial y, si no la trae, por su tipo; «pieza» si no se sabe. */
export function nombreDePieza(oficialId: string | null | undefined, tipo?: string | null): NombrePieza {
  const oficial = oficialId ? POR_OFICIAL[oficialId as EstructuraOficialId] : undefined;
  return oficial ?? (tipo ? POR_TIPO[tipo] : undefined) ?? PIEZA;
}

/** El nombre por defecto de los bloques del arco: el de siempre, para no cambiar una tarjeta que no lo pasa. */
export const NOMBRE_ARCO: NombrePieza = ARCO;

/** «Editar semiarco». */
export function textoEditar(nombre: NombrePieza): string {
  return `Editar ${nombre.sustantivo}`;
}

/** «Guardar semiarco». */
export function textoGuardar(nombre: NombrePieza): string {
  return `Guardar ${nombre.sustantivo}`;
}

/** «del semiarco» / «de la columna». */
export function delaPieza(nombre: NombrePieza): string {
  return `${nombre.genero === "m" ? "del" : "de la"} ${nombre.sustantivo}`;
}

/** «Armado del semiarco» / «Armado de la pared». */
export function textoArmado(nombre: NombrePieza): string {
  return `Armado ${delaPieza(nombre)}`;
}

/** «este semiarco» / «esta columna». */
export function estaPieza(nombre: NombrePieza): string {
  return `${nombre.genero === "m" ? "este" : "esta"} ${nombre.sustantivo}`;
}
