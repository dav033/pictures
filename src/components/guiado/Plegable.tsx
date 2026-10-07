"use client";

import { useId, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown } from "lucide-react";
import { DUR, EASE_SALIDA } from "./animacion/movimiento";

/** Panel que se abre y se cierra con altura animada (0 → auto). Solo el contenido; el botón lo pone quien lo usa. */
export function PanelPlegable({ abierto, id, children }: { abierto: boolean; id?: string; children: ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {abierto && (
        <motion.div
          id={id}
          key="panel"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.3, ease: EASE_SALIDA }}
          className="overflow-hidden"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

type Props = {
  titulo: ReactNode;
  /** Línea pequeña bajo el título (chips de dificultad, tiempo…). */
  subtitulo?: ReactNode;
  abiertoInicial?: boolean;
  /** Estilo del contenedor: «tarjeta» con borde; «linea» sin borde para listas internas. */
  variante?: "tarjeta" | "linea";
  children: ReactNode;
};

/** Acordeón accesible (botón con aria-expanded + panel), plegado por defecto. */
export function Plegable({ titulo, subtitulo, abiertoInicial = false, variante = "tarjeta", children }: Props) {
  const [abierto, setAbierto] = useState(abiertoInicial);
  const id = useId();
  return (
    <div className={variante === "tarjeta" ? "rounded-2xl border border-borde-suave bg-superficie" : ""}>
      <button
        type="button"
        aria-expanded={abierto}
        aria-controls={id}
        onClick={() => setAbierto((valor) => !valor)}
        className={`flex min-h-11 w-full items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50 ${variante === "tarjeta" ? "rounded-2xl px-4 py-3" : "rounded-lg py-2"}`}
      >
        <span className="min-w-0 flex-1">
          <span className="block font-medium text-texto">{titulo}</span>
          {subtitulo && <span className="mt-1 block">{subtitulo}</span>}
        </span>
        <motion.span animate={{ rotate: abierto ? 180 : 0 }} transition={{ duration: DUR.corta }} className="shrink-0 text-texto-suave">
          <ChevronDown className="size-5" aria-hidden />
        </motion.span>
      </button>
      <PanelPlegable abierto={abierto} id={id}>
        <div className={variante === "tarjeta" ? "px-4 pb-4" : "pb-2"}>{children}</div>
      </PanelPlegable>
    </div>
  );
}
