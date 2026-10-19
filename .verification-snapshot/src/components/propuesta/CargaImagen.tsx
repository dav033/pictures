"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ConstruccionArco } from "./ConstruccionArco";

/**
 * Honest phase by elapsed time: the provider reports no progress, so this
 * never shows a percentage it does not have.
 */
export function faseCargaImagen(segundos: number): string {
  if (segundos < 3) return "Preparando tu escena";
  if (segundos < 15) return "Inflando los globos";
  if (segundos < 30) return "Acomodando cada pieza en su lugar";
  if (segundos < 45) return "Ajustando la luz y los colores";
  return "Casi lista, últimos detalles";
}

type Props = {
  segundos: number;
  /** Placeholder where the image will land (only before the first image). */
  conMarco?: boolean;
  /** The proposal's colors, so the balloon being inflated is one of its own. */
  colores?: readonly string[];
  /** A wait of up to two minutes needs a way out. */
  onCancelar?: () => void;
};

/**
 * Wait for the proposal image: an arch of balloons in the proposal's colors
 * builds itself while the phase text changes (`ConstruccionArco`), instead
 * of a bare shimmer box during a wait of up to two minutes.
 */
export function CargaImagen({ segundos, conMarco = true, colores = [], onCancelar }: Props) {
  const reducir = useReducedMotion();
  const fase = faseCargaImagen(segundos);
  return (
    <div role="status" aria-live="polite" className="space-y-2.5">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-texto">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={fase} initial={reducir ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.25 }}>
            {fase}
          </motion.span>
        </AnimatePresence>
        <span className="puntos" aria-hidden="true"><span /><span /><span /></span>
        <span className="text-xs text-texto-suave tabular-nums">{segundos} s · puede tardar hasta 2 min</span>
        {onCancelar && (
          <button
            type="button"
            onClick={onCancelar}
            className="ml-auto rounded-full px-2.5 py-1 text-xs font-medium text-texto-suave ring-1 ring-borde-suave ring-inset hover:bg-superficie-suave hover:text-texto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento"
          >
            Cancelar
          </button>
        )}
      </p>
      {conMarco ? (
        <div className="relative aspect-[3/2] w-full overflow-hidden rounded-2xl bg-superficie-2 ring-1 ring-borde-suave ring-inset" aria-hidden="true">
          <ConstruccionArco segundos={segundos} colores={colores} className="absolute inset-0 size-full p-4" />
          <span className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-superficie/85 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-acento ring-1 ring-borde-suave backdrop-blur-sm">
            Construyendo tu decoración
          </span>
        </div>
      ) : (
        <div className="flex justify-center" aria-hidden="true">
          <ConstruccionArco segundos={segundos} colores={colores} className="h-28 w-auto" />
        </div>
      )}
    </div>
  );
}
