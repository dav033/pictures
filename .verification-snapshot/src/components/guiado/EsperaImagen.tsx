"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { EASE_SALIDA } from "./animacion/movimiento";

/**
 * La espera de «Ver cómo quedaría» en la guiada, como la de la clásica (`CargaImagen`: un arco de globos de los
 * colores de la propuesta que se construye mientras cambia la fase): un lienzo que se va pintando con los colores del
 * plan, los dibujos del motor de sus piezas apareciendo de abajo arriba, globos que se inflan y flotan, y una frase
 * corta que cambia. Pedido del dueño (2026-10-07): «un poco de feedback visual al momento de crear la imagen, así como
 * en el clásico, nada muy verídico, para que el usuario se distraiga mientras espera».
 *
 * Nada aquí mide el avance real (el proveedor no lo informa): sin porcentajes ni tiempos prometidos. Con movimiento
 * reducido todo queda quieto (las frases cambian sin desplazarse y más despacio). Solo transform y opacidad: liviano
 * en un móvil. Para lectores de pantalla, un único estado discreto; las frases que rotan van ocultas.
 */

/** La primera vuelta cuenta una historia; después rotan frases que no prometen cuánto falta. */
export const FRASES_INICIO_ESPERA = [
  "Preparando el lienzo",
  "Dibujando tus piezas",
  "Colocando los globos",
  "Pintando con tus colores",
  "Probando la luz del salón",
  "Acomodando cada detalle",
] as const;
export const FRASES_RONDA_ESPERA = ["Últimos detalles", "Puliendo los brillos", "Revisando cada globo"] as const;

export function fraseEsperaImagen(paso: number): string {
  const indice = Math.max(0, Math.floor(paso));
  if (indice < FRASES_INICIO_ESPERA.length) return FRASES_INICIO_ESPERA[indice]!;
  return FRASES_RONDA_ESPERA[(indice - FRASES_INICIO_ESPERA.length) % FRASES_RONDA_ESPERA.length]!;
}

const PASO_MS = 3_200;
const PASO_REDUCIDO_MS = 5_000;
const COLORES_RESPALDO = ["var(--acento)", "var(--acento-2)", "#f4c542", "#ffffff"] as const;
const HEX = /^#[0-9a-fA-F]{6}$/;

/** Globos del lienzo (viewBox 300 × 225, el 4:3 de la imagen): arriba y a los lados, para no tapar las piezas. */
const GLOBOS = [
  { x: 46, y: 50, r: 15 }, { x: 254, y: 46, r: 16 }, { x: 92, y: 30, r: 12 }, { x: 206, y: 28, r: 13 },
  { x: 150, y: 22, r: 14 }, { x: 22, y: 104, r: 12 }, { x: 278, y: 100, r: 13 }, { x: 124, y: 58, r: 10 },
  { x: 178, y: 60, r: 11 },
] as const;

const CHISPAS = [{ x: 70, y: 84, retraso: 0.4 }, { x: 232, y: 80, retraso: 1.3 }, { x: 150, y: 50, retraso: 2.1 }] as const;

export type PiezaEnEspera = { id: string; nombre: string; dibujo: ReactNode };

type Props = {
  /** Tonos del plan (`#rrggbb`, los mismos con que pinta el motor): globos y lienzo salen de ellos. */
  colores: readonly string[];
  /** El dibujo del motor de cada pieza (el de «Tu plan», ya en caché: no se pide otra vez). Se muestran hasta tres. */
  piezas?: readonly PiezaEnEspera[];
};

export function EsperaImagen({ colores, piezas = [] }: Props) {
  const reducido = Boolean(useReducedMotion());
  const id = useId().replace(/:/g, "");
  const [paso, setPaso] = useState(0);
  useEffect(() => {
    const reloj = window.setInterval(() => setPaso((actual) => actual + 1), reducido ? PASO_REDUCIDO_MS : PASO_MS);
    return () => window.clearInterval(reloj);
  }, [reducido]);
  const validos = [...new Set(colores.filter((color) => HEX.test(color)))];
  const paleta: readonly string[] = validos.length ? validos : COLORES_RESPALDO;
  const frase = fraseEsperaImagen(paso);
  const visibles = piezas.slice(0, 3);
  const mancha = (indice: number) => paleta[indice % paleta.length]!;

  return (
    // El estado envuelve toda la espera (la vista la centra en pantalla al pedir la imagen desde el chat o la barra).
    // Un solo anuncio, discreto: el lienzo y sus frases que rotan van ocultos para el lector de pantalla.
    <div role="status" aria-live="polite" className="space-y-2">
      <span className="sr-only">Dibujando cómo quedaría tu decoración.</span>
      <div
        data-testid="espera-imagen"
        aria-hidden="true"
        className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-superficie-2 ring-1 ring-borde-suave ring-inset"
      >
        {/* El lienzo: rejilla de boceto y manchas de los colores del plan que se van asentando. */}
        <svg viewBox="0 0 300 225" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 size-full">
          <defs>
            <pattern id={`rejilla-${id}`} width="18" height="18" patternUnits="userSpaceOnUse">
              <path d="M18 0H0V18" fill="none" stroke="var(--acento)" strokeOpacity="0.1" strokeWidth="1" />
            </pattern>
            {[0, 1, 2].map((indice) => (
              <radialGradient key={indice} id={`mancha-${id}-${indice}`} cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor={mancha(indice)} stopOpacity="0.55" />
                <stop offset="100%" stopColor={mancha(indice)} stopOpacity="0" />
              </radialGradient>
            ))}
            <radialGradient id={`brillo-${id}`} cx="32%" cy="28%" r="65%">
              <stop offset="0%" stopColor="white" stopOpacity="0.75" />
              <stop offset="45%" stopColor="white" stopOpacity="0.12" />
              <stop offset="100%" stopColor="black" stopOpacity="0.16" />
            </radialGradient>
          </defs>
          <rect width="300" height="225" fill={`url(#rejilla-${id})`} />
          {[{ cx: 60, cy: 70, r: 120 }, { cx: 250, cy: 60, r: 110 }, { cx: 150, cy: 210, r: 140 }].map((zona, indice) => (
            <motion.circle
              key={indice}
              cx={zona.cx}
              cy={zona.cy}
              r={zona.r}
              fill={`url(#mancha-${id}-${indice})`}
              initial={reducido ? false : { opacity: 0 }}
              animate={{ opacity: 0.6 }}
              transition={{ duration: 6, delay: indice * 1.4, ease: EASE_SALIDA }}
            />
          ))}
          {/* Los globos se inflan uno a uno y quedan flotando. */}
          {GLOBOS.map((globo, indice) => (
            <motion.g
              key={indice}
              initial={reducido ? false : { opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.5 + indice * 1.1, duration: 0.6, ease: [0.34, 1.56, 0.64, 1] }}
              style={{ transformBox: "fill-box", transformOrigin: "center" }}
            >
              <motion.g
                animate={reducido ? undefined : { y: [0, -4, 0] }}
                transition={reducido ? undefined : { duration: 3 + (indice % 3) * 0.6, repeat: Infinity, ease: "easeInOut", delay: indice * 0.3 }}
              >
                <path
                  d={`M ${globo.x} ${globo.y + globo.r} q ${globo.r * 0.35} ${globo.r * 0.9} ${-globo.r * 0.1} ${globo.r * 1.9}`}
                  fill="none"
                  stroke="var(--texto-suave)"
                  strokeOpacity="0.45"
                  strokeWidth="0.8"
                />
                <ellipse cx={globo.x} cy={globo.y} rx={globo.r * 0.88} ry={globo.r} style={{ fill: mancha(indice) }} stroke="var(--borde)" strokeOpacity="0.5" strokeWidth="0.6" />
                <ellipse cx={globo.x} cy={globo.y} rx={globo.r * 0.88} ry={globo.r} fill={`url(#brillo-${id})`} />
                <path d={`M ${globo.x - 2} ${globo.y + globo.r + 2.2} L ${globo.x} ${globo.y + globo.r - 0.6} L ${globo.x + 2} ${globo.y + globo.r + 2.2} Z`} style={{ fill: mancha(indice) }} />
                <ellipse cx={globo.x - globo.r * 0.32} cy={globo.y - globo.r * 0.42} rx={globo.r * 0.2} ry={globo.r * 0.13} fill="white" fillOpacity="0.8" />
              </motion.g>
            </motion.g>
          ))}
          {!reducido && CHISPAS.map((chispa) => (
            <motion.path
              key={`${chispa.x}-${chispa.y}`}
              d={`M ${chispa.x} ${chispa.y - 5} L ${chispa.x + 1.4} ${chispa.y - 1.4} L ${chispa.x + 5} ${chispa.y} L ${chispa.x + 1.4} ${chispa.y + 1.4} L ${chispa.x} ${chispa.y + 5} L ${chispa.x - 1.4} ${chispa.y + 1.4} L ${chispa.x - 5} ${chispa.y} L ${chispa.x - 1.4} ${chispa.y - 1.4} Z`}
              fill="var(--acento-2)"
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: [0, 1, 0], scale: [0, 1, 0] }}
              transition={{ duration: 2.4, repeat: Infinity, delay: chispa.retraso, ease: "easeInOut" }}
              style={{ transformBox: "fill-box", transformOrigin: "center" }}
            />
          ))}
        </svg>

        {/* Las piezas del plan, con el dibujo del motor: aparecen y se «pintan» de abajo arriba. */}
        {visibles.length > 0 && (
          <div className="absolute inset-x-3 bottom-11 top-[30%] flex items-end justify-center gap-2">
            {visibles.map((pieza, indice) => (
              <motion.div
                key={pieza.id}
                className="relative h-full min-w-0 flex-1 overflow-hidden"
                style={{ maxWidth: visibles.length === 1 ? "55%" : "33%" }}
                initial={reducido ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 + indice * 1.4, duration: 0.5, ease: EASE_SALIDA }}
              >
                <div className="size-full">{pieza.dibujo}</div>
                {/* El velo del color del lienzo baja como una brocha: primero se ve el boceto, luego la pieza pintada. */}
                <motion.div
                  className="absolute inset-0 bg-superficie-2/80"
                  style={{ transformOrigin: "top" }}
                  initial={reducido ? false : { scaleY: 1 }}
                  animate={{ scaleY: 0 }}
                  transition={{ delay: 1.2 + indice * 1.4, duration: 2.6, ease: "easeInOut" }}
                />
              </motion.div>
            ))}
          </div>
        )}

        {/* La frase que cambia, sin tiempos ni porcentajes. */}
        <div className="absolute inset-x-3 bottom-3 flex justify-center">
          <span className="inline-flex max-w-full items-center gap-2 rounded-full bg-superficie/90 px-3 py-1.5 text-xs font-medium text-texto shadow-[0_1px_2px_var(--sombra)] ring-1 ring-borde-suave">
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={frase}
                className="truncate"
                initial={reducido ? false : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reducido ? { opacity: 1 } : { opacity: 0, y: -4 }}
                transition={{ duration: reducido ? 0 : 0.25 }}
              >
                {frase}
              </motion.span>
            </AnimatePresence>
            <span className="puntos shrink-0"><span /><span /><span /></span>
          </span>
        </div>
      </div>
      <p className="text-xs text-texto-suave">Puedes seguir mirando tu plan mientras tanto.</p>
    </div>
  );
}
