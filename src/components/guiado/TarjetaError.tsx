"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { CloudOff, LoaderCircle, RefreshCw, RotateCcw, X } from "lucide-react";
import { DUR, EASE_SALIDA, RESORTE } from "./animacion/movimiento";

type Props = {
  titulo: string;
  detalle?: string;
  /** Texto del botón: «Reintentar», «Reintentar imagen», «Volver a preparar el plan»… */
  reintentarEtiqueta?: string;
  reintentando?: boolean;
  /** Repite LA ACCIÓN que falló (no el último texto del cliente). */
  onReintentar: () => void;
  onCerrar?: () => void;
  /** Otras salidas, como chips: «Ver otras ideas», «Escribir otra cosa»… */
  alternativas?: ReadonlyArray<{ etiqueta: string; onElegir: () => void }>;
  /**
   * «actualizar»: no es un error del cliente ni de la red, sino una página nueva («Hay una versión nueva… Recargar»):
   * va en el color de acento, sin la sacudida ni la nube tachada.
   */
  variante?: "error" | "actualizar";
};

/** Un fallo dentro del hilo, con su salida: nunca un callejón sin salida. */
export function TarjetaError({ titulo, detalle, reintentarEtiqueta = "Reintentar", reintentando = false, onReintentar, onCerrar, alternativas, variante = "error" }: Props) {
  const reducido = useReducedMotion();
  const [giros, setGiros] = useState(0);
  const actualizar = variante === "actualizar";
  return (
    <motion.div
      role="alert"
      initial={{ opacity: 0, y: 8 }}
      animate={reducido || actualizar ? { opacity: 1, y: 0 } : { opacity: 1, y: 0, x: [0, -4, 4, -2, 0] }}
      transition={{ opacity: { duration: DUR.corta }, y: { duration: DUR.media, ease: EASE_SALIDA }, x: { duration: 0.35, delay: 0.15 } }}
      className={`relative mt-3 w-full rounded-2xl border p-4 ${actualizar ? "border-acento/25 bg-acento-suave" : "border-error/25 bg-error-suave"}`}
      data-variante={variante}
    >
      {onCerrar && (
        <button type="button" onClick={onCerrar} aria-label="Cerrar aviso" className={`absolute right-1.5 top-1.5 grid size-11 place-items-center rounded-full text-texto-suave transition-colors hover:text-texto focus-visible:outline-none focus-visible:ring-2 ${actualizar ? "focus-visible:ring-acento/50" : "focus-visible:ring-error/50"}`}>
          <X className="size-4" aria-hidden />
        </button>
      )}
      <div className={`flex gap-3 ${onCerrar ? "pr-9" : ""}`}>
        <span className={`grid size-9 shrink-0 place-items-center rounded-xl bg-superficie/70 ${actualizar ? "text-acento" : "text-error"}`} aria-hidden>
          {actualizar ? <RefreshCw className="size-5" /> : <CloudOff className="size-5" />}
        </span>
        <div className="min-w-0">
          <p className="font-semibold text-texto">{titulo}</p>
          {detalle && <p className="mt-0.5 text-sm text-texto-suave">{detalle}</p>}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <motion.button
          type="button"
          disabled={reintentando}
          onClick={() => { setGiros((valor) => valor + 1); onReintentar(); }}
          whileTap={{ scale: 0.97 }}
          transition={RESORTE}
          className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-fondo disabled:opacity-70 ${actualizar ? "bg-acento text-sobre-acento focus-visible:ring-acento/50" : "bg-error text-fondo focus-visible:ring-error/50"}`}
        >
          {reintentando
            ? <LoaderCircle className="size-4 animate-spin" aria-hidden />
            : <motion.span className="inline-flex" animate={{ rotate: giros * -360 }} transition={{ duration: reducido ? 0 : 0.5, ease: EASE_SALIDA }}>{actualizar ? <RefreshCw className="size-4" aria-hidden /> : <RotateCcw className="size-4" aria-hidden />}</motion.span>}
          {reintentando ? "Reintentando…" : reintentarEtiqueta}
        </motion.button>
        {alternativas?.map((alternativa) => (
          <button
            key={alternativa.etiqueta}
            type="button"
            onClick={alternativa.onElegir}
            disabled={reintentando}
            className="min-h-11 rounded-full border border-borde bg-superficie px-4 text-sm font-medium text-texto transition-colors hover:border-acento hover:text-acento focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/40 disabled:opacity-50"
          >
            {alternativa.etiqueta}
          </button>
        ))}
      </div>
    </motion.div>
  );
}
