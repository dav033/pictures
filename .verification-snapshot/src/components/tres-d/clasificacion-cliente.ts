"use client";

import { useEffect, useState } from "react";
import type { Clasificador } from "@/lib/taller/filtros-taxonomia";

/**
 * La clasificación de la biblioteca por celebración y temática (`clasificacion-biblioteca.ts`, ~80 KB de JSON) se baja
 * la primera vez que se abre «Añadir» y no antes: abrir /3d no la paga (la regla de carga de test-carga-3d). Mientras
 * llega, `useClasificador` da `null` y los filtros por celebración y temática esperan.
 */
let promesa: Promise<Clasificador> | null = null;
let cargado: Clasificador | null = null;

function cargar(): Promise<Clasificador> {
  return (promesa ??= import("@/lib/taller/clasificacion-biblioteca").then((m) => (cargado = m.clasificacionDe)));
}

export function useClasificador(): Clasificador | null {
  const [clasificador, setClasificador] = useState<Clasificador | null>(cargado);
  useEffect(() => {
    if (cargado) return;
    let vivo = true;
    cargar().then((c) => { if (vivo) setClasificador(() => c); }).catch((causa) => {
      promesa = null;
      console.error("[biblioteca] no se pudo cargar la clasificación", causa);
    });
    return () => { vivo = false; };
  }, []);
  return clasificador;
}
