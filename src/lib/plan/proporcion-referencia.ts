/**
 * Contraste entre la proporción de color que la foto TIENE y la que el plan
 * DECLARA.
 *
 * Hasta la fase 2.1 esto no se podía ni plantear: la paleta de una foto era una
 * lista sin orden, así que no había un número contra el que comparar
 * `participacion`. Con la dominancia medida sí lo hay, y resulta que nadie los
 * compara: un plan puede declarar 70 % dorado y 30 % rojo sobre una foto que es
 * 70 % roja y el sistema lo acepta sin decir nada.
 *
 * SE REPORTA, NO SE IMPONE. El plan es lo que se construye y se cobra; que un
 * decorador decida invertir la proporción de la foto es una decisión legítima.
 * Lo que no es legítimo es que nadie se entere. Convertir esto en una
 * restricción exige antes los datos que solo produce dejarlo correr como aviso,
 * que es exactamente por qué la fase 2.6 va al final de su fase y no al
 * principio.
 *
 * Puro: sin proveedor, HTTP, base de datos ni entorno.
 */

/** Participación declarada por el plan, ya agregada por color. */
export type ParticipacionDeclarada = { color: string; participacion: number };

export type DesviacionProporcion = {
  estructura_id: string;
  color: string;
  /** Fracción medida en la foto de referencia, 0..1. */
  medida: number;
  /** Fracción que el plan declara para ese color, 0..1. */
  declarada: number;
  /** `declarada - medida`. Negativo significa que el plan lleva menos de lo que la foto tiene. */
  delta: number;
};

/**
 * Desviación mínima que merece un aviso. Por debajo de 0,2 la diferencia entra
 * dentro de lo que cambia al redondear un conteo de globos a paquetes enteros,
 * y avisar de eso sería ruido que enseña a ignorar los avisos.
 */
export const DESVIACION_MINIMA = 0.2;

function normalizar(color: string): string {
  return color.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

/** Suma las participaciones del plan por color: varios materiales pueden traer el mismo. */
export function participacionPorColor(materiales: ReadonlyArray<{ color?: string; participacion?: number }>): ParticipacionDeclarada[] {
  const suma = new Map<string, number>();
  for (const material of materiales) {
    const color = material.color ? normalizar(material.color) : "";
    if (!color || !material.participacion) continue;
    suma.set(color, (suma.get(color) ?? 0) + material.participacion);
  }
  return [...suma.entries()].sort((uno, otro) => otro[1] - uno[1] || (uno[0] < otro[0] ? -1 : 1)).map(([color, participacion]) => ({ color, participacion }));
}

/**
 * Colores donde la proporción del plan se aparta de la de la foto más que
 * `DESVIACION_MINIMA`. Solo mira los colores que la foto midió: un color que el
 * plan añade y la foto no tiene ya lo reporta `sustitucionesColorReferencia`, y
 * duplicar el aviso solo lo hace más fácil de ignorar.
 *
 * `medidos` se renormaliza sobre sí mismo antes de comparar. La medida de la
 * foto reparte sobre TODOS los píxeles de la caja, incluidos los que no son de
 * ningún color del catálogo (madera, sombra), mientras que `participacion`
 * reparte sobre el 100 % de los globos. Comparar los dos sin renormalizar diría
 * que todo plan lleva de más.
 */
export function desviacionesProporcion(
  estructuraId: string,
  medidos: ReadonlyArray<{ color: string; share: number }>,
  materiales: ReadonlyArray<{ color?: string; participacion?: number }>,
): DesviacionProporcion[] {
  const total = medidos.reduce((suma, entrada) => suma + entrada.share, 0);
  if (total <= 0) return [];
  const declarado = new Map(participacionPorColor(materiales).map((entrada) => [entrada.color, entrada.participacion]));
  const desviaciones: DesviacionProporcion[] = [];
  for (const entrada of medidos) {
    const color = normalizar(entrada.color);
    const medida = entrada.share / total;
    const declarada = declarado.get(color) ?? 0;
    const delta = declarada - medida;
    if (Math.abs(delta) >= DESVIACION_MINIMA) {
      desviaciones.push({ estructura_id: estructuraId, color, medida: Number(medida.toFixed(4)), declarada: Number(declarada.toFixed(4)), delta: Number(delta.toFixed(4)) });
    }
  }
  return desviaciones.sort((uno, otro) => Math.abs(otro.delta) - Math.abs(uno.delta) || (uno.color < otro.color ? -1 : 1));
}

