"use client";

import type { ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Calculator, Check, ChevronUp, GraduationCap, PenLine, ShoppingBag, Sparkles, UserRound } from "lucide-react";
import type { AccionPlan } from "./TarjetaPlan";
import { RESORTE } from "./animacion/movimiento";

type Props = {
  /** Se muestra cuando hay un plan vigente y su tarjeta quedó fuera de la vista. */
  visible: boolean;
  titulo: string;
  totalGlobos: number;
  ocupado: boolean;
  hechas: readonly AccionPlan[];
  onAccion: (accion: AccionPlan) => void;
  onIrAlPlan: () => void;
};

const ACCIONES: ReadonlyArray<{ accion: AccionPlan; etiqueta: string; icono: ReactNode }> = [
  { accion: "ver", etiqueta: "Ver cómo quedaría", icono: <Sparkles className="size-4" aria-hidden /> },
  { accion: "costear", etiqueta: "Cuánto cuesta", icono: <Calculator className="size-4" aria-hidden /> },
  { accion: "comprar", etiqueta: "Comprar", icono: <ShoppingBag className="size-4" aria-hidden /> },
  { accion: "aprender", etiqueta: "Aprender", icono: <GraduationCap className="size-4" aria-hidden /> },
  { accion: "contratar", etiqueta: "Decorador", icono: <UserRound className="size-4" aria-hidden /> },
  { accion: "cambiar", etiqueta: "Cambiar algo", icono: <PenLine className="size-4" aria-hidden /> },
];

/** Franja sobre el compositor con el plan vigente y sus acciones: siempre hay un siguiente paso a la vista. */
export function BarraPlanVigente({ visible, titulo, totalGlobos, ocupado, hechas, onAccion, onIrAlPlan }: Props) {
  return (
    <AnimatePresence initial={false}>
      {visible && (
        <motion.div
          key="barra-plan"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={RESORTE}
          className="mx-auto w-full max-w-3xl px-4 pb-1.5 sm:px-6"
          role="region"
          aria-label="Tu plan"
        >
          <div className="rounded-2xl border border-borde-suave bg-superficie/95 p-1.5 shadow-[0_8px_24px_var(--sombra)] backdrop-blur">
            <button
              type="button"
              onClick={onIrAlPlan}
              className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-xl px-2.5 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50"
            >
              <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-acento">Tu plan</span>
              <span className="min-w-0 flex-1 truncate text-texto">
                <span className="font-medium">{totalGlobos.toLocaleString("es-CO")} {totalGlobos === 1 ? "globo" : "globos"}</span>
                <span className="text-texto-suave"> · {titulo}</span>
              </span>
              <ChevronUp className="size-4 shrink-0 text-texto-suave" aria-hidden />
              <span className="sr-only">Ir al plan</span>
            </button>
            <div className="flex gap-2 overflow-x-auto px-1 pb-0.5 [mask-image:linear-gradient(to_right,black_calc(100%-20px),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {ACCIONES.map(({ accion, etiqueta, icono }) => (
                <motion.button
                  key={accion}
                  type="button"
                  disabled={ocupado}
                  onClick={() => onAccion(accion)}
                  whileTap={ocupado ? undefined : { scale: 0.95 }}
                  transition={RESORTE}
                  className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/40 disabled:opacity-50 ${accion === "ver" ? "border-acento bg-acento text-sobre-acento" : "border-borde bg-superficie text-texto hover:border-acento hover:text-acento"}`}
                >
                  {hechas.includes(accion) ? <Check className="size-4" aria-hidden /> : icono}
                  <span className="whitespace-nowrap">{etiqueta}</span>
                </motion.button>
              ))}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
