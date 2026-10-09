"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cabecerasConversacion } from "@/lib/registro/cliente";
import { pedirRondaHttp, refinarConFoto, type EntradaRefinado, type ResultadoRefinado, type RondaHecha } from "@/lib/globos3d/refinar-foto-cliente";
import { MAX_RONDAS_REFINAR } from "@/lib/globos3d/refinado-ronda";

/**
 * Rondas automáticas tras armar desde una foto: APAGADAS (0) hasta tener un criterio de aceptación por ronda. En la
 * evaluación (07, 09, 12, 13) no mejoraron en promedio, y en la prueba real con la 07 la ronda tapó el «LOVE» detrás
 * de la guirnalda, lo pasó a un foil que se ve negro y achicó la silueta. La ruta admite hasta MAX_RONDAS_REFINAR.
 */
export const RONDAS_AUTOMATICAS: number = 0;

/**
 * El refinado contra la foto de la barra «Pídele a la IA» (REQ-001 paso 9): corre `refinarConFoto` con la captura del
 * visor fuera de pantalla (`captura-refinar.ts`) y el pedido real; `refinando` dice en qué ronda va (para «Comparando con la
 * foto… ronda 1/2») y `detener` lo para (también al salir de la pantalla). Cada ronda con cambios llega por `alRonda` para que el
 * taller la aplique y guarde su deshacer.
 */
export type ProgresoRefinado = { ronda: number; total: number };

export function useRefinadoFoto(oyentes: { alRonda: (r: RondaHecha) => void; alTerminar: (r: ResultadoRefinado) => void }) {
  const [refinando, setRefinando] = useState<ProgresoRefinado | null>(null);
  const control = useRef<AbortController | null>(null);
  const oyentesRef = useRef(oyentes);
  useEffect(() => { oyentesRef.current = oyentes; });

  const iniciar = useCallback(async (entrada: EntradaRefinado) => {
    if (control.current) return;
    const mio = new AbortController();
    control.current = mio;
    setRefinando({ ronda: 1, total: Math.min(RONDAS_AUTOMATICAS, MAX_RONDAS_REFINAR) });
    try {
      const { capturarEscenaParaRefinar } = await import("./captura-refinar");
      const resultado = await refinarConFoto(entrada, {
        capturar: capturarEscenaParaRefinar,
        pedir: (cuerpo, signal) => pedirRondaHttp(cuerpo, signal, cabecerasConversacion("3d")),
        alProgreso: setRefinando,
        alRonda: (r) => oyentesRef.current.alRonda(r),
        signal: mio.signal,
        maxRondas: RONDAS_AUTOMATICAS,
      });
      if (resultado.motivo !== "sin_lectura") oyentesRef.current.alTerminar(resultado);
    } catch (e) {
      // Lo que falle fuera del bucle (cargar la captura, por ejemplo) también se le dice al usuario.
      oyentesRef.current.alTerminar({ rondas: [], escena: entrada.escena, motivo: "error", error: e instanceof Error ? e.message : "no se pudo preparar la captura" });
    } finally {
      control.current = null;
      setRefinando(null);
    }
  }, []);

  const detener = useCallback(() => control.current?.abort(), []);
  useEffect(() => () => control.current?.abort(), []);
  return { refinando, iniciar, detener };
}
