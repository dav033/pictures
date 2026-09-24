"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { motion, useReducedMotion } from "motion/react";

type Props = {
  /** Increments on every approval: each value lets one flight of balloons go. */
  disparo: number;
  /** CSS backgrounds of the proposal's own colors (`MuestraColor.fondo`). */
  colores: readonly string[];
  cantidad?: number;
};

type Globo = { id: string; izquierda: number; tamano: number; duracion: number; retraso: number; vaiven: number; giro: number; fondo: string };

const COLORES_RESPALDO = ["var(--acento)", "var(--acento-hover)", "var(--acento-suave)"];

/** Deterministic spread per flight, so a re-render does not reshuffle the balloons mid-air. */
function globosDe(disparo: number, colores: readonly string[], cantidad: number): Globo[] {
  const paleta = colores.length ? colores : COLORES_RESPALDO;
  let semilla = disparo * 9301 + 49297;
  const azar = () => {
    semilla = (semilla * 9301 + 49297) % 233280;
    return semilla / 233280;
  };
  return Array.from({ length: cantidad }, (_, indice) => ({
    id: `${disparo}-${indice}`,
    izquierda: 8 + azar() * 84,
    tamano: 26 + azar() * 22,
    duracion: 2.6 + azar() * 1.4,
    retraso: azar() * 0.5,
    vaiven: (azar() - 0.5) * 70,
    giro: (azar() - 0.5) * 24,
    fondo: paleta[indice % paleta.length]!,
  }));
}

/**
 * A flight of balloons in the proposal's own colors when the customer
 * approves it: the moment that used to be a button changing its label.
 * Purely decorative (aria-hidden, no pointer events) and skipped entirely
 * with reduced motion.
 */
export function GlobosCelebracion({ disparo, colores, cantidad = 16 }: Props) {
  const reducir = useReducedMotion();
  const [visible, setVisible] = useState<number | null>(null);
  const globos = useMemo(() => (visible == null ? [] : globosDe(visible, colores, cantidad)), [visible, colores, cantidad]);

  useEffect(() => {
    if (disparo <= 0 || reducir) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberado: cada aprobación suelta un vuelo nuevo.
    setVisible(disparo);
    const fin = window.setTimeout(() => setVisible(null), 4600);
    return () => window.clearTimeout(fin);
  }, [disparo, reducir]);

  if (visible == null || typeof document === "undefined") return null;
  return createPortal(
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[60] overflow-hidden">
      {globos.map((globo) => (
        <motion.div
          key={globo.id}
          className="absolute bottom-0"
          style={{ left: `${globo.izquierda}%` }}
          initial={{ y: 80, x: 0, rotate: 0, opacity: 0 }}
          animate={{ y: "-115vh", x: [0, globo.vaiven, -globo.vaiven / 2, globo.vaiven / 3], rotate: [0, globo.giro, -globo.giro / 2], opacity: [0, 1, 1, 0] }}
          transition={{ duration: globo.duracion, delay: globo.retraso, ease: [0.33, 0, 0.2, 1], opacity: { duration: globo.duracion, delay: globo.retraso, times: [0, 0.08, 0.8, 1] } }}
        >
          <span
            className="block shadow-[inset_-4px_-6px_10px_rgb(0_0_0/0.18),inset_4px_5px_8px_rgb(255_255_255/0.35)]"
            style={{ width: globo.tamano, height: globo.tamano * 1.18, borderRadius: "50% 50% 48% 48% / 55% 55% 45% 45%", background: globo.fondo }}
          />
          {/* Knot and string. */}
          <span className="mx-auto block size-1.5 rotate-45 rounded-[2px]" style={{ background: globo.fondo, marginTop: -2 }} />
          <span className="mx-auto block h-10 w-px bg-texto-tenue/60" />
        </motion.div>
      ))}
    </div>,
    document.body,
  );
}
