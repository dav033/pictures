import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ArmadoColumnaV1 } from "@/lib/plan/armado-columna";
import { pedirVistaArmadoColumna, type VistaArmadoColumna } from "@/lib/plan/peticion-armado-columna";
import { alBorradorColumna, crearVistaBorradorColumna, type EstadoVistaBorradorColumna, type PedirVistaBorradorColumna } from "./vista-borrador-columna";
import { firmaColoresColumna, peticionVistaColumna, type PiezaVistaColumna } from "./vista-columna";

function pedirPara(pieza: PiezaVistaColumna): PedirVistaBorradorColumna {
  return (armado, signal) => pedirVistaArmadoColumna(peticionVistaColumna(pieza, armado), { signal });
}

/**
 * `crearVistaBorradorColumna` para el editor: una instancia por montaje; la pieza es la del último render. Cada
 * borrador nuevo (`armado`) se muestra —tras la pausa del controlador— y desmontar cancela lo que quede.
 */
export function useVistaBorradorColumna({ pieza, armado, inicial }: {
  pieza: PiezaVistaColumna;
  armado: ArmadoColumnaV1;
  /** El dibujo del armado que ya trae el plan: se ve sin esperar otro. */
  inicial: VistaArmadoColumna | null;
}): EstadoVistaBorradorColumna & { reintentar: () => void } {
  const [control] = useState(() => crearVistaBorradorColumna({ pedir: pedirPara(pieza), inicial }));
  useEffect(() => {
    control.usar({ pedir: pedirPara(pieza) });
  }, [control, pieza]);
  // Con otros colores en la pieza, lo dibujado y lo recordado ya no vale: se vuelve a pedir el borrador a la vista.
  const firma = firmaColoresColumna(pieza);
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
  return { ...alBorradorColumna(estado, armado), reintentar: control.reintentar };
}
