"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { Minus, Plus } from "lucide-react";
import type { ColorLeyenda } from "./leyenda";
import { MuestraNumero } from "./LeyendaPatron";

/** Flechas de un grupo de radio: mueve y elige el vecino, dando la vuelta. */
function flechas(evento: KeyboardEvent<HTMLElement>, posicion: number, total: number): number | null {
  const delta = evento.key === "ArrowRight" || evento.key === "ArrowDown" ? 1 : evento.key === "ArrowLeft" || evento.key === "ArrowUp" ? -1 : 0;
  if (!delta || total === 0) return null;
  evento.preventDefault();
  return (posicion + delta + total) % total;
}

/** Elige un color de la leyenda: una fila de muestras numeradas (grupo de radio). */
export function SelectorColor({ leyenda, valor, onCambiar, etiqueta, deshabilitado = false }: {
  leyenda: readonly ColorLeyenda[];
  valor: number;
  onCambiar: (indice: number) => void;
  etiqueta: string;
  deshabilitado?: boolean;
}) {
  const botones = useRef<Array<HTMLButtonElement | null>>([]);
  const activo = leyenda.some((color) => color.indice === valor) ? valor : leyenda[0]?.indice;
  return (
    <div role="radiogroup" aria-label={etiqueta} className="flex flex-wrap gap-1">
      {leyenda.map((color, posicion) => {
        const elegido = color.indice === activo;
        return (
          <button
            key={color.indice}
            ref={(nodo) => { botones.current[posicion] = nodo; }}
            type="button"
            role="radio"
            aria-checked={elegido}
            aria-label={`${color.numero} ${color.etiqueta}`}
            title={color.etiqueta}
            tabIndex={elegido ? 0 : -1}
            disabled={deshabilitado}
            onClick={() => onCambiar(color.indice)}
            onKeyDown={(evento) => {
              const siguiente = flechas(evento, posicion, leyenda.length);
              if (siguiente === null) return;
              onCambiar(leyenda[siguiente]!.indice);
              botones.current[siguiente]?.focus();
            }}
            className={`grid size-9 place-items-center rounded-full transition-[box-shadow,transform] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento disabled:opacity-50 ${elegido ? "ring-2 ring-acento ring-offset-2 ring-offset-superficie" : "hover:scale-105"}`}
          >
            <MuestraNumero color={color} />
          </button>
        );
      })}
    </div>
  );
}

/** Número con − y + ("3 racimos"), para cantidades pequeñas y acotadas. */
export function Contador({ valor, min, max, onCambiar, etiqueta, formato, deshabilitado = false }: {
  valor: number;
  min: number;
  max: number;
  onCambiar: (valor: number) => void;
  etiqueta: string;
  formato: (valor: number) => string;
  deshabilitado?: boolean;
}) {
  const boton = "grid size-8 place-items-center rounded-lg text-texto-suave hover:bg-superficie-2 hover:text-texto focus-visible:outline-2 focus-visible:outline-acento disabled:opacity-40 disabled:hover:bg-transparent";
  return (
    <div role="group" aria-label={etiqueta} className="inline-flex items-center gap-1 rounded-xl bg-superficie p-0.5 ring-1 ring-borde-suave ring-inset">
      <button type="button" aria-label={`Menos: ${etiqueta}`} disabled={deshabilitado || valor <= min} onClick={() => onCambiar(Math.max(min, valor - 1))} className={boton}>
        <Minus className="size-3.5" aria-hidden="true" />
      </button>
      <output aria-live="polite" className="min-w-[5.5rem] text-center text-[13px] font-medium tabular-nums text-texto">{formato(valor)}</output>
      <button type="button" aria-label={`Más: ${etiqueta}`} disabled={deshabilitado || valor >= max} onClick={() => onCambiar(Math.min(max, valor + 1))} className={boton}>
        <Plus className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

/** Opciones excluyentes como botones pegados (trazo, transición, dirección, alcance del pincel). */
export function Segmentado<T extends string>({ opciones, valor, onCambiar, etiqueta, deshabilitado = false }: {
  opciones: ReadonlyArray<{ valor: T; etiqueta: string; icono?: ReactNode }>;
  valor: T;
  onCambiar: (valor: T) => void;
  etiqueta: string;
  deshabilitado?: boolean;
}) {
  const botones = useRef<Array<HTMLButtonElement | null>>([]);
  return (
    <div role="radiogroup" aria-label={etiqueta} className="inline-flex max-w-full flex-wrap gap-0.5 rounded-xl bg-superficie-2 p-0.5">
      {opciones.map((opcion, posicion) => {
        const elegido = opcion.valor === valor;
        return (
          <button
            key={opcion.valor}
            ref={(nodo) => { botones.current[posicion] = nodo; }}
            type="button"
            role="radio"
            aria-checked={elegido}
            tabIndex={elegido ? 0 : -1}
            disabled={deshabilitado}
            onClick={() => onCambiar(opcion.valor)}
            onKeyDown={(evento) => {
              const siguiente = flechas(evento, posicion, opciones.length);
              if (siguiente === null) return;
              onCambiar(opciones[siguiente]!.valor);
              botones.current[siguiente]?.focus();
            }}
            className={`inline-flex h-8 items-center gap-1.5 rounded-[0.6rem] px-3 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-acento disabled:opacity-50 ${elegido ? "bg-superficie text-texto shadow-[0_1px_2px_var(--sombra)]" : "text-texto-suave hover:text-texto"}`}
          >
            {opcion.icono}
            {opcion.etiqueta}
          </button>
        );
      })}
    </div>
  );
}

/** Interruptor accesible (`role="switch"`). */
export function Interruptor({ activo, onCambiar, etiqueta, descripcion, deshabilitado = false }: {
  activo: boolean;
  onCambiar: (activo: boolean) => void;
  etiqueta: string;
  descripcion?: string;
  deshabilitado?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={activo}
      disabled={deshabilitado}
      onClick={() => onCambiar(!activo)}
      className="flex w-full items-center justify-between gap-3 rounded-xl text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento disabled:opacity-50"
    >
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-texto">{etiqueta}</span>
        {descripcion && <span className="block text-xs text-texto-suave">{descripcion}</span>}
      </span>
      <span aria-hidden="true" className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${activo ? "bg-acento" : "bg-superficie-2 ring-1 ring-borde ring-inset"}`}>
        <span className={`absolute top-0.5 size-5 rounded-full bg-superficie shadow-[0_1px_3px_var(--sombra)] transition-transform ${activo ? "translate-x-[1.125rem]" : "translate-x-0.5"}`} />
      </span>
    </button>
  );
}

/** Título pequeño de un grupo de controles, con una línea de ayuda opcional. */
export function Apartado({ titulo, ayuda, children, accion }: { titulo: string; ayuda?: string; children: ReactNode; accion?: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold text-texto">{titulo}</h3>
          {ayuda && <p className="text-xs text-texto-suave">{ayuda}</p>}
        </div>
        {accion}
      </div>
      {children}
    </section>
  );
}
