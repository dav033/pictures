"use client";

/* The optional thumbnail is a local data URL or public asset. */
/* eslint-disable @next/next/no-img-element */

import type { ReactNode } from "react";
import { motion } from "motion/react";
import { CircleAlert, ImageOff } from "lucide-react";

export type AccionEstado = { texto: string; onClick: () => void; disabled?: boolean };

type Props = {
  titulo: string;
  mensaje: string;
  accion?: AccionEstado;
  accionSecundaria?: AccionEstado;
  /** "aviso" for a degraded but usable result (image service down); "error" by default. */
  tono?: "error" | "aviso";
  /** Thumbnail of the photo that failed, when there is one. */
  imagen?: { src: string; alt: string };
  /** Extra content under the message (e.g. example photos to pick). */
  children?: ReactNode;
  className?: string;
};

/**
 * Waiting and error states from the `Estados` mock-up: a short Spanish title,
 * one sentence, and always a next step. Never shows raw technical errors; the
 * caller passes already translated `ui-error` messages.
 */
export function EstadoError({ titulo, mensaje, accion, accionSecundaria, tono = "error", imagen, children, className = "" }: Props) {
  const Icono = tono === "aviso" ? ImageOff : CircleAlert;
  return (
    <motion.section
      role={tono === "error" ? "alert" : "status"}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
      className={`flex items-start gap-3.5 rounded-2xl border border-borde-suave bg-superficie p-4 shadow-[0_1px_2px_var(--sombra)] ${className}`}
    >
      {imagen ? (
        <img src={imagen.src} alt={imagen.alt} width={72} height={52} className="h-13 w-18 shrink-0 rounded-xl object-cover" />
      ) : (
        <span aria-hidden="true" className={`grid size-10 shrink-0 place-items-center rounded-xl ${tono === "aviso" ? "bg-aviso-suave text-aviso" : "bg-error-suave text-error"}`}>
          <Icono className="size-4.5" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium text-texto">{titulo}</p>
        <p className="mt-0.5 text-[13px] leading-snug text-texto-suave">{mensaje}</p>
        {children && <div className="mt-3">{children}</div>}
        {(accion || accionSecundaria) && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {accion && (
              <button type="button" onClick={accion.onClick} disabled={accion.disabled} className="ui-pressable inline-flex h-9 items-center rounded-xl bg-acento px-3.5 text-[13px] font-semibold text-sobre-acento hover:bg-acento-hover disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento">
                {accion.texto}
              </button>
            )}
            {accionSecundaria && (
              <button type="button" onClick={accionSecundaria.onClick} disabled={accionSecundaria.disabled} className="ui-pressable inline-flex h-9 items-center rounded-xl border border-borde bg-superficie px-3.5 text-[13px] font-medium text-acento hover:bg-acento-suave disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento">
                {accionSecundaria.texto}
              </button>
            )}
          </div>
        )}
      </div>
    </motion.section>
  );
}
