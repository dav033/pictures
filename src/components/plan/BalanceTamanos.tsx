"use client";

import { useId, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { RotateCcw } from "lucide-react";
import { reglasMezclas, type Mezcla } from "@/lib/plan/mezclas";
import { BarraTamanos, tramosPorTamano } from "./BarraTamanos";

/** Mixes from the smallest average balloon to the largest (≈10.5″, 12″, ≈13.7″, ≈20.4″). */
const ESCALA: ReadonlyArray<{ mezcla: Mezcla; etiqueta: string; detalle: string }> = [
  { mezcla: "organica_fina", etiqueta: "Más pequeños", detalle: "Muchos globos chicos que rellenan y pocos grandes de acento" },
  { mezcla: "clasica", etiqueta: "Todos de 12″", detalle: "Un solo tamaño, parejo y ordenado" },
  { mezcla: "organica_gruesa", etiqueta: "Más grandes", detalle: "Menos globos chicos y más volumen" },
  { mezcla: "solo_grandes", etiqueta: "Solo grandes", detalle: "Globos de 18″ y 24″, pocos y llamativos" },
];

type Props = {
  mezcla: Mezcla;
  totalGlobos: number;
  ocupado?: boolean;
  onAplicar: (mezcla: Mezcla) => void;
};

/**
 * Size balance of one piece: a four-step slider from "más pequeños" to "solo
 * grandes" over the existing mixes, with the size bar as a live preview. The
 * preview uses the mix proportions; the resolver counts the real balloons.
 */
export function BalanceTamanos({ mezcla, totalGlobos, ocupado = false, onAplicar }: Props) {
  const reducir = useReducedMotion();
  const id = useId();
  const inicial = Math.max(0, ESCALA.findIndex((paso) => paso.mezcla === mezcla));
  const [paso, setPaso] = useState(inicial);
  const elegido = ESCALA[paso]!;
  const proporciones = reglasMezclas().mezclas[elegido.mezcla];
  const tramos = tramosPorTamano(proporciones.map((tamano) => ({ pulgadas: tamano.pulgadas, unidades: Math.max(1, Math.round(totalGlobos * tamano.proporcion)) })));
  const cambiado = paso !== inicial;

  return (
    <div className="rounded-2xl bg-superficie-suave p-3 ring-1 ring-borde-suave ring-inset">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <label htmlFor={`${id}-balance`} className="text-[13px] font-semibold text-texto">Tamaños de los globos</label>
        <AnimatePresence mode="wait" initial={false}>
          <motion.p key={elegido.mezcla} initial={reducir ? false : { opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }} transition={{ duration: 0.18 }} className="text-xs text-texto-suave">
            {elegido.detalle}
          </motion.p>
        </AnimatePresence>
      </div>
      <input
        id={`${id}-balance`}
        type="range"
        min={0}
        max={ESCALA.length - 1}
        step={1}
        value={paso}
        disabled={ocupado}
        onChange={(evento) => setPaso(Number(evento.target.value))}
        aria-valuetext={elegido.etiqueta}
        className="mt-3 w-full accent-[var(--acento)] disabled:opacity-60"
      />
      <div className="mt-1 grid grid-cols-4 text-[11px] text-texto-suave" aria-hidden="true">
        {ESCALA.map((opcion, indice) => (
          <button
            key={opcion.mezcla}
            type="button"
            tabIndex={-1}
            disabled={ocupado}
            onClick={() => setPaso(indice)}
            className={`${indice === 0 ? "text-left" : indice === ESCALA.length - 1 ? "text-right" : "text-center"} ${indice === paso ? "font-semibold text-acento" : "hover:text-texto"}`}
          >
            {opcion.etiqueta}
          </button>
        ))}
      </div>
      <div className="mt-3">
        <BarraTamanos key={elegido.mezcla} tramos={tramos} variante="detalle" retraso={0} />
      </div>

      <AnimatePresence initial={false}>
        {cambiado && (
          <motion.div initial={reducir ? false : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-texto-suave">Cambiar los tamaños cambia cuántos globos lleva la pieza y su precio; se recalculan al aplicar.</p>
              <div className="flex gap-2">
                <button type="button" disabled={ocupado} onClick={() => setPaso(inicial)} className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-texto-suave hover:text-texto disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-acento">
                  <RotateCcw className="size-3.5" aria-hidden="true" />Restablecer
                </button>
                <button type="button" disabled={ocupado} onClick={() => onAplicar(elegido.mezcla)} className="ui-pressable inline-flex h-8 items-center rounded-lg bg-acento px-3 text-xs font-semibold text-sobre-acento hover:bg-acento-hover disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento">
                  {ocupado ? "Aplicando…" : "Aplicar tamaños"}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
