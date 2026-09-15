"use client";

import { motion, useReducedMotion } from "motion/react";
import type { MuestraColor } from "@/lib/plan/presentacion-cliente";

type Props = {
  muestras: MuestraColor[];
  /** "juntas": overlapping dots only (proposal card); "etiquetadas": dot + name. */
  variante?: "juntas" | "etiquetadas";
  retraso?: number;
  className?: string;
  etiqueta?: string;
};

/**
 * Color swatches. The dot color is data (the catalog palette, see
 * `muestraColor`), not a theme color; the ring and labels use tokens.
 */
export function MuestrasColor({ muestras, variante = "juntas", retraso = 0, className = "", etiqueta = "Colores" }: Props) {
  const reducir = useReducedMotion();
  if (!muestras.length) return null;
  const entrada = (indice: number) => ({
    initial: reducir ? false : { opacity: 0, y: -12, scale: 0.5 },
    animate: { opacity: 1, y: 0, scale: 1 },
    transition: { type: "spring" as const, stiffness: 420, damping: 18, delay: retraso + indice * 0.12 },
  });
  if (variante === "etiquetadas") {
    return (
      <ul className={`flex flex-wrap items-center gap-x-3.5 gap-y-2 ${className}`} aria-label={etiqueta}>
        {muestras.map((muestra, indice) => (
          <motion.li key={muestra.etiqueta} {...entrada(indice)} className="inline-flex items-center gap-1.5 text-[13px] text-texto">
            <span aria-hidden="true" className={`size-5 shrink-0 rounded-full ${muestra.conBorde ? "ring-1 ring-borde ring-inset" : ""}`} style={{ background: muestra.fondo }} />
            {muestra.etiqueta}
          </motion.li>
        ))}
      </ul>
    );
  }
  return (
    <ul className={`flex items-center ${className}`} aria-label={etiqueta}>
      {muestras.map((muestra, indice) => (
        <motion.li
          key={muestra.etiqueta}
          {...entrada(indice)}
          title={muestra.etiqueta}
          className={`size-4.5 shrink-0 rounded-full border-[1.5px] border-superficie ${muestra.conBorde ? "outline outline-1 -outline-offset-[2.5px] outline-borde" : ""} ${indice > 0 ? "-ml-1" : ""}`}
          style={{ background: muestra.fondo }}
        >
          <span className="sr-only">{muestra.etiqueta}</span>
        </motion.li>
      ))}
    </ul>
  );
}
