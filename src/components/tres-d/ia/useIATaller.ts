"use client";

import { useCallback, useEffect, useState } from "react";
import type { Escena } from "@/lib/globos3d/escena";
import type { PiezaArmada } from "@/lib/globos3d/piezas";
import { guardarConversacion, leerConversacion } from "../guardado-conversacion";
import { useAsistenteIA } from "./useAsistenteIA";
import { useNombresDePasos } from "./useNombresDePasos";

type Entrada = {
  /** La escena que se edita ahora y cómo se cambia (con su historial). */
  escena: Escena;
  cambiar: (escena: Escena) => void;
  /** `escena`, o `pieza:<id de la raíz>` en el editor solitario. */
  ambito: string;
  /** La identidad de la escena abierta: viaja con la escena (historial y guardado), así que Ctrl+Z la devuelve con ella. */
  clave: string;
  cache: Map<string, PiezaArmada>;
  /** El navegador ya hidrató: antes no se lee ni se guarda nada. */
  cargada: boolean;
};

/**
 * La IA del taller puesta en su sitio: el asistente con sus turnos, la conversación guardada aparte de la escena (cada turno
 * lleva la identidad de la escena en que se hizo: al abrir una plantilla, una sala vacía o una idea de la biblioteca la escena
 * cambia de identidad y los turnos de antes dejan de actuar sobre ella, hasta que Ctrl+Z la devuelve), los pasos nombrados del historial y Esc para volver de «Ver antes».
 */
export function useIATaller({ escena, cambiar, ambito, clave, cache, cargada }: Entrada) {
  const [guardada] = useState(() => (typeof window === "undefined" ? [] : leerConversacion()));
  const nombres = useNombresDePasos();
  const aplicar = useCallback((nueva: Escena, etiqueta: string) => { nombres.nombrar(nueva, etiqueta); cambiar(nueva); }, [nombres, cambiar]);
  const ia = useAsistenteIA({ escena, ambito, clave, cache, aplicar, inicial: guardada });

  useEffect(() => {
    if (!cargada) return;
    const t = setTimeout(() => { guardarConversacion(ia.turnos); }, 500);
    return () => clearTimeout(t);
  }, [cargada, ia.turnos]);

  // Mientras se ve la escena de antes de un turno, Esc vuelve a la de ahora.
  useEffect(() => {
    if (!ia.escenaAntes) return;
    const alTeclado = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); ia.verAntes(null); } };
    window.addEventListener("keydown", alTeclado);
    return () => window.removeEventListener("keydown", alTeclado);
  }, [ia]);

  const paso = nombres.nombreDe(escena);
  return { ia, rotuloDeshacer: paso ? `Deshacer ${paso}` : "Deshacer" };
}
