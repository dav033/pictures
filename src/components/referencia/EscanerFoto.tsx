"use client";

/* The scanned copy is the customer's own attachment (local data URL). */
/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react";
import { motion } from "motion/react";

/** Detection points that light up while the photo is scanned (fractions of the photo). */
const DESTELLOS = [
  { x: 0.18, y: 0.22 }, { x: 0.72, y: 0.16 }, { x: 0.44, y: 0.38 }, { x: 0.86, y: 0.46 },
  { x: 0.28, y: 0.58 }, { x: 0.62, y: 0.66 }, { x: 0.12, y: 0.82 }, { x: 0.52, y: 0.86 },
  { x: 0.8, y: 0.8 }, { x: 0.36, y: 0.12 },
] as const;

const ESQUINAS = [
  "left-3 top-3 border-l-[3px] border-t-[3px] rounded-tl-xl",
  "right-3 top-3 border-r-[3px] border-t-[3px] rounded-tr-xl",
  "left-3 bottom-3 border-l-[3px] border-b-[3px] rounded-bl-xl",
  "right-3 bottom-3 border-r-[3px] border-b-[3px] rounded-br-xl",
] as const;

/** Seconds of one full sweep, down and back (`escaner-barrido` in globals.css). */
const BARRIDO_S = 3.6;

/** Progress shown while waiting: climbs fast, then slows, and never claims 100 % before the analysis ends. */
function useAvance(): number {
  const [avance, setAvance] = useState(0);
  useEffect(() => {
    const intervalo = window.setInterval(() => setAvance((previo) => Math.min(96, previo + Math.max(0.4, (96 - previo) * 0.035))), 120);
    return () => window.clearInterval(intervalo);
  }, []);
  return Math.floor(avance);
}

/**
 * Scanner over the reference photo while the analysis runs, as a literal
 * scanner: the photo starts grey and dim, a laser sweeps it down and back and
 * the colors appear behind it, over a moving grid, a viewfinder and detection
 * points, with the progress in the corner. A showcase: its CSS animations
 * (`escaner-*` in globals.css) also run with reduced motion.
 */
export function EscanerFoto({ src }: { src: string }) {
  const avance = useAvance();
  return (
    <motion.div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.5 } }}
      transition={{ duration: 0.35 }}
    >
      {/* The part the laser has not reached yet: grey and dim. Its top edge follows the laser. */}
      <img src={src} alt="" draggable={false} className="escaner-revelar absolute inset-0 size-full object-cover grayscale brightness-[0.45] contrast-125" />

      <div
        className="escaner-rejilla absolute inset-0 opacity-70"
        style={{
          backgroundImage:
            "linear-gradient(to right, color-mix(in srgb, var(--acento) 40%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in srgb, var(--acento) 40%, transparent) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
          maskImage: "radial-gradient(ellipse at center, black 40%, transparent 90%)",
          WebkitMaskImage: "radial-gradient(ellipse at center, black 40%, transparent 90%)",
        }}
      />

      {/* The laser: a bright line with a glowing beam trailing behind it. */}
      <div className="escaner-barrido absolute inset-x-0 h-0">
        <div className="absolute inset-x-0 bottom-0 h-24 bg-linear-to-b from-transparent via-acento/20 to-acento/55 mix-blend-screen" />
        <div className="absolute inset-x-0 top-0 h-16 bg-linear-to-t from-transparent via-acento/15 to-acento/45 mix-blend-screen" />
        <div className="absolute inset-x-0 -top-px h-[3px] bg-white shadow-[0_0_18px_5px_var(--acento),0_0_4px_1px_white]" />
        <div className="absolute -top-[5px] left-0 h-[11px] w-3 rounded-r-full bg-acento-2 shadow-[0_0_12px_3px_var(--acento-2)]" />
        <div className="absolute -top-[5px] right-0 h-[11px] w-3 rounded-l-full bg-acento-2 shadow-[0_0_12px_3px_var(--acento-2)]" />
      </div>

      {DESTELLOS.map(({ x, y }, indice) => (
        <span
          key={`${x}-${y}`}
          className="escaner-destello absolute size-2 rounded-full bg-white opacity-0 shadow-[0_0_12px_4px_var(--acento)]"
          // Each point lights up as the laser passes over it on the way down.
          style={{ left: `${x * 100}%`, top: `${y * 100}%`, animationDelay: `${(y * BARRIDO_S) / 2 + (indice % 2) * 0.12}s` }}
        />
      ))}

      {ESQUINAS.map((clase) => (
        <span key={clase} className={`escaner-pulso absolute size-8 border-white drop-shadow-[0_0_8px_var(--acento)] ${clase}`} />
      ))}

      <span className="absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/55 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-white ring-1 ring-white/15 backdrop-blur-sm">
        <span className="escaner-pulso size-1.5 rounded-full bg-acento-2 shadow-[0_0_8px_var(--acento-2)]" />
        Escaneando
        <span className="w-9 text-right tabular-nums">{avance}%</span>
      </span>

      <div className="absolute inset-x-6 bottom-5 h-1 overflow-hidden rounded-full bg-white/20">
        <div className="h-full rounded-full bg-linear-to-r from-acento to-acento-2 shadow-[0_0_10px_var(--acento)] transition-[width] duration-150" style={{ width: `${avance}%` }} />
      </div>
    </motion.div>
  );
}
