"use client";

import { useCallback, useState } from "react";
import { deshacerAjuste, puedeDeshacer, recordarParaDeshacer, type ResultadoDeshacer, type PilaDeshacer, type WidgetDelPlan } from "./deshacer-ajuste";

/**
 * Los planes de antes de cada tarjeta de plan (por id de mensaje) para «Deshacer» (REQ-016, P-042). Solo en memoria: ver el porqué
 * en `deshacer-ajuste.ts`. La lógica es de allí; esto solo guarda la pila de cada tarjeta y avisa a la vista cuando cambia.
 */
export function useDeshacerAjuste() {
  const [pilas, setPilas] = useState<Readonly<Record<string, PilaDeshacer>>>({});

  /** Antes de publicar un ajuste: guarda el widget de `previo` (el plan que se ve) y el hash que el ajuste deja. */
  const recordar = useCallback((mensajeId: string, previo: WidgetDelPlan, despuesHash: string): void => {
    setPilas((actuales) => {
      const pila = actuales[mensajeId] ?? [];
      const nueva = recordarParaDeshacer(pila, previo, despuesHash);
      return nueva === pila ? actuales : { ...actuales, [mensajeId]: nueva };
    });
  }, []);

  const puede = useCallback((mensajeId: string, actual: WidgetDelPlan): boolean => puedeDeshacer(pilas[mensajeId] ?? [], actual), [pilas]);

  /** El widget de antes del último ajuste, o por qué no se puede (la pila se limpia en ese caso: ya no sirve). */
  const deshacer = useCallback((mensajeId: string, actual: WidgetDelPlan): ResultadoDeshacer => {
    const resultado = deshacerAjuste(pilas[mensajeId] ?? [], actual);
    setPilas((actuales) => ({ ...actuales, [mensajeId]: resultado.pila }));
    return resultado;
  }, [pilas]);

  /** «Empezar de nuevo»: los planes de antes de una conversación borrada no se quedan en memoria. */
  const limpiar = useCallback((): void => setPilas({}), []);

  return { recordar, puede, deshacer, limpiar };
}
