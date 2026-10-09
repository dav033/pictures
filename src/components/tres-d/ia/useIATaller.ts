"use client";

import { useCallback, useEffect, useState } from "react";
import type { Escena } from "@/lib/globos3d/escena";
import type { PiezaArmada } from "@/lib/globos3d/piezas";
import { claveNueva, guardarConversacion, leerConversacion } from "../guardado-conversacion";
import { useAsistenteIA } from "./useAsistenteIA";
import { useNombresDePasos } from "./useNombresDePasos";

type Entrada = {
  /** La escena que se edita ahora y cómo se cambia (con su historial). */
  escena: Escena;
  cambiar: (escena: Escena) => void;
  /** `escena`, o `pieza:<id de la raíz>` en el editor solitario. */
  ambito: string;
  cache: Map<string, PiezaArmada>;
  /** El navegador ya hidrató: antes no se lee ni se guarda nada. */
  cargada: boolean;
};

/**
 * La IA del taller puesta en su sitio: el asistente con sus turnos, la conversación guardada aparte de la escena (y con la
 * identidad de la escena a la que pertenece: `reemplazarEscena` la cambia al abrir una plantilla, una sala vacía o una idea de
 * la biblioteca, y los turnos de antes dejan de actuar), los pasos nombrados del historial y Esc para volver de «Ver antes».
 */
export function useIATaller({ escena, cambiar, ambito, cache, cargada }: Entrada) {
  const [guardada] = useState(() => (typeof window === "undefined" ? null : leerConversacion()));
  const [clave, setClave] = useState(() => guardada?.clave ?? claveNueva());
  const nombres = useNombresDePasos();
  const aplicar = useCallback((nueva: Escena, etiqueta: string) => { nombres.nombrar(nueva, etiqueta); cambiar(nueva); }, [nombres, cambiar]);
  const ia = useAsistenteIA({ escena, ambito, clave, cache, aplicar, inicial: guardada?.turnos ?? [] });

  useEffect(() => {
    if (!cargada) return;
    const t = setTimeout(() => { guardarConversacion({ clave, turnos: ia.turnos }); }, 500);
    return () => clearTimeout(t);
  }, [cargada, clave, ia.turnos]);

  // Mientras se ve la escena de antes de un turno, Esc vuelve a la de ahora.
  useEffect(() => {
    if (!ia.escenaAntes) return;
    const alTeclado = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); ia.verAntes(null); } };
    window.addEventListener("keydown", alTeclado);
    return () => window.removeEventListener("keydown", alTeclado);
  }, [ia]);

  const paso = nombres.nombreDe(escena);
  return { ia, reemplazarEscena: () => setClave(claveNueva()), rotuloDeshacer: paso ? `Deshacer ${paso}` : "Deshacer" };
}
