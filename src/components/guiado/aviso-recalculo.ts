/**
 * Los planes del motor 3D cuyo cliente ya leyó que, con el corte del 3D, su plan se recalcula con el método de siempre y el
 * precio puede cambiar (P-045, D-023). Con el corte, el primer intento de rehacer un plan así solo avisa y lo deja como
 * estaba; el siguiente lo recalcula. Un cambio que el corte rechazó ya lo dijo, así que también cuenta. Vive lo que dura la
 * página: tras recargar se vuelve a avisar, que es lo seguro.
 */
export type AvisosRecalculo = {
  yaAvisado: (planHash: string) => boolean;
  marcar: (planHash: string) => void;
};

export function crearAvisosRecalculo(): AvisosRecalculo {
  const avisados = new Set<string>();
  return {
    yaAvisado: (planHash) => avisados.has(planHash),
    marcar: (planHash) => { avisados.add(planHash); },
  };
}

/** El de la página: lo comparten los cambios del plan (`edicion-motor3d.ts`) y los planes rehechos (`usarMotorGuiada.ts`). */
export const avisosRecalculo: AvisosRecalculo = crearAvisosRecalculo();
