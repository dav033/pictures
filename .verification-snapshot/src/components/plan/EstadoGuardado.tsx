"use client";

import { motion, useReducedMotion } from "motion/react";
import { Check, LoaderCircle, RotateCcw, TriangleAlert } from "lucide-react";
import type { EstadoAutoguardado } from "./autoguardado";

/** Lo que dice un control que guarda solo. `null`: nada que decir (aún no hubo cambios). */
export type VistaEstadoGuardado =
  | { tipo: "guardando" }
  | { tipo: "guardado"; texto: string }
  | { tipo: "error"; motivo: string; onReintentar?: () => void }
  | null;

/** Estado del autoguardado para la vista: esperar la pausa ya es "Guardando…"; un rechazo no se reintenta igual. */
export function vistaDeAutoguardado(estado: EstadoAutoguardado, textoGuardado: string, onReintentar: () => void): VistaEstadoGuardado {
  switch (estado.fase) {
    case "esperando":
    case "guardando":
      return { tipo: "guardando" };
    case "guardado":
      return { tipo: "guardado", texto: textoGuardado };
    case "error":
      return { tipo: "error", motivo: estado.motivo ?? "", onReintentar };
    case "rechazado":
      return { tipo: "error", motivo: estado.motivo ?? "" };
    case "quieto":
      return null;
  }
}

type Props = {
  estado: VistaEstadoGuardado;
  /** "Guardado" se desvanece solo (los deslizadores); en el editor queda a la vista. */
  efimero?: boolean;
  compacto?: boolean;
  className?: string;
  "data-testid"?: string;
};

/**
 * Estado del autoguardado, anunciado con cortesía (`aria-live="polite"`): la
 * región existe siempre para que el lector de pantalla oiga cada cambio.
 */
export function EstadoGuardado({ estado, efimero = false, compacto = false, className = "", "data-testid": testId }: Props) {
  const reducir = useReducedMotion();
  const texto = compacto ? "text-[11px]" : "text-xs";
  const icono = compacto ? "size-3" : "size-3.5";
  const clave = estado ? (estado.tipo === "error" ? `error:${estado.motivo}` : estado.tipo) : "nada";
  return (
    <div role="status" aria-live="polite" data-testid={testId} data-estado={estado?.tipo ?? "quieto"} className={`min-w-0 ${texto} ${className}`}>
      {/* Each state replaces the previous one at once and fades in: no gap where the status says nothing. */}
      {estado && (
        <motion.div
          key={clave}
          initial={reducir ? false : { opacity: 0 }}
          animate={efimero && estado.tipo === "guardado" && !reducir ? { opacity: [0, 1, 1, 0] } : { opacity: 1 }}
          transition={efimero && estado.tipo === "guardado" ? { duration: 3, times: [0, 0.05, 0.8, 1] } : { duration: 0.15 }}
          className="flex min-w-0 items-center gap-1.5"
        >
          {estado.tipo === "guardando" && (
            <>
              <LoaderCircle className={`${icono} shrink-0 animate-spin text-acento motion-reduce:animate-none`} aria-hidden="true" />
              <span className="text-texto-suave">Guardando…</span>
            </>
          )}
          {estado.tipo === "guardado" && (
            <>
              <Check className={`${icono} shrink-0 text-exito`} aria-hidden="true" />
              <span className="truncate text-texto-suave">{estado.texto}</span>
            </>
          )}
          {estado.tipo === "error" && (
            <>
              <TriangleAlert className={`${icono} shrink-0 self-start text-error ${compacto ? "mt-px" : "mt-0.5"}`} aria-hidden="true" />
              <span className="line-clamp-2 min-w-0 font-medium text-error" title={estado.motivo}>No se guardó: {estado.motivo}</span>
              {estado.onReintentar && (
                <button
                  type="button"
                  onClick={estado.onReintentar}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-semibold text-acento underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-acento"
                >
                  <RotateCcw className={icono} aria-hidden="true" />Reintentar
                </button>
              )}
            </>
          )}
        </motion.div>
      )}
    </div>
  );
}
