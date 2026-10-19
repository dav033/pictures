"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { DUR } from "./animacion/movimiento";

/** Qué se le dice al cliente según cuánto lleva esperando (segundos desde que apareció el indicador). */
const MENSAJES: Record<"respuesta" | "foto", ReadonlyArray<{ desde: number; texto: string }>> = {
  respuesta: [
    { desde: 4, texto: "Pensando en ideas para tu celebración…" },
    { desde: 10, texto: "Sigue en ello, un momento…" },
  ],
  foto: [
    { desde: 0, texto: "Mirando tu foto…" },
    { desde: 6, texto: "Contando las piezas y los colores…" },
  ],
};

/**
 * «El asistente está escribiendo»: tres puntos visibles en claro y en oscuro y, si la espera se alarga, una línea
 * que dice qué está pasando. Con movimiento reducido, los puntos quedan quietos y solo cambia el texto.
 */
export function IndicadorEscribiendo({ fase = "respuesta" }: { fase?: "respuesta" | "foto" }) {
  const reducido = useReducedMotion();
  const [segundos, setSegundos] = useState(0);
  useEffect(() => {
    const inicio = Date.now();
    const reloj = window.setInterval(() => setSegundos(Math.floor((Date.now() - inicio) / 1000)), 500);
    return () => window.clearInterval(reloj);
  }, [fase]);
  const texto = [...MENSAJES[fase]].reverse().find((mensaje) => segundos >= mensaje.desde)?.texto ?? null;

  return (
    <div role="status" aria-live="polite" className="flex flex-col items-start gap-1.5">
      <motion.span
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, transition: { duration: DUR.micro } }}
        style={{ transformOrigin: "0% 0%" }}
        className="inline-flex items-center gap-1.5 rounded-2xl rounded-tl-md bg-superficie-2 px-3.5 py-3"
      >
        <span className="sr-only">El asistente está escribiendo</span>
        {[0, 1, 2].map((indice) => (
          <motion.span
            key={indice}
            aria-hidden
            className="size-2 rounded-full bg-texto-suave"
            animate={reducido ? { opacity: 0.7 } : { y: [0, -4, 0], opacity: [0.35, 1, 0.35] }}
            transition={reducido ? { duration: 0 } : { duration: 0.9, repeat: Infinity, ease: "easeInOut", delay: indice * 0.15 }}
          />
        ))}
      </motion.span>
      <AnimatePresence mode="wait" initial={false}>
        {texto && (
          <motion.span
            key={texto}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: DUR.corta }}
            className="pl-1 text-xs text-texto-suave"
          >
            {texto}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}
