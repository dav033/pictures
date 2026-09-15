"use client";

import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight } from "lucide-react";

type Props = {
  onClick: () => void;
  disabled?: boolean;
  ocupado?: boolean;
  /** Shine and pulse only when the action is really available. */
  destacar?: boolean;
  retraso?: number;
  className?: string;
  children: ReactNode;
  "data-testid"?: string;
};

/**
 * Primary "approve" action of the proposal: a light sweep and a soft pulse
 * invite the click once, after the card has settled.
 */
export function BotonAprobar({ onClick, disabled = false, ocupado = false, destacar = true, retraso = 1.6, className = "", children, "data-testid": testId }: Props) {
  const reducir = useReducedMotion();
  const animar = destacar && !disabled && !reducir;
  return (
    <motion.button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      aria-busy={ocupado}
      className={`ui-pressable relative inline-flex h-11 items-center justify-center gap-2 overflow-hidden rounded-[0.8rem] bg-acento px-5.5 text-sm font-semibold whitespace-nowrap text-sobre-acento hover:bg-acento-hover disabled:cursor-not-allowed disabled:opacity-55 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento ${className}`}
      animate={animar ? { boxShadow: ["0 0 0 0px var(--sombra-acento)", "0 0 0 6px var(--sombra-acento)", "0 0 0 12px rgb(0 0 0 / 0)"] } : undefined}
      transition={animar ? { duration: 1.4, delay: retraso + 0.2, repeat: 2, repeatDelay: 4, ease: "easeOut" } : undefined}
    >
      {animar && (
        <motion.span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 w-2/5 bg-linear-to-r from-transparent via-white/35 to-transparent"
          initial={{ x: "-140%" }}
          animate={{ x: "260%" }}
          transition={{ duration: 1.1, delay: retraso, repeat: 2, repeatDelay: 4.3, ease: "easeInOut" }}
        />
      )}
      <span className="relative">{children}</span>
      {!disabled && <ArrowRight className="relative size-4" aria-hidden="true" />}
    </motion.button>
  );
}
