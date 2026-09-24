import { TIPOS_ESTRUCTURA_GEOMETRICOS } from "@/lib/plan/composicion";
import type { ModoAdmitido, ModoPatronColor, PatronColor } from "@/lib/plan/patron-color";

/**
 * Lo que el editor MUESTRA de cada estilo: el nombre del oficio, una frase y
 * su icono. Qué estilos ofrece una pieza, en qué orden, con qué direcciones
 * y si admiten espejo lo dice Python (`modos_admitidos` de la vista previa,
 * ADR-0028 §10); aquí no hay ninguna regla de patrón.
 */

/** Icono de un estilo: un modo, o la espiral por su trazo y el degradé en diagonal. */
export type IdEstilo = "espiral" | "zigzag" | "recto" | "anillos" | "bloques" | "degradado" | "diagonal" | "aleatorio" | "flor" | "damero";

export type DireccionPatron = NonNullable<PatronColor["direccion"]>;

export const ESTILOS_MODO: Readonly<Record<ModoPatronColor, { nombre: string; ayuda: string }>> = {
  espiral: { nombre: "Espiral", ayuda: "Racimos iguales que giran" },
  anillos: { nombre: "Anillos", ayuda: "Salvavidas de un color" },
  bloques: { nombre: "Bloques", ayuda: "Tramos de color" },
  degradado: { nombre: "Degradé", ayuda: "De un color a otro" },
  aleatorio: { nombre: "Confeti", ayuda: "Mezcla orgánica" },
  flor: { nombre: "Flores", ayuda: "Margaritas entre racimos" },
  damero: { nombre: "Damero", ayuda: "Cuadros alternos" },
};

export const ETIQUETA_DIRECCION: Readonly<Record<DireccionPatron, string>> = {
  longitudinal: "Por filas",
  transversal: "Por columnas",
  diagonal: "En diagonal",
};

/** Icono de un patrón: la espiral por su trazo, el degradé diagonal aparte. Solo dibujo. */
export function estiloDe(patron: PatronColor): IdEstilo {
  const base = patron.base;
  if (base.modo === "espiral") return base.trazo === "espiral" ? "espiral" : base.trazo;
  if (base.modo === "degradado" && patron.direccion === "diagonal") return "diagonal";
  return base.modo;
}

/** Icono de la ficha de un modo: la del borrador cuando es de ese modo (así se ve su trazo), si no la del modo. */
export function iconoDeModo(modo: ModoPatronColor, borrador: PatronColor | null): IdEstilo {
  return borrador?.base.modo === modo ? estiloDe(borrador) : modo;
}

/**
 * Controles que Python admite para el modo del borrador: la dirección solo
 * cuando hay más de una para elegir, y el espejo cuando Python lo ofrece.
 * Sin la respuesta de Python (`modos` nulo) o para un modo que no admite, ninguno.
 */
export function controlesDeModo(modos: readonly ModoAdmitido[] | null, modo: ModoPatronColor): { direcciones: readonly DireccionPatron[]; espejo: boolean } {
  const admitido = modos?.find((entrada) => entrada.modo === modo);
  return { direcciones: admitido && admitido.direcciones.length > 1 ? admitido.direcciones : [], espejo: admitido?.espejo ?? false };
}

const GEOMETRICOS: ReadonlySet<string> = new Set(TIPOS_ESTRUCTURA_GEOMETRICOS);

/**
 * Si la tarjeta ofrece "Crear patrón": una pieza geométrica con dos colores o
 * más. Es solo la puerta de la interfaz; qué estilos se arman y si se arman
 * lo contesta Python al abrir el editor.
 */
export function admitePatron(tipo: string, materiales: number): boolean {
  return GEOMETRICOS.has(tipo) && materiales >= 2;
}
