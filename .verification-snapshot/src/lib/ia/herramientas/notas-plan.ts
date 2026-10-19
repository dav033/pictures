/**
 * Qué avisos de Python le llegan al modelo de la vista clásica, y cómo. El prompt de sistema trata `advertencias` como
 * instrucciones para corregir el plan; los que no se corrigen volviendo a confirmar viajan aparte o no viajan.
 */

/**
 * Los avisos de Python que cuentan cómo quedó el reparto de color de una pieza (`plan._color_warnings` y
 * `patron_color`, 2026-10-05). No son algo que el modelo pueda corregir volviendo a confirmar: un arco clásico
 * reparte su espiral por igual pida lo que pida la participación, y un patrón sin material para un acento lo
 * pierde igual. Si viajaran en `advertencias`, que el prompt trata como instrucciones para corregir el plan,
 * cada uno costaría una vuelta entera del modelo y otra resolución. Viajan aparte, en `notas_reparto`, para que
 * el modelo los explique al cliente.
 */
const PREFIJOS_NOTA_REPARTO = ["reparto_distinto:", "color_sin_globos:", "patron_sin_aplicar:", "pista_patron_incompleta:"] as const;
/**
 * Lo que Python dice solo para el registro y los totales: los repuestos de un globo que no se compraron porque
 * encarecían de más (D-038). Sale en cerca del 11 % de las líneas y no hay nada que corregir: no le llega al modelo.
 * Sigue en el plan resuelto (`advertencias`, `uncovered_waste_reserve`).
 */
const PREFIJOS_INFORMATIVOS = ["reserva_merma_no_cubierta:"] as const;

export function separarNotasReparto(advertencias: readonly string[]): { advertencias: string[]; notasReparto: string[] } {
  const esNota = (aviso: string) => PREFIJOS_NOTA_REPARTO.some((prefijo) => aviso.startsWith(prefijo));
  const paraElModelo = advertencias.filter((aviso) => !PREFIJOS_INFORMATIVOS.some((prefijo) => aviso.startsWith(prefijo)));
  return { advertencias: paraElModelo.filter((aviso) => !esNota(aviso)), notasReparto: paraElModelo.filter(esNota) };
}
