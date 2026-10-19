"use client";

import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { RotateCcw } from "lucide-react";
import { EASE_SALIDA, RESORTE } from "./animacion/movimiento";

type Props = {
  abierto: boolean;
  /** Hay un plan: se dice que también se borra. */
  conPlan: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
};

/**
 * «Empezar de nuevo» del menú «Más opciones» (probador 124, hallazgo 15): se confirma DENTRO de la página, nunca con un
 * diálogo del navegador. El foco entra en «Seguir con esta» (lo que no borra nada), Escape y el fondo cancelan, y Tab
 * no se sale de los dos botones mientras está abierto.
 */
export function ConfirmarEmpezarDeNuevo({ abierto, conPlan, onConfirmar, onCancelar }: Props) {
  const reducido = useReducedMotion();
  const id = useId();
  const cancelarRef = useRef<HTMLButtonElement>(null);
  const confirmarRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const cuadro = requestAnimationFrame(() => cancelarRef.current?.focus());
    return () => cancelAnimationFrame(cuadro);
  }, [abierto]);

  function alTeclear(evento: KeyboardEvent<HTMLDivElement>): void {
    if (evento.key === "Escape") {
      evento.preventDefault();
      onCancelar();
      return;
    }
    if (evento.key !== "Tab") return;
    const botones = [cancelarRef.current, confirmarRef.current].filter((boton): boton is HTMLButtonElement => boton !== null);
    const actual = botones.indexOf(document.activeElement as HTMLButtonElement);
    evento.preventDefault();
    botones[(actual + (evento.shiftKey ? -1 : 1) + botones.length) % botones.length]?.focus();
  }

  return (
    <AnimatePresence>
      {abierto && (
        <div key="empezar-de-nuevo" className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center" data-testid="confirmar-empezar-de-nuevo">
          <motion.button
            type="button"
            aria-label="Seguir con esta conversación"
            tabIndex={-1}
            onClick={onCancelar}
            className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          />
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={`${id}-titulo`}
            aria-describedby={`${id}-detalle`}
            onKeyDown={alTeclear}
            initial={reducido ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reducido ? { opacity: 0 } : { opacity: 0, y: 16 }}
            transition={{ duration: 0.28, ease: EASE_SALIDA }}
            className="relative w-full max-w-md rounded-3xl border border-borde-suave bg-superficie p-5 shadow-[0_16px_48px_var(--sombra)]"
          >
            <span className="grid size-10 place-items-center rounded-2xl bg-acento-suave text-acento" aria-hidden>
              <RotateCcw className="size-5" />
            </span>
            <h2 id={`${id}-titulo`} className="mt-3 text-lg font-semibold leading-snug text-texto">¿Empezar de nuevo?</h2>
            <p id={`${id}-detalle`} className="mt-1 text-sm leading-relaxed text-texto-suave">
              {conPlan ? "Se borran esta conversación y tu plan, y vuelves al inicio." : "Se borra esta conversación y vuelves al inicio."} No se puede deshacer.
            </p>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <motion.button
                ref={cancelarRef}
                type="button"
                onClick={onCancelar}
                whileTap={{ scale: 0.97 }}
                transition={RESORTE}
                className="min-h-11 whitespace-nowrap rounded-xl border border-borde bg-superficie px-4 text-sm font-semibold text-texto transition-colors hover:border-acento hover:text-acento focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50"
              >
                Seguir con esta
              </motion.button>
              <motion.button
                ref={confirmarRef}
                type="button"
                onClick={onConfirmar}
                whileTap={{ scale: 0.97 }}
                transition={RESORTE}
                className="inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-error px-4 text-sm font-semibold text-fondo transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error/50 focus-visible:ring-offset-2 focus-visible:ring-offset-superficie"
              >
                <RotateCcw className="size-4" aria-hidden />
                Sí, empezar de nuevo
              </motion.button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
