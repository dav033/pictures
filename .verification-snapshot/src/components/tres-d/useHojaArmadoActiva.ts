"use client";

import { useEffect, useState } from "react";
import { LecturaHojaArmadoSchema, RUTA_HOJA_ARMADO } from "@/lib/taller/hoja-armado-bandera-tipos";

/**
 * Si la «Hoja de armado» está encendida (bandera `taller_hoja_armado`, apagada por defecto). Se lee una vez al montar el taller.
 * Mientras no llega, o si la lectura falla (red, 401, respuesta rara), vale apagada: es el valor por defecto de la bandera, y
 * el botón simplemente no sale.
 */
export function useHojaArmadoActiva(): boolean {
  const [activa, setActiva] = useState(false);
  useEffect(() => {
    const control = new AbortController();
    fetch(RUTA_HOJA_ARMADO, { cache: "no-store", signal: control.signal })
      .then((respuesta) => (respuesta.ok ? respuesta.json() : null))
      .then((json: unknown) => {
        const lectura = LecturaHojaArmadoSchema.safeParse(json);
        if (lectura.success) setActiva(lectura.data.activa);
      })
      .catch((causa: unknown) => {
        if (!control.signal.aborted) console.warn("[taller] no se pudo leer la bandera de la hoja de armado; queda apagada.", causa instanceof Error ? causa.message : causa);
      });
    return () => control.abort();
  }, []);
  return activa;
}
