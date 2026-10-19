import type { Transition, Variants } from "motion/react";

/**
 * Vocabulario de movimiento de la vista guiada: una sola fuente para curvas, resortes y entradas, para que
 * mensajes, tarjetas y chips se muevan igual. Las claves de variante son siempre "oculto" y "visible".
 * El <MotionConfig reducedMotion="user"> de layout.tsx ya anula transform y layout cuando el sistema pide
 * reducir movimiento; contadores, scroll y bucles usan además useReducedMotion().
 */
export const EASE_SALIDA: [number, number, number, number] = [0.23, 1, 0.32, 1];
export const EASE_REBOTE: [number, number, number, number] = [0.34, 1.4, 0.64, 1];

export const RESORTE: Transition = { type: "spring", stiffness: 420, damping: 34, mass: 0.7 };
export const RESORTE_SUAVE: Transition = { type: "spring", stiffness: 260, damping: 30 };

export const DUR = { micro: 0.12, corta: 0.2, media: 0.32, larga: 0.45 } as const;

export const entradaMensaje: Variants = {
  oculto: { opacity: 0, y: 12, filter: "blur(4px)" },
  visible: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: DUR.larga, ease: EASE_SALIDA, when: "beforeChildren", staggerChildren: 0.06 },
  },
};

export const entradaUsuario: Variants = {
  oculto: { opacity: 0, x: 16, scale: 0.96 },
  visible: { opacity: 1, x: 0, scale: 1, transition: RESORTE },
};

export const grupoEscalonado: Variants = {
  oculto: {},
  visible: { transition: { staggerChildren: 0.06, delayChildren: 0.08 } },
};

export const hijoEscalonado: Variants = {
  oculto: { opacity: 0, y: 10, scale: 0.98 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { duration: DUR.media, ease: EASE_SALIDA } },
};

/** Grupo con otro ritmo (chips 0,04; tarjetas 0,08): mismas claves, distinto stagger. */
export function grupoConRitmo(stagger: number, retraso = 0): Variants {
  return { oculto: {}, visible: { transition: { staggerChildren: stagger, delayChildren: retraso } } };
}
