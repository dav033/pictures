import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ArmadoGuirnaldaOrganicaV1 } from "@/lib/plan/armado-guirnalda-organica";
import { pedirVistaArmadoGuirnaldaOrganica, type VistaArmadoGuirnaldaOrganica } from "@/lib/plan/peticion-armado-guirnalda-organica";
import { alBorradorGuirnaldaOrganica, crearVistaBorradorGuirnaldaOrganica, type EstadoVistaBorradorGuirnaldaOrganica, type PedirVistaBorradorGuirnaldaOrganica } from "./vista-borrador-guirnalda-organica";
import { firmaColoresGuirnaldaOrganica, peticionVistaGuirnaldaOrganica, type PiezaVistaGuirnaldaOrganica } from "./vista-guirnalda-organica";

function pedirPara(pieza: PiezaVistaGuirnaldaOrganica): PedirVistaBorradorGuirnaldaOrganica {
  return (armado, signal) => pedirVistaArmadoGuirnaldaOrganica(peticionVistaGuirnaldaOrganica(pieza, armado), { signal });
}

/**
 * `crearVistaBorradorGuirnaldaOrganica` para el editor: una instancia por montaje; la pieza es la del último render. Cada
 * borrador nuevo (`armado`) se muestra —tras la pausa del controlador— y desmontar cancela lo que quede.
 */
export function useVistaBorradorGuirnaldaOrganica({ pieza, armado, inicial }: {
  pieza: PiezaVistaGuirnaldaOrganica;
  armado: ArmadoGuirnaldaOrganicaV1;
  /** El dibujo del armado que ya trae el plan: se ve sin esperar otro. */
  inicial: VistaArmadoGuirnaldaOrganica | null;
}): EstadoVistaBorradorGuirnaldaOrganica & { reintentar: () => void } {
  const [control] = useState(() => crearVistaBorradorGuirnaldaOrganica({ pedir: pedirPara(pieza), inicial }));
  useEffect(() => {
    control.usar({ pedir: pedirPara(pieza) });
  }, [control, pieza]);
  // Con otros colores en la pieza, lo dibujado y lo recordado ya no vale: se vuelve a pedir el borrador a la vista.
  const firma = firmaColoresGuirnaldaOrganica(pieza);
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
  return { ...alBorradorGuirnaldaOrganica(estado, armado), reintentar: control.reintentar };
}
