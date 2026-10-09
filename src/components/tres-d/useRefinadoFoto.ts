"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cabecerasConversacion } from "@/lib/registro/cliente";
import { refinarConFoto, type EntradaRefinado, type ResultadoRefinado, type RondaHecha } from "@/lib/globos3d/refinado/bucle";
import { crearEvaluadorDeRonda } from "@/lib/globos3d/refinado/evaluador";
import { MAX_RONDAS_REFINAR } from "@/lib/globos3d/refinado/ronda";
import { pedirRondaHttp, pedirVeredictoHttp, reducirFotoParaRevision } from "./refinado-http";

/**
 * Rondas automáticas tras armar desde una foto: CERO. El criterio de aceptación (`refinado/evaluador.ts`: el servidor decide si la
 * captura se parece más a la foto que la de antes y la estructura no empeora) existe y se prueba, pero la calibración
 * (`scripts/exp/calibrar-margen-refinado.ts`, 2026-10-09, ver `MARGEN_MEJORA`) no lo respalda todavía: el embedding de imagen no
 * tiene ruido (el piso es 0) pero tampoco distingue lo pequeño; mover 50 cm una pieza mejoró el parecido en 2 de 4 fotos y la curva
 * de efecto no es monótona. Con el margen de 0,02 solo pasan los cambios grandes, y una ronda pagada se descartaría casi siempre.
 * Se enciende (1) cuando el paso 3 del protocolo (rondas etiquetadas por el dueño, curva ROC) confirme un margen que separe las
 * rondas buenas de las malas. En la evaluación (07, 09, 12, 13) las rondas sin criterio no mejoraron en promedio, y en una prueba
 * real con la 07 la ronda tapó el «LOVE» detrás de la guirnalda y achicó la silueta. La ruta admite hasta MAX_RONDAS_REFINAR.
 */
export const RONDAS_AUTOMATICAS: number = 0;

/**
 * El refinado contra la foto de la barra «Pídele a la IA» (REQ-001 paso 9): corre `refinarConFoto` con la captura del
 * visor fuera de pantalla (`captura-refinar.ts`) y el pedido real; `refinando` dice en qué ronda va (para «Comparando con la
 * foto… ronda 1/2») y `detener` lo para (también al salir de la pantalla). Cada ronda con cambios llega por `alRonda` para que el
 * taller la aplique y guarde su deshacer.
 */
export type ProgresoRefinado = { ronda: number; total: number; fase?: "comparando" | "revisando" };

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
        evaluar: crearEvaluadorDeRonda({ capturar: capturarEscenaParaRefinar, reducirFoto: reducirFotoParaRevision, veredicto: pedirVeredictoHttp(cabecerasConversacion("3d")) }),
        pedir: (cuerpo, signal) => pedirRondaHttp(cuerpo, signal, cabecerasConversacion("3d")),
        alProgreso: setRefinando,
        alRonda: (r) => oyentesRef.current.alRonda(r),
        signal: mio.signal,
        maxRondas: RONDAS_AUTOMATICAS,
      });
      if (resultado.motivo !== "sin_lectura") oyentesRef.current.alTerminar(resultado);
    } catch (e) {
      // Lo que falle fuera del bucle (cargar la captura, por ejemplo) también se le dice al usuario.
      oyentesRef.current.alTerminar({ rondas: [], escena: entrada.escena, motivo: "error", evaluaciones: [], error: e instanceof Error ? e.message : "no se pudo preparar la captura" });
    } finally {
      control.current = null;
      setRefinando(null);
    }
  }, []);

  const detener = useCallback(() => control.current?.abort(), []);
  useEffect(() => () => control.current?.abort(), []);
  return { refinando, iniciar, detener };
}
