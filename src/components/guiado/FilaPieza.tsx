"use client";

import { useMemo, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Pencil } from "lucide-react";
import { BarraTamanos } from "@/components/plan/BarraTamanos";
import { CifraAnimada } from "./ajuste/AjustarPlan";
import { DUR, EASE_REBOTE, RESORTE } from "./animacion/movimiento";
import { medidasEnPalabras } from "./formato";
import { GloboMiniatura } from "./GloboMiniatura";
import { globosPorColor, tramosDe, type PiezaVista } from "./piezas-vista";

/**
 * Una pieza de «Tu plan» (o de una idea): su dibujo, nombre, medidas, mezcla de tamaños y globos por color (cada color
 * con su globo Sempertex dibujado). El dibujo llega hecho (`GraficaMotorGuiada` en el plan, `IconoEstructura` en la
 * idea). Con `onModificar`, el dibujo es un botón que abre la pieza para cambiarla y `accion` pone el botón visible.
 */
export function FilaPieza({ pieza, dibujo, indice, recalculando = false, onModificar, accion }: {
  pieza: PiezaVista;
  dibujo: ReactNode;
  indice: number;
  recalculando?: boolean;
  /** Abre la pieza grande para modificarla (solo en el plan vigente). */
  onModificar?: () => void;
  /** Botón visible bajo los colores (p. ej. «Modificar»). */
  accion?: ReactNode;
}) {
  const porColor = useMemo(() => globosPorColor(pieza.lineas), [pieza.lineas]);
  const tramos = useMemo(() => tramosDe(pieza.lineas), [pieza.lineas]);
  const medidas = medidasEnPalabras(pieza.medidas);
  const marco = "grid size-20 place-items-center overflow-hidden rounded-xl bg-superficie-2 p-1.5 text-acento sm:size-24";
  return (
    <li className="grid grid-cols-[5rem_1fr] gap-3 rounded-2xl bg-superficie-suave p-3 sm:grid-cols-[6rem_1fr]">
      {onModificar ? (
        <motion.button
          type="button"
          onClick={onModificar}
          whileTap={{ scale: 0.96 }}
          transition={RESORTE}
          aria-label={`Modificar ${pieza.nombre}`}
          className={`group relative ${marco} ring-1 ring-transparent transition-shadow hover:ring-acento/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/60`}
        >
          {dibujo}
          <span aria-hidden className="absolute bottom-1 right-1 grid size-6 place-items-center rounded-full bg-superficie text-acento shadow-[0_1px_3px_var(--sombra)] ring-1 ring-borde-suave transition-transform group-hover:scale-110">
            <Pencil className="size-3.5" />
          </span>
        </motion.button>
      ) : (
        <span className={marco}>{dibujo}</span>
      )}
      <div className="min-w-0">
        <p className="font-medium leading-snug text-texto">{pieza.repeticiones > 1 ? `${pieza.repeticiones} × ` : ""}{pieza.nombre}</p>
        <p className="text-xs text-texto-suave">{medidas ?? "Medida según el espacio"}</p>
        {tramos.length > 0 && <BarraTamanos tramos={tramos} retraso={0.25 + indice * 0.12} className="mt-2" descripcion={`Globos de ${tramos.map((tramo) => tramo.pulgadas).join(", ")} pulgadas`} />}
        {recalculando ? (
          <span className="mt-2 flex flex-wrap gap-1.5" aria-hidden>
            {(porColor.length ? porColor : [{ color: "" }]).map((globo, posicion) => <span key={`${globo.color}-${posicion}`} className="brillo-carga h-5 w-20 rounded-full" />)}
          </span>
        ) : porColor.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Globos por color">
            <AnimatePresence initial={false}>
              {porColor.map((globo) => (
                <motion.li
                  key={globo.color}
                  layout="position"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ duration: DUR.media, ease: EASE_REBOTE }}
                  className="inline-flex items-center gap-1 rounded-full bg-superficie py-0.5 pl-1 pr-2 text-xs text-texto tabular-nums ring-1 ring-borde-suave"
                >
                  <GloboMiniatura hex={globo.hex} acabado={globo.acabado} pulgadas={globo.pulgadas} tamano={16} className="shrink-0" />
                  {globo.etiqueta} <CifraAnimada valor={globo.cantidad} />
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
        {accion && <div className="mt-2">{accion}</div>}
      </div>
    </li>
  );
}
