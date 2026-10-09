"use client";

import { useEffect } from "react";
import type { EscenaArmada } from "@/lib/globos3d/escena";
import type { EscenaGlobos } from "../escena-globos";
import type { Marca } from "./useAsistenteIA";

/**
 * Marca en ESTE visor las piezas que señala la conversación (la línea de un turno bajo el cursor, o lo que la IA acaba de
 * cambiar): la caja de cada pieza, verde si es nueva y ámbar si cambió. Cada visor lleva sus propias marcas (nada se
 * guarda fuera de él: D-017); sin marcas, las quita.
 */
export function useResaltadoIA(visor: EscenaGlobos | null, armada: EscenaArmada | null, marcas: readonly Marca[]) {
  useEffect(() => {
    if (!visor) return;
    const cajas = armada ? marcas.flatMap((m) => { const caja = armada.porNodo.find((n) => n.id === m.id)?.caja; return caja ? [{ caja, nueva: m.nueva }] : []; }) : [];
    visor.resaltarCambios(cajas);
  }, [visor, armada, marcas]);
}
