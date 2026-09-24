"use client";

import { useRef, type KeyboardEvent } from "react";
import type { ColorLeyenda } from "./leyenda";

const TAMANOS = {
  xs: "size-4 text-[9px]",
  sm: "size-5 text-[10px]",
  md: "size-7 text-[11px]",
  lg: "size-9 text-[13px]",
} as const;

/**
 * Globo de la gráfica numerada: la muestra del color (dato de catálogo, con
 * su degradado de cromado o perlado) y el número de la leyenda encima.
 */
export function MuestraNumero({ color, tamano = "md", conNumero = true, className = "" }: { color: ColorLeyenda; tamano?: keyof typeof TAMANOS; conNumero?: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-full font-semibold leading-none tabular-nums shadow-[inset_-2px_-3px_5px_rgb(0_0_0/0.16),inset_2px_2px_4px_rgb(255_255_255/0.32)] ${TAMANOS[tamano]} ${color.numeroClaro ? "text-white [text-shadow:0_1px_1px_rgb(0_0_0/0.5)]" : "text-black/75"} ${color.muestra.conBorde || color.numeroClaro ? "border border-borde" : ""} ${className}`}
      style={{ background: color.muestra.fondo }}
    >
      {conNumero ? color.numero : null}
    </span>
  );
}

type Props = {
  leyenda: readonly ColorLeyenda[];
  /** Con `onPincel` la leyenda es el selector del color del pincel. */
  pincel?: number;
  onPincel?: (indice: number) => void;
  etiqueta?: string;
  className?: string;
};

/**
 * "1 Blanco · 2 Negro · 3 Azul" (curso Sempertex). Estática en la hoja de
 * armado; en el editor es un grupo de radio para elegir el color del pincel,
 * con foco itinerante y flechas.
 */
export function LeyendaPatron({ leyenda, pincel, onPincel, etiqueta = "Leyenda de colores", className = "" }: Props) {
  const botones = useRef<Array<HTMLButtonElement | null>>([]);
  if (!onPincel) {
    return (
      <ul aria-label={etiqueta} className={`flex flex-wrap items-center gap-x-3.5 gap-y-1.5 ${className}`}>
        {leyenda.map((color) => (
          <li key={color.indice} className="inline-flex items-center gap-1.5 text-[13px] text-texto">
            <MuestraNumero color={color} tamano="sm" />
            <span><span className="sr-only">{color.numero}: </span>{color.etiqueta}</span>
          </li>
        ))}
      </ul>
    );
  }
  const activo = leyenda.some((color) => color.indice === pincel) ? pincel : leyenda[0]?.indice;
  function teclado(evento: KeyboardEvent<HTMLButtonElement>, posicion: number): void {
    const delta = evento.key === "ArrowRight" || evento.key === "ArrowDown" ? 1 : evento.key === "ArrowLeft" || evento.key === "ArrowUp" ? -1 : 0;
    if (!delta) return;
    evento.preventDefault();
    const siguiente = (posicion + delta + leyenda.length) % leyenda.length;
    onPincel?.(leyenda[siguiente]!.indice);
    botones.current[siguiente]?.focus();
  }
  return (
    <div role="radiogroup" aria-label={etiqueta} className={`flex flex-wrap gap-1.5 ${className}`}>
      {leyenda.map((color, posicion) => {
        const elegido = color.indice === activo;
        return (
          <button
            key={color.indice}
            ref={(nodo) => { botones.current[posicion] = nodo; }}
            type="button"
            role="radio"
            aria-checked={elegido}
            tabIndex={elegido ? 0 : -1}
            onClick={() => onPincel(color.indice)}
            onKeyDown={(evento) => teclado(evento, posicion)}
            className={`inline-flex min-h-9 items-center gap-1.5 rounded-full py-1 pl-1 pr-3 text-[13px] ring-1 ring-inset transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento ${elegido ? "bg-acento-suave font-semibold text-texto ring-2 ring-acento" : "bg-superficie text-texto ring-borde-suave hover:bg-superficie-suave"}`}
          >
            <MuestraNumero color={color} />
            {color.etiqueta}
          </button>
        );
      })}
    </div>
  );
}
