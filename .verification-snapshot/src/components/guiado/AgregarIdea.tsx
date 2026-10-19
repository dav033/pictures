"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowDown, Check, Info, Loader2, Plus } from "lucide-react";
import { DUR, EASE_REBOTE, EASE_SALIDA, RESORTE } from "./animacion/movimiento";
import type { EstadoIdeaEnPlan } from "./agregar-idea";

/**
 * Botones de «Agregar al plan» (pedido 3): el grande de la tarjeta de la idea elegida y el discreto del carrusel. Solo
 * pintan el estado; lo decide VistaGuiada con `propuestaAgregarIdea` (agregar-idea.ts).
 */

export type EstadoAgregarIdea = EstadoIdeaEnPlan;

export type AccionAgregarIdea = {
  /** «Agregar a mi plan» o «Crear mi plan con esta idea». */
  etiqueta: string;
  /** Lo que dice el botón mientras se calcula («Agregando a tu plan…»). */
  etiquetaCargando: string;
  /** Qué va a pasar («Tu plan quedará con 3 piezas…»). */
  ayuda?: string;
  estado: EstadoAgregarIdea;
  /** Por qué no se puede ahora (estado «bloqueada») y qué hacer. */
  motivo?: string;
  /** Otra acción en curso (otro plan, una respuesta): el botón espera sin perder su estado. */
  deshabilitado: boolean;
  onAgregar: () => void;
  onVerPlan?: (() => void) | undefined;
};

/**
 * Lo mismo sin los manejadores, que VistaGuiada pasa como props de primer nivel (`onAgregar`, `onVerPlan`): dentro de un
 * objeto, el compilador de React supone que se llaman al pintar y esos manejadores leen refs.
 */
export type DatosAgregarIdea = Omit<AccionAgregarIdea, "onAgregar" | "onVerPlan">;

const BASE_BOTON = "flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl px-4 text-[0.95rem] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50 focus-visible:ring-offset-2 focus-visible:ring-offset-superficie";

/** El llamado a la acción de la tarjeta de la idea: agrega sus piezas al plan (o lo crea), con su estado a la vista. */
export function BotonAgregarIdea({ etiqueta, etiquetaCargando, ayuda, estado, motivo, deshabilitado, onAgregar, onVerPlan }: AccionAgregarIdea) {
  const reducido = useReducedMotion();
  const entrada = { initial: { opacity: 0, y: reducido ? 0 : 6 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: reducido ? 0 : -4 }, transition: { duration: DUR.corta, ease: EASE_SALIDA } };
  return (
    <div className="mt-4 border-t border-borde-suave pt-4" data-testid="agregar-idea">
      <AnimatePresence mode="wait" initial={false}>
        {estado === "agregada" ? (
          <motion.div key="agregada" {...entrada} className="flex flex-wrap items-center gap-2" role="status">
            <motion.span
              initial={reducido ? false : { scale: 0.7 }}
              animate={{ scale: 1 }}
              transition={{ duration: 0.4, ease: EASE_REBOTE }}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-exito-suave px-3 text-sm font-semibold text-exito"
            >
              <Check className="size-4" aria-hidden />
              Está en tu plan
            </motion.span>
            {onVerPlan && (
              <button type="button" onClick={onVerPlan} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-acento transition-colors hover:bg-acento-suave focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50">
                Ver mi plan
                <ArrowDown className="size-4" aria-hidden />
              </button>
            )}
          </motion.div>
        ) : estado === "bloqueada" ? (
          <motion.div key="bloqueada" {...entrada}>
            <button type="button" disabled className={`${BASE_BOTON} cursor-not-allowed border border-borde bg-superficie-2 text-texto-suave`}>
              <Plus className="size-5" aria-hidden />
              {etiqueta}
            </button>
            {motivo && <p className="mt-2 flex gap-1.5 text-xs leading-relaxed text-texto-suave"><Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />{motivo}</p>}
          </motion.div>
        ) : (
          <motion.div key="accion" {...entrada}>
            <motion.button
              type="button"
              onClick={onAgregar}
              disabled={deshabilitado || estado === "agregando"}
              aria-busy={estado === "agregando"}
              whileTap={deshabilitado || estado === "agregando" ? undefined : { scale: 0.97 }}
              transition={RESORTE}
              className={`${BASE_BOTON} bg-acento text-sobre-acento shadow-[0_6px_18px_-8px_var(--acento)] hover:bg-acento-hover disabled:cursor-not-allowed disabled:opacity-70 disabled:shadow-none`}
            >
              {estado === "agregando"
                ? <><Loader2 className="size-5 animate-spin motion-reduce:animate-none" aria-hidden />{etiquetaCargando}</>
                : <><Plus className="size-5" aria-hidden />{etiqueta}</>}
            </motion.button>
            {ayuda && <p className="mt-2 text-center text-xs leading-relaxed text-texto-suave">{ayuda}</p>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Versión discreta para el carrusel de ideas: no compite con «Me gusta esta». Nada si la idea no se puede agregar. */
export function BotonAgregarCarrusel({ estado, deshabilitado, onAgregar }: { estado: EstadoAgregarIdea; deshabilitado: boolean; onAgregar: () => void }) {
  if (estado === "bloqueada") return null;
  // Ya en el plan: el mismo botón, desactivado y con su check (probador 124, hallazgo 11). Agregarla otra vez duplicaría
  // sus piezas.
  if (estado === "agregada") {
    return (
      <button type="button" disabled aria-disabled="true" className="mt-2 inline-flex min-h-11 w-full cursor-default items-center justify-center gap-1.5 rounded-xl border border-exito/30 bg-exito-suave px-3 text-sm font-semibold text-exito">
        <Check className="size-4" aria-hidden />Está en tu plan
      </button>
    );
  }
  const agregando = estado === "agregando";
  return (
    <motion.button
      type="button"
      onClick={onAgregar}
      disabled={deshabilitado || agregando}
      aria-busy={agregando}
      whileTap={deshabilitado || agregando ? undefined : { scale: 0.97 }}
      transition={RESORTE}
      className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-acento/40 bg-superficie px-3 text-sm font-semibold text-acento transition-colors hover:border-acento hover:bg-acento-suave focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {agregando
        ? <><Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />Agregando…</>
        : <><Plus className="size-4" aria-hidden />Agregar a mi plan</>}
    </motion.button>
  );
}
