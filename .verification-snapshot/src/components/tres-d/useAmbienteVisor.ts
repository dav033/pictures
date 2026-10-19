"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AJUSTE_VISOR_DEFECTO, ajusteOpticoDe, guardarAmbienteVisor, leerAmbienteVisor, type AmbienteVisor } from "@/lib/globos3d/ambiente-visor";
import { almacenLocal, guardarEnAlmacen, suscribirAlmacen } from "./almacen-local";
import type { EscenaGlobos } from "./escena-globos";

const SIN_MEDIR = JSON.stringify(AJUSTE_VISOR_DEFECTO);

/**
 * La luz y la lente del visor. Se leen de este navegador sin pasar por el render del servidor (`useSyncExternalStore`:
 * en el servidor y en la hidratación vale el ambiente de siempre; luego, el guardado) y se aplican al visor cada vez que
 * cambian o el visor aparece. Con `activo` en falso (pantalla angosta, sin el selector), el visor vuelve al ambiente de
 * siempre sin borrar lo guardado.
 */
export function useAmbienteVisor(visor: EscenaGlobos | null, activo: boolean): { ambiente: AmbienteVisor; elegir: (cambio: Partial<AmbienteVisor>) => void } {
  const leidoJson = useSyncExternalStore(suscribirAlmacen, () => JSON.stringify(leerAmbienteVisor(almacenLocal())), () => SIN_MEDIR);
  const [escrito, setEscrito] = useState<AmbienteVisor | null>(null);
  const ambiente = useMemo(() => escrito ?? (JSON.parse(leidoJson) as AmbienteVisor), [escrito, leidoJson]);
  useEffect(() => { visor?.ajustarOptico(ajusteOpticoDe(activo ? ambiente : AJUSTE_VISOR_DEFECTO)); }, [visor, ambiente, activo]);
  const elegir = useCallback((cambio: Partial<AmbienteVisor>) => {
    const siguiente = { ...ambiente, ...cambio };
    const guardado = guardarEnAlmacen((almacen) => guardarAmbienteVisor(almacen, siguiente));
    setEscrito(guardado ? null : siguiente);
  }, [ambiente]);
  return { ambiente, elegir };
}
