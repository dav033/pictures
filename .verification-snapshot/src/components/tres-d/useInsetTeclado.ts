"use client";

import { useEffect, useState } from "react";

/** Por debajo de esto la diferencia es la barra del navegador, no un teclado. */
const MIN_TECLADO_PX = 100;

/**
 * Cuánto tapa el teclado de pantalla la parte baja de la ventana (px), a partir del viewport visual. En iOS el teclado no
 * encoge la ventana: lo que está pegado abajo (la hoja del teléfono) queda debajo de él si no se sube esa cantidad.
 */
export function insetTeclado(altoVentana: number, visual: { height: number; offsetTop: number }): number {
  const tapado = Math.round(altoVentana - visual.height - visual.offsetTop);
  return tapado >= MIN_TECLADO_PX ? tapado : 0;
}

export function useInsetTeclado(activo: boolean): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const visual = window.visualViewport;
    if (!activo || !visual) return;
    const medir = () => setInset(insetTeclado(window.innerHeight, visual));
    medir();
    visual.addEventListener("resize", medir);
    visual.addEventListener("scroll", medir);
    return () => { visual.removeEventListener("resize", medir); visual.removeEventListener("scroll", medir); };
  }, [activo]);
  return activo ? inset : 0;
}
