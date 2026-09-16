"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";

export type PasoAsistente = { id: string; texto: string; estado: "en_curso" | "listo" | "fallido" };

type Props = {
  pasos: PasoAsistente[];
  className?: string;
};

function Indicador({ estado }: { estado: PasoAsistente["estado"] }) {
  const reducir = useReducedMotion();
  return (
    <span className="relative inline-grid size-4 shrink-0 place-items-center" aria-hidden="true">
      <AnimatePresence initial={false} mode="popLayout">
        {estado === "en_curso" ? (
          <motion.svg
            key="girando"
            viewBox="0 0 16 16"
            className="size-4"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1, rotate: reducir ? 0 : 360 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ rotate: { duration: 0.9, ease: "linear", repeat: Infinity }, default: { duration: 0.2 } }}
          >
            <circle cx="8" cy="8" r="6" fill="none" strokeWidth="2" className="stroke-borde" />
            <path d="M8 2a6 6 0 016 6" fill="none" strokeWidth="2" strokeLinecap="round" className="stroke-acento" />
          </motion.svg>
        ) : estado === "fallido" ? (
          /* Un paso que devolvio `ok:false` no puede llevar el check verde: el
             cliente leia "Arme la propuesta" sin propuesta ninguna. */
          <motion.svg
            key="fallido"
            viewBox="0 0 16 16"
            className="size-4"
            initial={{ opacity: 0, scale: 0.4 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: "spring", stiffness: 520, damping: 22 }}
          >
            <circle cx="8" cy="8" r="7" className="fill-error-suave" />
            <motion.path
              d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8"
              fill="none"
              strokeWidth="1.6"
              strokeLinecap="round"
              className="stroke-error"
              initial={{ pathLength: reducir ? 1 : 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.3, delay: 0.08 }}
            />
          </motion.svg>
        ) : (
          <motion.svg
            key="listo"
            viewBox="0 0 16 16"
            className="size-4"
            initial={{ opacity: 0, scale: 0.4 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: "spring", stiffness: 520, damping: 22 }}
          >
            <circle cx="8" cy="8" r="7" className="fill-exito-suave" />
            <motion.path
              d="M5 8.2l2 2 4-4.2"
              fill="none"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="stroke-exito"
              initial={{ pathLength: reducir ? 1 : 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.3, delay: 0.08 }}
            />
          </motion.svg>
        )}
      </AnimatePresence>
    </span>
  );
}

/**
 * Live assistant steps built from the chat's `herramienta` SSE events
 * (maqueta ChatNormal). Each step enters from above and swaps its spinner for
 * a check when it finishes.
 */
export function PasosAsistente({ pasos, className = "" }: Props) {
  if (!pasos.length) return null;
  return (
    <ol className={`flex flex-col gap-2 ${className}`} aria-label="Lo que está haciendo el asistente">
        <AnimatePresence initial={false}>
          {pasos.map((paso) => (
            <motion.li
              key={paso.id}
              layout="position"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
              className="flex items-center gap-2 text-[13px] text-texto-suave"
            >
              <Indicador estado={paso.estado} />
              <span className={paso.estado === "en_curso" ? "text-texto" : paso.estado === "fallido" ? "text-error" : undefined}>{paso.texto}</span>
              <span className="sr-only">{paso.estado === "listo" ? "(listo)" : paso.estado === "fallido" ? "(no se pudo)" : "(en curso)"}</span>
            </motion.li>
          ))}
        </AnimatePresence>
    </ol>
  );
}
