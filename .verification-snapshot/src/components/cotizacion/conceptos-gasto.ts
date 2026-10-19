import type { FilaCosto } from "@/lib/cotizacion/borrador-profesional";
import { leerCantidad } from "@/lib/cotizacion/lectura-numeros";
import { MAX_CANTIDAD, type SeccionCosto } from "@/lib/cotizacion/profesional";

/**
 * Ayudas de escritura de las listas de gastos del precio al cliente: conceptos
 * típicos para no empezar en blanco, el ejemplo de valor de cada lista y el
 * paso del − / + de la cantidad. Solo cambian el TEXTO de los campos: ningún
 * importe se calcula aquí (Python suma y multiplica). Sin React.
 */

/** Conceptos que un decorador suele cobrar en cada lista; un toque escribe la descripción. */
export const CONCEPTOS_GASTO: Readonly<Record<SeccionCosto, readonly string[]>> = {
  mano_de_obra: ["Montaje", "Ayudante", "Mis horas", "Desmontaje", "Diseño"],
  equipos_transporte: ["Transporte", "Alquiler de base", "Estructura", "Tanque de helio", "Peajes y parqueo"],
  indirectos: ["Publicidad", "Papelería", "Imprevistos", "Herramientas"],
};

/** Ejemplo de valor por unidad de cada lista (solo el texto gris del campo vacío; nunca se envía). */
export const EJEMPLO_VALOR: Readonly<Record<SeccionCosto, string>> = {
  mano_de_obra: "80.000",
  equipos_transporte: "50.000",
  indirectos: "20.000",
};

/** Qué se le propone a quien abre una lista vacía. */
export const INVITACION_LISTA: Readonly<Record<SeccionCosto, string>> = {
  mano_de_obra: "¿Cobras tu trabajo o pagas ayudantes? Toca uno para sumarlo.",
  equipos_transporte: "¿Llevas el montaje o alquilas algo? Toca uno para sumarlo.",
  indirectos: "¿Quieres cubrir una parte de tus gastos fijos? Toca uno para sumarlo.",
};

const normalizar = (texto: string) => texto.trim().toLocaleLowerCase("es");

/** Los conceptos de la lista que todavía no están escritos en ninguna fila (para no ofrecer dos veces «Montaje»). */
export function conceptosLibres(seccion: SeccionCosto, filas: readonly FilaCosto[]): string[] {
  const usados = new Set(filas.map((fila) => normalizar(fila.descripcion)));
  return CONCEPTOS_GASTO[seccion].filter((concepto) => !usados.has(normalizar(concepto)));
}

/** La cantidad que muestra el − / +: lo escrito si se lee; en blanco cuenta como 1 (lo que se ve en gris); ilegible, `null`. */
function cantidadMostrada(texto: string): number | null {
  if (!texto.trim()) return 1;
  return leerCantidad(texto);
}

/** Cómo se escribe una cantidad: con coma decimal y sin separador de miles («1,5», «12»), que es lo que `leerCantidad` lee. */
function escribirCantidad(valor: number): string {
  return String(Math.round(valor * 100) / 100).replace(".", ",");
}

/**
 * Lo que queda escrito tras tocar − o +, o `null` si ese botón no hace nada
 * (no baja de lo que se puede vender: una cantidad sigue siendo mayor que 0;
 * no pasa del tope de Python). Con algo ilegible, + vuelve a empezar en 1.
 */
export function pasoCantidad(texto: string, sentido: 1 | -1): string | null {
  const actual = cantidadMostrada(texto);
  if (actual === null) return sentido > 0 ? "1" : null;
  const siguiente = Math.round((actual + sentido) * 100) / 100;
  if (siguiente <= 0 || siguiente > MAX_CANTIDAD) return null;
  return escribirCantidad(siguiente);
}

/**
 * Al empezar a escribir una fila sin cantidad, la cantidad pasa a 1: casi todo
 * gasto es «uno» (un transporte, un montaje) y así una fila no queda a medias
 * por un campo que nadie miró. Solo toca filas con la cantidad en blanco.
 */
export function cambiosConCantidad(fila: FilaCosto, cambios: Partial<FilaCosto>): Partial<FilaCosto> {
  if (fila.cantidad.trim() || "cantidad" in cambios) return cambios;
  const escribe = (cambios.descripcion ?? "").trim() !== "" || (cambios.costo ?? "").trim() !== "";
  return escribe ? { ...cambios, cantidad: "1" } : cambios;
}

/** Lo que le falta a una fila empezada, en dos palabras, para decirlo donde irá su total. */
export function faltaEnFila(errores: { descripcion?: string; costo?: string; cantidad?: string }, fila: FilaCosto): string | null {
  if (errores.costo) return fila.costo.trim() ? "Revisa el valor" : "Falta el valor";
  if (errores.cantidad) return fila.cantidad.trim() ? "Revisa la cantidad" : "Falta la cantidad";
  if (errores.descripcion) return "Falta qué es";
  return null;
}
