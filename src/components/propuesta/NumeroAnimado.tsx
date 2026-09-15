"use client";

import { useLayoutEffect, useRef } from "react";
import { animate, useReducedMotion } from "motion/react";

const NUMERO = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });
const PESOS = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

type Props = {
  valor: number;
  /** "pesos" renders "$ 142.300"; the default renders "142.300". */
  formato?: "numero" | "pesos";
  /** Seconds before counting starts, to follow the card cascade. */
  retraso?: number;
  duracion?: number;
  className?: string;
};

function formatear(valor: number, formato: "numero" | "pesos"): string {
  return formato === "pesos" ? PESOS.format(valor) : NUMERO.format(valor);
}

/**
 * Counts up to `valor`. The markup always carries the final value (server
 * render, tests, screen readers); the count only rewrites the text on the
 * client and is skipped with `prefers-reduced-motion`.
 */
export function NumeroAnimado({ valor, formato = "numero", retraso = 0, duracion = 1.1, className }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  // Last value on screen: a new value counts from there, and a StrictMode
  // remount (which cancels the first run) still counts from zero.
  const mostrado = useRef(0);
  const reducir = useReducedMotion();

  useLayoutEffect(() => {
    const nodo = ref.current;
    if (!nodo) return;
    const desde = mostrado.current;
    if (reducir || desde === valor) {
      mostrado.current = valor;
      nodo.textContent = formatear(valor, formato);
      return;
    }
    nodo.textContent = formatear(desde, formato);
    const control = animate(desde, valor, {
      duration: duracion,
      delay: retraso,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (actual) => {
        mostrado.current = Math.round(actual);
        nodo.textContent = formatear(mostrado.current, formato);
      },
      onComplete: () => {
        mostrado.current = valor;
        nodo.textContent = formatear(valor, formato);
      },
    });
    return () => control.stop();
  }, [valor, formato, reducir, retraso, duracion]);

  return <span ref={ref} className={className}>{formatear(valor, formato)}</span>;
}
