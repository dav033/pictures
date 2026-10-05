import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ArmadoArcoOrganicoV1 } from "@/lib/plan/armado-arco-organico";
import { pedirVistaArmadoArcoOrganico, type VistaArmadoArcoOrganico } from "@/lib/plan/peticion-armado-arco-organico";
import { alBorradorArcoOrganico, crearVistaBorradorArcoOrganico, type EstadoVistaBorradorArcoOrganico, type PedirVistaBorradorArcoOrganico } from "./vista-borrador-arco-organico";
import { firmaColoresArcoOrganico, peticionVistaArcoOrganico, type PiezaVistaArcoOrganico } from "./vista-arco-organico";

function pedirPara(pieza: PiezaVistaArcoOrganico): PedirVistaBorradorArcoOrganico {
  return (armado, signal) => pedirVistaArmadoArcoOrganico(peticionVistaArcoOrganico(pieza, armado), { signal });
}

/**
 * `crearVistaBorradorArcoOrganico` para el editor: una instancia por montaje; la pieza es la del último render.
 * Cada borrador nuevo (`armado`) se muestra —tras la pausa del controlador— y desmontar cancela lo que quede.
 */
export function useVistaBorradorArcoOrganico({ pieza, armado, inicial }: {
  pieza: PiezaVistaArcoOrganico;
  armado: ArmadoArcoOrganicoV1;
  /** El dibujo del armado que ya trae el plan: se ve sin esperar otro. */
  inicial: VistaArmadoArcoOrganico | null;
}): EstadoVistaBorradorArcoOrganico & { reintentar: () => void } {
  const [control] = useState(() => crearVistaBorradorArcoOrganico({ pedir: pedirPara(pieza), inicial }));
  useEffect(() => {
    control.usar({ pedir: pedirPara(pieza) });
  }, [control, pieza]);
  // Con otros colores en la pieza, lo dibujado y lo recordado ya no vale: se vuelve a pedir el borrador a la vista.
  const firma = firmaColoresArcoOrganico(pieza);
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
  return { ...alBorradorArcoOrganico(estado, armado), reintentar: control.reintentar };
}
