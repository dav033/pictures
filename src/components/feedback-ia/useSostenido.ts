"use client";

import { useEffect, useState } from "react";

/** `true` solo cuando `valor` lleva `ms` milisegundos seguidos en `true` (un Ctrl+Z que se rehace enseguida no cuenta). */
export function useSostenido(valor: boolean, ms: number): boolean {
  const [firme, setFirme] = useState(false);
  useEffect(() => {
    if (!valor) return undefined;
    const reloj = setTimeout(() => setFirme(true), ms);
    return () => { clearTimeout(reloj); setFirme(false); };
  }, [valor, ms]);
  return valor && firme;
}
