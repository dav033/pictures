"use client";

import { useCallback, useEffect, useState } from "react";
import { AJUSTE_VISOR_DEFECTO, ajusteOpticoDe, guardarAmbienteVisor, leerAmbienteVisor, type AmbienteVisor } from "@/lib/globos3d/ambiente-visor";
import { almacenLocal } from "./almacen-local";
import type { EscenaGlobos } from "./escena-globos";

/**
 * La luz y la lente del visor. Se leen de este navegador al montar (no en el render) y se aplican al visor cada vez que
 * cambian o el visor aparece. Con `activo` en falso (pantalla angosta, sin el selector), el visor vuelve al ambiente de
 * siempre sin borrar lo guardado.
 */
export function useAmbienteVisor(visor: EscenaGlobos | null, activo: boolean): { ambiente: AmbienteVisor; elegir: (cambio: Partial<AmbienteVisor>) => void } {
  const [ambiente, setAmbiente] = useState<AmbienteVisor>(AJUSTE_VISOR_DEFECTO);
  useEffect(() => { setAmbiente(leerAmbienteVisor(almacenLocal())); }, []);
  useEffect(() => { visor?.ajustarOptico(ajusteOpticoDe(activo ? ambiente : AJUSTE_VISOR_DEFECTO)); }, [visor, ambiente, activo]);
  const elegir = useCallback((cambio: Partial<AmbienteVisor>) => {
    const siguiente = { ...ambiente, ...cambio };
    setAmbiente(siguiente);
    guardarAmbienteVisor(almacenLocal(), siguiente);
  }, [ambiente]);
  return { ambiente, elegir };
}
