"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { RotateCcw } from "lucide-react";

export type ColorReparto = { etiqueta: string; fondo: string; participacion: number };

type Props = {
  colores: readonly ColorReparto[];
  /** Balloons of the piece, to preview roughly how many each color would get. */
  totalGlobos: number;
  ocupado?: boolean;
  /** New shares (fractions adding up to 1), in the same order as `colores`. */
  onAplicar: (participaciones: number[]) => void;
};

/** Smallest share in whole percent: below it, removing the color is the honest action. */
const MINIMO = 5;

/** Fractions to whole percents that add up to exactly 100 (largest remainder). */
function aPorcentajes(fracciones: readonly number[]): number[] {
  const total = fracciones.reduce((suma, valor) => suma + valor, 0) || 1;
  const exactos = fracciones.map((valor) => (valor / total) * 100);
  const enteros = exactos.map(Math.floor);
  let resto = 100 - enteros.reduce((suma, valor) => suma + valor, 0);
  const orden = exactos.map((valor, indice) => ({ indice, fraccion: valor - Math.floor(valor) })).sort((a, b) => b.fraccion - a.fraccion);
  for (const { indice } of orden) {
    if (resto <= 0) break;
    enteros[indice]! += 1;
    resto -= 1;
  }
  return enteros;
}

/**
 * Colors of one piece as a bar the customer drags: each divider moves the
 * border between two neighbouring colors, by pointer or with the arrow keys
 * (Shift for 5 %). Counts shown while dragging are an estimate; the real ones
 * come back from the resolver when the change is applied.
 */
export function RepartoColores({ colores, totalGlobos, ocupado = false, onAplicar }: Props) {
  const reducir = useReducedMotion();
  const inicial = aPorcentajes(colores.map((color) => color.participacion));
  const [valores, setValores] = useState<number[]>(inicial);
  const [arrastrando, setArrastrando] = useState<number | null>(null);
  const barraRef = useRef<HTMLDivElement>(null);
  const cambiado = valores.some((valor, indice) => valor !== inicial[indice]);

  /** Moves the border after segment `indice` to `limite` percent (cumulative), within the neighbours' minimums. */
  function moverLimite(indice: number, limite: number): void {
    setValores((actuales) => {
      const antes = actuales.slice(0, indice).reduce((suma, valor) => suma + valor, 0);
      const par = actuales[indice]! + actuales[indice + 1]!;
      const izquierda = Math.round(Math.min(Math.max(limite - antes, MINIMO), par - MINIMO));
      if (izquierda === actuales[indice]) return actuales;
      const siguientes = [...actuales];
      siguientes[indice] = izquierda;
      siguientes[indice + 1] = par - izquierda;
      return siguientes;
    });
  }

  function limiteDesdePuntero(evento: PointerEvent<HTMLElement>): number | null {
    const barra = barraRef.current?.getBoundingClientRect();
    if (!barra || barra.width <= 0) return null;
    return ((evento.clientX - barra.left) / barra.width) * 100;
  }

  function teclado(indice: number, evento: KeyboardEvent<HTMLElement>): void {
    const paso = evento.shiftKey ? 5 : 1;
    const delta = evento.key === "ArrowRight" || evento.key === "ArrowUp" ? paso : evento.key === "ArrowLeft" || evento.key === "ArrowDown" ? -paso : 0;
    if (!delta) return;
    evento.preventDefault();
    const limite = valores.slice(0, indice + 1).reduce((suma, valor) => suma + valor, 0);
    moverLimite(indice, limite + delta);
  }

  // Cumulative position of each divider, in percent of the bar.
  const limites = valores.slice(0, -1).map((_, indice) => valores.slice(0, indice + 1).reduce((suma, valor) => suma + valor, 0));
  return (
    <div className="rounded-2xl bg-superficie-suave p-3 ring-1 ring-borde-suave ring-inset">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <p className="text-[13px] font-semibold text-texto">Colores de la pieza</p>
        <p className="text-xs text-texto-suave">Arrastra para cambiar cuánto lleva de cada color</p>
      </div>

      <div ref={barraRef} className="relative mt-3 h-10 touch-none select-none">
        <div className="flex h-full overflow-hidden rounded-full ring-1 ring-black/10">
          {colores.map((color, indice) => (
            <motion.div
              key={`${indice}-${color.etiqueta}`}
              className="relative grid h-full place-items-center"
              style={{ background: color.fondo }}
              animate={{ width: `${valores[indice]}%` }}
              transition={arrastrando !== null || reducir ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 32 }}
            >
              {valores[indice]! >= 12 && (
                <span className="rounded-full bg-black/35 px-1.5 text-[11px] font-semibold tabular-nums text-white">{valores[indice]} %</span>
              )}
            </motion.div>
          ))}
        </div>
        {colores.slice(0, -1).map((color, indice) => {
          const siguiente = colores[indice + 1]!;
          return (
            <span
              key={`limite-${indice}`}
              role="slider"
              tabIndex={ocupado ? -1 : 0}
              aria-label={`Entre ${color.etiqueta} y ${siguiente.etiqueta}`}
              aria-valuemin={MINIMO}
              aria-valuemax={valores[indice]! + valores[indice + 1]! - MINIMO}
              aria-valuenow={valores[indice]}
              aria-valuetext={`${color.etiqueta} ${valores[indice]} %, ${siguiente.etiqueta} ${valores[indice + 1]} %`}
              aria-disabled={ocupado}
              onKeyDown={(evento) => teclado(indice, evento)}
              onPointerDown={(evento) => {
                if (ocupado) return;
                evento.currentTarget.setPointerCapture(evento.pointerId);
                setArrastrando(indice);
              }}
              onPointerMove={(evento) => {
                if (arrastrando !== indice) return;
                const limite = limiteDesdePuntero(evento);
                if (limite !== null) moverLimite(indice, limite);
              }}
              onPointerUp={() => setArrastrando(null)}
              onPointerCancel={() => setArrastrando(null)}
              className={`group absolute top-1/2 z-10 grid h-12 w-7 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize place-items-center focus-visible:outline-none ${ocupado ? "pointer-events-none opacity-60" : ""}`}
              style={{ left: `${limites[indice]}%` }}
            >
              <motion.span
                aria-hidden="true"
                className="block h-8 w-2 rounded-full bg-white shadow-[0_2px_8px_rgb(0_0_0/0.35)] ring-2 ring-transparent group-focus-visible:ring-acento"
                animate={{ scale: arrastrando === indice ? 1.25 : 1 }}
                transition={{ type: "spring", stiffness: 500, damping: 25 }}
              />
            </span>
          );
        })}
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5 text-xs text-texto-suave" aria-label="Globos aproximados por color">
        {colores.map((color, indice) => (
          <li key={`${indice}-${color.etiqueta}`} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="size-3 rounded-full ring-1 ring-black/10" style={{ background: color.fondo }} />
            <span className="text-texto">{color.etiqueta}</span>
            <span className="tabular-nums">≈ {Math.round((totalGlobos * valores[indice]!) / 100)} globos</span>
          </li>
        ))}
      </ul>

      <AnimatePresence initial={false}>
        {cambiado && (
          <motion.div
            initial={reducir ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-texto-suave">Las cantidades exactas y el precio se recalculan al aplicar.</p>
              <div className="flex gap-2">
                <button type="button" disabled={ocupado} onClick={() => setValores(inicial)} className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-texto-suave hover:text-texto disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-acento">
                  <RotateCcw className="size-3.5" aria-hidden="true" />Restablecer
                </button>
                <button type="button" disabled={ocupado} onClick={() => onAplicar(valores.map((valor) => valor / 100))} className="ui-pressable inline-flex h-8 items-center rounded-lg bg-acento px-3 text-xs font-semibold text-sobre-acento hover:bg-acento-hover disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento">
                  {ocupado ? "Aplicando…" : "Aplicar colores"}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
