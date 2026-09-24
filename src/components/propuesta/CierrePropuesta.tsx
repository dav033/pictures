"use client";

import { motion, useReducedMotion } from "motion/react";
import { Download, PartyPopper, ReceiptText } from "lucide-react";

type Props = {
  /** Data URL of the latest image of the approved proposal. */
  imagen: string;
  totalCop?: number;
};

const pesos = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

/** File extension from a `data:image/...` URL, so the download opens where it lands. */
function extension(dataUrl: string): string {
  const tipo = /^data:image\/([a-z0-9+.-]+);/i.exec(dataUrl)?.[1]?.toLowerCase();
  return tipo === "jpeg" ? "jpg" : tipo ?? "png";
}

/**
 * The end of the journey. Approving used to finish with a button that said
 * "Aprobación registrada" and nothing after the image: this closes it with a
 * clear state and the two things a customer wants next, keeping the image and
 * seeing the final quote. Downloading is local (the image is already here).
 */
export function CierrePropuesta({ imagen, totalCop }: Props) {
  const reducir = useReducedMotion();
  function verCotizacion(): void {
    const reducido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.querySelector("[data-testid='tarjeta-cotizacion']")?.scrollIntoView({ behavior: reducido ? "auto" : "smooth", block: "center" });
  }
  return (
    <motion.div
      data-testid="cierre-propuesta"
      initial={reducir ? false : { opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 320, damping: 24, delay: reducir ? 0 : 0.3 }}
      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-acento-suave px-4 py-3 ring-1 ring-acento/20 ring-inset"
    >
      <div className="flex items-center gap-2.5">
        <motion.span
          className="grid size-9 shrink-0 place-items-center rounded-full bg-acento text-sobre-acento"
          initial={reducir ? false : { rotate: -25, scale: 0.6 }}
          animate={{ rotate: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 380, damping: 12, delay: reducir ? 0 : 0.45 }}
          aria-hidden="true"
        >
          <PartyPopper className="size-4.5" />
        </motion.span>
        <div>
          <p className="text-sm font-semibold text-texto">¡Tu propuesta está lista!</p>
          <p className="text-xs text-texto-suave">{totalCop != null ? `Total ${pesos.format(totalCop)} · ` : ""}la imagen y la cotización quedaron guardadas aquí.</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <a
          href={imagen}
          download={`propuesta-decoracion.${extension(imagen)}`}
          className="ui-pressable inline-flex h-9 items-center gap-1.5 rounded-xl bg-acento px-3.5 text-[13px] font-semibold text-sobre-acento hover:bg-acento-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento"
        >
          <Download className="size-4" aria-hidden="true" />
          Descargar imagen
        </a>
        <button
          type="button"
          onClick={verCotizacion}
          className="ui-pressable inline-flex h-9 items-center gap-1.5 rounded-xl bg-superficie px-3.5 text-[13px] font-medium text-acento ring-1 ring-borde-suave ring-inset hover:bg-superficie-suave focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento"
        >
          <ReceiptText className="size-4" aria-hidden="true" />
          Ver cotización final
        </button>
      </div>
    </motion.div>
  );
}
