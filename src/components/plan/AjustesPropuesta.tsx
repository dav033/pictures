"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowLeftRight, ChevronDown, Palette, Ruler, TriangleAlert, WandSparkles } from "lucide-react";

export type TipoAjuste = "color" | "supuesto" | "tamano" | "faltante";
export type AjustePropuesta = { tipo: TipoAjuste; texto: string };

const ICONO: Record<TipoAjuste, typeof Palette> = {
  color: Palette,
  supuesto: Ruler,
  tamano: ArrowLeftRight,
  faltante: TriangleAlert,
};

/** Rows shown before "Ver N más": enough to read the gist without a wall of text. */
const VISIBLES = 2;

/**
 * Every note the proposal carries (photo colors it could not keep, standard
 * measures it assumed, sizes it swapped, pieces it could not cover) in ONE
 * calm block. It replaces two amber boxes that read like errors and repeated
 * the same thing (2026-09-24). Only what is still missing keeps the warning
 * color: the rest are decisions made on the customer's behalf, not problems.
 */
export function AjustesPropuesta({ ajustes, className = "" }: { ajustes: readonly AjustePropuesta[]; className?: string }) {
  const [abierto, setAbierto] = useState(false);
  const reducir = useReducedMotion();
  if (!ajustes.length) return null;
  // What still blocks the approval goes first.
  const ordenados = [...ajustes].sort((a, b) => Number(b.tipo === "faltante") - Number(a.tipo === "faltante"));
  const visibles = abierto ? ordenados : ordenados.slice(0, VISIBLES);
  const ocultos = ordenados.length - visibles.length;
  return (
    <section
      data-testid="plan-avisos"
      aria-label="Ajustes que hice en la propuesta"
      className={`rounded-2xl bg-superficie-suave px-3.5 py-3 ring-1 ring-borde-suave ring-inset ${className}`}
    >
      <p className="flex items-center gap-1.5 text-xs font-semibold text-texto">
        <WandSparkles className="size-3.5 text-acento" aria-hidden="true" />
        Ajustes que hice
        <span className="rounded-full bg-acento-suave px-1.5 text-[11px] font-semibold tabular-nums text-acento">{ajustes.length}</span>
      </p>
      <ul className="mt-2 space-y-1.5">
        <AnimatePresence initial={false}>
          {visibles.map((ajuste) => {
            const Icono = ICONO[ajuste.tipo];
            return (
              <motion.li
                key={`${ajuste.tipo}:${ajuste.texto}`}
                layout="position"
                initial={reducir ? false : { opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
                className={`flex items-start gap-2 text-xs leading-snug ${ajuste.tipo === "faltante" ? "text-aviso" : "text-texto-suave"}`}
              >
                <Icono className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                <span>{ajuste.texto}</span>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
      {ordenados.length > VISIBLES && (
        <button
          type="button"
          onClick={() => setAbierto((valor) => !valor)}
          aria-expanded={abierto}
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-acento underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento"
        >
          {abierto ? "Ver menos" : `Ver ${ocultos} más`}
          <ChevronDown className={`size-3.5 transition-transform ${abierto ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
      )}
    </section>
  );
}
