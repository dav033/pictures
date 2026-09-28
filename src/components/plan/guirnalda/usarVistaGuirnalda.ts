import { useEffect, useState, useSyncExternalStore } from "react";
import type { ArmadoGuirnaldaResuelto, ArmadoGuirnaldaV1 } from "@/lib/plan/armado-guirnalda";
import { pedirVistaArmadoGuirnalda, type LineaVistaGuirnalda, type PeticionVistaArmadoGuirnalda } from "@/lib/plan/peticion-armado-guirnalda";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import { alBorrador, crearVistaGuirnalda, type EstadoVistaGuirnalda, type PedirVistaGuirnalda } from "./vista-guirnalda";

/** La pieza sobre la que se pide la vista previa: el plan que había al abrir, la guirnalda y sus líneas resueltas. */
export type PiezaVistaGuirnalda = {
  plan: PlanResuelto["plan"];
  estructuraId: string;
  lineas: readonly LineaVistaGuirnalda[];
};

/** Cuerpo de /api/plan-armado-guirnalda para una pieza. Solo transporte. */
export function peticionVistaGuirnalda(pieza: PiezaVistaGuirnalda, armado: ArmadoGuirnaldaV1 | null): PeticionVistaArmadoGuirnalda {
  return { plan: pieza.plan, estructura_id: pieza.estructuraId, armado_guirnalda: armado, lineas: pieza.lineas };
}

function pedirPara(pieza: PiezaVistaGuirnalda): PedirVistaGuirnalda {
  return (armado, signal) => pedirVistaArmadoGuirnalda(peticionVistaGuirnalda(pieza, armado), { signal });
}

/**
 * `crearVistaGuirnalda` para el editor: una instancia por montaje; la pieza y
 * `alRechazar` son las del último render. Cada borrador nuevo (`armado`) se
 * muestra; desmontar cancela lo que quede.
 */
export function useVistaGuirnalda({ pieza, armado, inicial, alRechazar }: {
  pieza: PiezaVistaGuirnalda;
  /** `null` pide la receta de Python. */
  armado: ArmadoGuirnaldaV1 | null;
  /** El armado que ya trae el plan: se dibuja sin esperar otro. */
  inicial: ArmadoGuirnaldaResuelto | null;
  alRechazar?: (mensaje: string) => void;
}): EstadoVistaGuirnalda & { reintentar: () => void } {
  const [control] = useState(() => crearVistaGuirnalda({ pedir: pedirPara(pieza), inicial, alRechazar }));
  useEffect(() => {
    control.usar({ pedir: pedirPara(pieza), alRechazar });
  }, [control, pieza, alRechazar]);
  useEffect(() => {
    control.mostrar(armado);
  }, [control, armado]);
  useEffect(() => () => control.cerrar(), [control]);
  const estado = useSyncExternalStore(control.suscribir, control.estado, control.estado);
  // Del borrador de este render, no del que el controlador conocía antes de su efecto `mostrar`.
  return { ...alBorrador(estado, armado), reintentar: control.reintentar };
}
