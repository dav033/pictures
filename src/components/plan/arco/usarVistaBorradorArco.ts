import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ArmadoArcoV1 } from "@/lib/plan/armado-arco";
import { pedirVistaArmadoArco, type VistaArmadoArco } from "@/lib/plan/peticion-armado-arco";
import { alBorradorArco, crearVistaBorradorArco, type EstadoVistaBorradorArco, type PedirVistaBorradorArco } from "./vista-borrador-arco";
import { firmaColoresArco, peticionVistaArco, type PiezaVistaArco } from "./vista-arco";

function pedirPara(pieza: PiezaVistaArco): PedirVistaBorradorArco {
  return (armado, signal) => pedirVistaArmadoArco(peticionVistaArco(pieza, armado), { signal });
}

/**
 * `crearVistaBorradorArco` para el editor: una instancia por montaje; la pieza es la del último render. Cada
 * borrador nuevo (`armado`) se muestra —tras la pausa del controlador— y desmontar cancela lo que quede.
 */
export function useVistaBorradorArco({ pieza, armado, inicial }: {
  pieza: PiezaVistaArco;
  armado: ArmadoArcoV1;
  /** El dibujo del armado que ya trae el plan: se ve sin esperar otro. */
  inicial: VistaArmadoArco | null;
}): EstadoVistaBorradorArco & { reintentar: () => void } {
  const [control] = useState(() => crearVistaBorradorArco({ pedir: pedirPara(pieza), inicial }));
  useEffect(() => {
    control.usar({ pedir: pedirPara(pieza) });
  }, [control, pieza]);
  // Con otros colores en la pieza, lo dibujado y lo recordado ya no vale: se vuelve a pedir el borrador a la vista.
  const firma = firmaColoresArco(pieza);
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
  return { ...alBorradorArco(estado, armado), reintentar: control.reintentar };
}
