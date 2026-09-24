"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";

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
 * Wait for the proposal image: a balloon inflates and deflates softly while
 * the phase text changes. Replaces a bare shimmer box that gave no sense of
 * what was happening during a wait of up to two minutes.
 */
export function CargaImagen({ segundos, conMarco = true, colores = [], onCancelar }: Props) {
  const reducir = useReducedMotion();
  const fase = faseCargaImagen(segundos);
  const color = colores.length ? colores[Math.floor(segundos / 6) % colores.length]! : "var(--acento)";
  const globo = (
    <motion.svg
      viewBox="0 0 40 56"
      className="h-16 w-12 drop-shadow-[0_8px_16px_var(--sombra)]"
      aria-hidden="true"
      animate={reducir ? undefined : { scale: [0.82, 1, 0.82], y: [0, -4, 0] }}
      transition={reducir ? undefined : { duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
    >
      <defs>
        <radialGradient id="brillo-globo" cx="35%" cy="30%" r="60%">
          <stop offset="0%" stopColor="white" stopOpacity="0.55" />
          <stop offset="60%" stopColor="white" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="20" cy="20" rx="16" ry="19" style={{ fill: color, transition: "fill 0.8s ease" }} />
      <ellipse cx="20" cy="20" rx="16" ry="19" fill="url(#brillo-globo)" />
      <path d="M17.5 38.5h5l-2.5 3.5z" style={{ fill: color, transition: "fill 0.8s ease" }} />
      <path d="M20 42c-3 4 3 7 0 13" fill="none" strokeWidth="1" className="stroke-texto-tenue" />
    </motion.svg>
  );
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
        <div className="brillo-carga relative grid aspect-[3/2] w-full place-items-center rounded-2xl" aria-hidden="true">
          {globo}
        </div>
      ) : (
        <div className="flex justify-center" aria-hidden="true">{globo}</div>
      )}
    </div>
  );
}
