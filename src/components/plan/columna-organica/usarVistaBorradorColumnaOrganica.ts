import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ArmadoColumnaOrganicaV1 } from "@/lib/plan/armado-columna-organica";
import { pedirVistaArmadoColumnaOrganica, type VistaArmadoColumnaOrganica } from "@/lib/plan/peticion-armado-columna-organica";
import { alBorradorColumnaOrganica, crearVistaBorradorColumnaOrganica, type EstadoVistaBorradorColumnaOrganica, type PedirVistaBorradorColumnaOrganica } from "./vista-borrador-columna-organica";
import { firmaColoresColumnaOrganica, peticionVistaColumnaOrganica, type PiezaVistaColumnaOrganica } from "./vista-columna-organica";

function pedirPara(pieza: PiezaVistaColumnaOrganica): PedirVistaBorradorColumnaOrganica {
  return (armado, signal) => pedirVistaArmadoColumnaOrganica(peticionVistaColumnaOrganica(pieza, armado), { signal });
}

/**
 * `crearVistaBorradorColumnaOrganica` para el editor: una instancia por montaje; la pieza es la del último render. Cada
 * borrador nuevo (`armado`) se muestra —tras la pausa del controlador— y desmontar cancela lo que quede.
 */
export function useVistaBorradorColumnaOrganica({ pieza, armado, inicial }: {
  pieza: PiezaVistaColumnaOrganica;
  armado: ArmadoColumnaOrganicaV1;
  /** El dibujo del armado que ya trae el plan: se ve sin esperar otro. */
  inicial: VistaArmadoColumnaOrganica | null;
}): EstadoVistaBorradorColumnaOrganica & { reintentar: () => void } {
  const [control] = useState(() => crearVistaBorradorColumnaOrganica({ pedir: pedirPara(pieza), inicial }));
  useEffect(() => {
    control.usar({ pedir: pedirPara(pieza) });
  }, [control, pieza]);
  // Con otros colores en la pieza, lo dibujado y lo recordado ya no vale: se vuelve a pedir el borrador a la vista.
  const firma = firmaColoresColumnaOrganica(pieza);
  const firmaPrevia = useRef(firma);
  useEffect(() => {
    if (firmaPrevia.current === firma) return;
    firmaPrevia.current = firma;
    control.reiniciar();
  }, [control, firma]);
  useEffect(() => {
    control.mostrar(armado);
  }, [control, armado]);
  useEffect(() => () => control.cerrar(), [control]);
  const estado = useSyncExternalStore(control.suscribir, control.estado, control.estado);
  // Del borrador de este render, no del que el controlador conocía antes de su efecto `mostrar`.
  return { ...alBorradorColumnaOrganica(estado, armado), reintentar: control.reintentar };
}
