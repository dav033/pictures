"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { estiloRecorte, posicionCentrada, type CajaNormalizada } from "./recorte";

type Props = {
  src: string;
  caja: CajaNormalizada;
  alt: string;
  /** Frame size and shape come from the caller (e.g. "h-41 w-28 rounded-xl"). */
  className?: string;
  /** Seconds to wait before the reveal, to follow the card cascade. */
  retraso?: number;
  /** Reveal from the bottom with a slow zoom-out, as in the proposal mock-up. */
  revelar?: boolean;
};

/**
 * One detected piece of the customer's photo, cropped on the client from its
 * `reference_bbox` (no extra request). Before the photo reports its natural
 * size, it shows `object-fit: cover` centered on the piece.
 */
export function RecortePieza({ src, caja, alt, className = "", retraso = 0, revelar = true }: Props) {
  const marcoRef = useRef<HTMLDivElement>(null);
  const imagenRef = useRef<HTMLImageElement>(null);
  const [natural, setNatural] = useState<{ ancho: number; alto: number } | null>(null);
  const [aspecto, setAspecto] = useState<number | null>(null);
  const reducir = useReducedMotion();

  const medir = useCallback(() => {
    const marco = marcoRef.current;
    if (marco && marco.clientWidth > 0 && marco.clientHeight > 0) setAspecto(marco.clientWidth / marco.clientHeight);
  }, []);

  useEffect(() => {
    const marco = marcoRef.current;
    if (!marco || typeof ResizeObserver === "undefined") return;
    const observador = new ResizeObserver(() => {
      medir();
      // A cached photo can finish loading before React attaches onLoad.
      const imagen = imagenRef.current;
      if (imagen?.complete && imagen.naturalWidth > 0) setNatural({ ancho: imagen.naturalWidth, alto: imagen.naturalHeight });
    });
    observador.observe(marco);
    return () => observador.disconnect();
  }, [medir]);

  const estilo = natural && aspecto ? estiloRecorte(caja, natural, aspecto) : null;
  const animado = revelar && !reducir;

  return (
    <div ref={marcoRef} className={`relative overflow-hidden bg-superficie-2 ${className}`}>
      <motion.img
        ref={imagenRef}
        src={src}
        alt={alt}
        draggable={false}
        onLoad={(evento) => {
          const imagen = evento.currentTarget;
          setNatural({ ancho: imagen.naturalWidth, alto: imagen.naturalHeight });
          medir();
        }}
        initial={animado ? { clipPath: "inset(100% 0% 0% 0%)", scale: 1.22 } : false}
        animate={{ clipPath: "inset(0% 0% 0% 0%)", scale: 1 }}
        transition={{ clipPath: { duration: 0.9, delay: retraso, ease: [0.65, 0, 0.35, 1] }, scale: { duration: 2.4, delay: retraso, ease: "easeOut" } }}
        style={estilo
          ? { position: "absolute", maxWidth: "none", ...estilo, transformOrigin: "50% 30%" }
          : { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: posicionCentrada(caja), transformOrigin: "50% 30%" }}
      />
    </div>
  );
}
