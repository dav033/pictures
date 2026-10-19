/**
 * **El alto de una pieza orgánica nueva** (columna, semiarco, marco): el que se pide es el que se ve, de abajo a lo más alto de los globos, y los
 * grandes de la punta sobresalen del recorrido, así que la pieza se arma para medirla y, si se pasa o se queda corta más de 4 cm, se estira o se
 * encoge y se vuelve a armar. Esa segunda armada tarda lo mismo que la primera: en una pieza de segundos no se hace (el pedido tiene un tiempo),
 * salvo que la pieza no quepa bajo el techo, que es un error que antes se devolvía sin más. Aquí solo se decide; armar y estirar lo hace quien llama.
 */

/** Lo más que puede haber tardado la primera armada (ms) para volver a armar el cuerpo ya estirado. */
export const MS_PARA_REAJUSTAR_ALTO = 6000;
/** Cuánto se puede pasar o quedar corto (cm) el alto armado del pedido sin estirar. */
export const TOLERANCIA_ALTO_CM = 4;

export type DecisionAlto = {
  /** `reajustar`: estirar al alto pedido y armar otra vez; `al_techo`: estirar a un alto que quepa bajo el techo; `dejar`: como está. */
  accion: "reajustar" | "al_techo" | "dejar";
  /** Lo que se le dice al modelo (en las notas de la herramienta) cuando la pieza no queda del alto pedido. */
  nota?: string;
};

export function decidirAlto(a: { medidoCm: number; pedidoCm: number; costoMs: number; techoCm?: number }): DecisionAlto {
  const fuera = Math.abs(a.medidoCm - a.pedidoCm) > TOLERANCIA_ALTO_CM;
  if (fuera && a.costoMs <= MS_PARA_REAJUSTAR_ALTO) return { accion: "reajustar" };
  if (fuera && a.techoCm !== undefined && a.medidoCm > a.techoCm) return { accion: "al_techo" };
  if (!fuera) return { accion: "dejar" };
  return { accion: "dejar", nota: `quedó de ${Math.round(a.medidoCm)} cm de alto y no de los ${a.pedidoCm} pedidos: armarla otra vez para ajustarla (${Math.round(a.costoMs / 1000)} s) tardaría demasiado` };
}

/** El mayor `alto_cm` que se puede pedir para que una pieza armada en `medidoCm` quepa bajo el techo, sabiendo que se pidió `pedidoCm`. */
export const altoQueCabe = (pedidoCm: number, medidoCm: number, techoCm: number): number => Math.floor(pedidoCm - (medidoCm - techoCm)) - 1;
