"use client";

import { useCallback, useState } from "react";
import type { Escena } from "@/lib/globos3d/escena";

/**
 * El nombre de los pasos del historial que no son ediciones a mano («Turno 3 de la IA», «Deshacer turno 3»): se guarda por la
 * escena que dejó ese paso (cada paso del historial es una escena distinta), así el botón de deshacer dice qué va a deshacer.
 * Vive en el taller que lo usa, no en el módulo.
 */
export function useNombresDePasos() {
  const [nombres] = useState(() => new WeakMap<Escena, string>());
  const nombrar = useCallback((escena: Escena, nombre: string) => { nombres.set(escena, nombre); }, [nombres]);
  const nombreDe = useCallback((escena: Escena): string | null => nombres.get(escena) ?? null, [nombres]);
  return { nombrar, nombreDe };
}
