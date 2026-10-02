import { MAX_LINEAS_SECCION } from "./profesional";

/**
 * Cuántas filas admite cada lista de gastos y qué se le dice a quien cotiza
 * al acercarse al tope. El tope (`MAX_LINEAS_SECCION`) es el del modelo de
 * Python: aquí solo se explica, nunca se cambia, y nunca se calcula con menos
 * filas de las que se ven sin decirlo. Sin React.
 */

/** Desde aquí se muestra «n de 50»: el 80 % del tope. */
export const FILAS_PARA_AVISAR = Math.ceil(MAX_LINEAS_SECCION * 0.8);

export type EstadoFilas = {
  /** Filas que se ven. */
  cantidad: number;
  maximo: number;
  /** No cabe otra: el botón de agregar va deshabilitado. */
  llena: boolean;
  /** Cuántas sobran sobre el tope (solo pasa con un borrador guardado de antes). */
  sobran: number;
  /** «42 de 50 gastos», o `null` mientras sobra espacio. */
  contador: string | null;
  /** Por qué no se puede agregar otra; `null` mientras se puede. */
  motivoSinAgregar: string | null;
  /** Lo que impide calcular cuando hay más filas que el tope; `null` si no. */
  avisoDeExceso: string | null;
};

export function estadoFilas(cantidad: number, maximo: number = MAX_LINEAS_SECCION): EstadoFilas {
  const sobran = Math.max(0, cantidad - maximo);
  const llena = cantidad >= maximo;
  return {
    cantidad,
    maximo,
    llena,
    sobran,
    contador: cantidad >= FILAS_PARA_AVISAR ? `${cantidad} de ${maximo} gastos` : null,
    motivoSinAgregar: llena ? `Llegaste al máximo de ${maximo} gastos en esta lista.` : null,
    avisoDeExceso: sobran > 0
      ? `Tienes ${cantidad} gastos y el máximo es ${maximo}: quita ${sobran} para ver el precio.`
      : null,
  };
}
