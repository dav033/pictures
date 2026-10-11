import type { LineaTamano, TramoColor } from "./hoja-armado-comun";

/** Los textos de la hoja que se prueban aparte de las pantallas. */

/** «3» para un globo; «3–4» para varios seguidos desde el 3. */
export const textoRango = (desde: number, cantidad: number): string => (cantidad <= 1 ? `${desde}` : `${desde}–${desde + cantidad - 1}`);

/** Cuánto gira cada capa respecto a la de abajo, vista desde arriba (positivo es el sentido de las agujas del reloj). */
export function textoGiro(grados: number): string {
  if (grados === 0) return "Cada capa queda justo encima de la de abajo, sin girar.";
  const lado = grados > 0 ? "a la derecha (sentido horario)" : "a la izquierda (sentido antihorario)";
  return `Cada capa gira ${Math.abs(grados)}° ${lado} respecto a la de abajo.`;
}

/** «1–2 Rojo · 3–4 Blanco»: el orden de color de una capa o de un cuarteto. */
export const textoSecuencia = (secuencia: readonly TramoColor[]): string => secuencia.map((t) => `${textoRango(t.desde, t.veces)} ${t.nombreColor}`).join(" · ");

/** Hasta cuántos nombres de piezas se escriben en una fila de la tabla compacta. */
const MAX_NOMBRES = 3;

/**
 * «Moño morado; Moño rojo; Moño azul y 4 más»: los nombres de las piezas de una fila. Se cortan porque una fila junta solo piezas
 * que llevan exactamente lo mismo (con su helio, su impreso, su confeti y sus partes: ver `sumarFilaCompacta`); una escena tiene
 * filas de 88 piezas iguales con nombres de sitio («pareja de fuera 1a, 1b…») que no cambian nada al armar.
 */
export const textoNombres = (nombres: readonly string[]): string =>
  nombres.length <= MAX_NOMBRES ? nombres.join("; ") : `${nombres.slice(0, MAX_NOMBRES).join("; ")} y ${nombres.length - MAX_NOMBRES} más`;

/** «3 × R-12 a 25 cm» o, de muchos tamaños, «40 × R-12 de 21 a 29 cm». */
export const textoTamano = (t: LineaTamano): string => `${t.cantidad} × ${t.formatoId} ${t.hastaCm > t.infladoCm ? `de ${t.infladoCm} a ${t.hastaCm} cm` : `a ${t.infladoCm} cm`}`;
