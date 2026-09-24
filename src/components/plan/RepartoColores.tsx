"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { motion, useReducedMotion } from "motion/react";
import { useAutoguardado } from "./usarAutoguardado";
import { EstadoGuardado, vistaDeAutoguardado } from "./EstadoGuardado";
import type { PendientesAjustes } from "./cola-ajustes";

export type ColorReparto = { etiqueta: string; fondo: string; participacion: number };

type Props = {
  colores: readonly ColorReparto[];
  /** Balloons of the piece, to preview roughly how many each color would get. */
  totalGlobos: number;
  ocupado?: boolean;
  /** Saves new shares (fractions adding up to 1, in `colores` order); resolves the reason when it was not saved. */
  onGuardar: (participaciones: number[]) => Promise<string | null>;
  /** The card's count of unsaved changes: approving waits for this one too. */
  pendientes?: PendientesAjustes;
};

/** Smallest share in whole percent: below it, removing the color is the honest action. */
const MINIMO = 5;
/** Arrow keys save after this pause, so holding one is a single edit. */
const ESPERA_TECLADO_MS = 600;
/** Local values stay on screen while they are not in the plan yet. */
const FASES_PROPIAS = new Set(["esperando", "guardando", "error", "rechazado"]);

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

function mismosValores(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((valor, indice) => valor === b[indice]);
}

/** `actuales` with the border after segment `indice` moved to `limite` percent (cumulative), within the neighbours' minimums. */
function conLimite(actuales: readonly number[], indice: number, limite: number): readonly number[] {
  const antes = actuales.slice(0, indice).reduce((suma, valor) => suma + valor, 0);
  const par = actuales[indice]! + actuales[indice + 1]!;
  const izquierda = Math.round(Math.min(Math.max(limite - antes, MINIMO), par - MINIMO));
  if (izquierda === actuales[indice]) return actuales;
  const siguientes = [...actuales];
  siguientes[indice] = izquierda;
  siguientes[indice + 1] = par - izquierda;
  return siguientes;
}

/**
 * Colors of one piece as a bar the customer drags: each divider moves the
 * border between two neighbouring colors, by pointer or with the arrow keys
 * (Shift for 5 %). Counts shown while dragging are an estimate. The change is
 * saved on its own when the divider is released (or after a short pause with
 * the keyboard); the real counts come back from the resolver.
 */
export function RepartoColores({ colores, totalGlobos, ocupado = false, onGuardar, pendientes }: Props) {
  const reducir = useReducedMotion();
  const enPlan = aPorcentajes(colores.map((color) => color.participacion));
  const clavePlan = enPlan.join(",");
  const [local, setLocal] = useState<readonly number[] | null>(null);
  const [arrastrando, setArrastrando] = useState<number | null>(null);
  // Latest values while dragging: several pointer moves can arrive before React paints.
  const arrastreRef = useRef<readonly number[] | null>(null);
  const barraRef = useRef<HTMLDivElement>(null);
  const { estado, control } = useAutoguardado<readonly number[]>({
    enPlan,
    iguales: mismosValores,
    esperaMs: ESPERA_TECLADO_MS,
    guardar: (valores) => onGuardar(valores.map((valor) => valor / 100)),
    pendientes,
  });
  const valores = local && (arrastrando !== null || FASES_PROPIAS.has(estado.fase)) ? local : enPlan;

  // Another edit (or "Deshacer") changed the plan: what it carries now is the reference.
  useEffect(() => {
    control.sincronizar(clavePlan.split(",").map(Number));
  }, [control, clavePlan]);

  function limiteDesdePuntero(evento: PointerEvent<HTMLElement>): number | null {
    const barra = barraRef.current?.getBoundingClientRect();
    if (!barra || barra.width <= 0) return null;
    return ((evento.clientX - barra.left) / barra.width) * 100;
  }

  function soltar(): void {
    const final = arrastreRef.current;
    arrastreRef.current = null;
    setArrastrando(null);
    if (final) control.cambiar(final, { inmediato: true });
  }

  function teclado(indice: number, evento: KeyboardEvent<HTMLElement>): void {
    if (ocupado) return;
    const paso = evento.shiftKey ? 5 : 1;
    const delta = evento.key === "ArrowRight" || evento.key === "ArrowUp" ? paso : evento.key === "ArrowLeft" || evento.key === "ArrowDown" ? -paso : 0;
    if (!delta) return;
    evento.preventDefault();
    const limite = valores.slice(0, indice + 1).reduce((suma, valor) => suma + valor, 0);
    const siguientes = conLimite(valores, indice, limite + delta);
    if (siguientes === valores) return;
    setLocal(siguientes);
    control.cambiar(siguientes);
  }

  // Cumulative position of each divider, in percent of the bar.
  const limites = valores.slice(0, -1).map((_, indice) => valores.slice(0, indice + 1).reduce((suma, valor) => suma + valor, 0));
  return (
    <div className="rounded-2xl bg-superficie-suave p-3 ring-1 ring-borde-suave ring-inset" data-testid="reparto-colores">
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
                arrastreRef.current = valores;
                setLocal(valores);
                setArrastrando(indice);
              }}
              onPointerMove={(evento) => {
                const actuales = arrastreRef.current;
                if (arrastrando !== indice || !actuales) return;
                const limite = limiteDesdePuntero(evento);
                if (limite === null) return;
                const siguientes = conLimite(actuales, indice, limite);
                if (siguientes === actuales) return;
                arrastreRef.current = siguientes;
                setLocal(siguientes);
              }}
              onPointerUp={soltar}
              onPointerCancel={soltar}
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

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <ul className="flex flex-wrap gap-x-3 gap-y-1.5 text-xs text-texto-suave" aria-label="Globos aproximados por color">
          {colores.map((color, indice) => (
            <li key={`${indice}-${color.etiqueta}`} className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="size-3 rounded-full ring-1 ring-black/10" style={{ background: color.fondo }} />
              <span className="text-texto">{color.etiqueta}</span>
              <span className="tabular-nums">≈ {Math.round((totalGlobos * valores[indice]!) / 100)} globos</span>
            </li>
          ))}
        </ul>
        <EstadoGuardado estado={vistaDeAutoguardado(estado, "Guardado", control.reintentar)} efimero compacto className="ml-auto" data-testid="estado-reparto-colores" />
      </div>
    </div>
  );
}
