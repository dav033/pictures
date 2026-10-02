"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

/**
 * Los mandos del editor de columnas (ADR-0035, paso 1). Presentación pura: cada uno recibe un valor, un rango y un
 * `onConfirmar` y no sabe de columnas. Los rangos y las ayudas se los da quien los usa, y salen del motor.
 *
 * Todos miden al menos 44 px de alto en lo que se toca, con el foco visible, y se manejan con el teclado.
 */

const FOCO = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento";

/** Flechas de un grupo de radio: mueve y elige el vecino, dando la vuelta. */
function flechas(evento: KeyboardEvent<HTMLElement>, posicion: number, total: number): number | null {
  const delta = evento.key === "ArrowRight" || evento.key === "ArrowDown" ? 1 : evento.key === "ArrowLeft" || evento.key === "ArrowUp" ? -1 : 0;
  if (!delta || total === 0) return null;
  evento.preventDefault();
  return (posicion + delta + total) % total;
}

/** Etiqueta, valor visible y ayuda de un mando: lo que lee quien mira y quien escucha. */
function Mando({ id, etiqueta, valor, ayuda, children }: { id: string; etiqueta: string; valor?: string; ayuda?: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="min-w-0 text-[13px] font-medium text-texto">{etiqueta}</label>
        {valor !== undefined && <output htmlFor={id} className="shrink-0 text-[13px] font-semibold tabular-nums text-texto">{valor}</output>}
      </div>
      {children}
      {ayuda && <p id={`${id}-ayuda`} className="text-xs leading-relaxed text-texto-suave">{ayuda}</p>}
    </div>
  );
}

/**
 * Deslizador que **aplica al soltar** (puntero o tecla), no en cada paso: un arrastre es un solo borrador y una
 * sola petición al motor, que es lo que cuesta cientos de milisegundos. Mientras se mueve, solo cambia su número.
 */
export function DeslizadorColumna({ etiqueta, ayuda, valor, min, max, paso, formato, textoValor = formato, onConfirmar, testid }: {
  etiqueta: string;
  ayuda?: string;
  valor: number;
  min: number;
  max: number;
  paso: number;
  formato: (valor: number) => string;
  /** Lo que anuncia el lector de pantalla (`aria-valuetext`); sin él, lo que se ve. */
  textoValor?: (valor: number) => string;
  onConfirmar: (valor: number) => void;
  testid: string;
}) {
  const id = useId();
  const [local, setLocal] = useState<number | null>(null);
  const mostrado = local ?? valor;
  const confirmar = () => {
    if (local !== null && local !== valor) onConfirmar(local);
    setLocal(null);
  };
  // Un rango sin recorrido (por ejemplo el alto de un semicírculo) no se puede mover.
  const sinRecorrido = max <= min;
  return (
    <Mando id={id} etiqueta={etiqueta} valor={formato(mostrado)} ayuda={ayuda}>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={paso}
        value={mostrado}
        disabled={sinRecorrido}
        aria-valuetext={textoValor(mostrado)}
        aria-describedby={ayuda ? `${id}-ayuda` : undefined}
        data-testid={testid}
        onChange={(evento) => setLocal(Number(evento.currentTarget.value))}
        onPointerUp={confirmar}
        onPointerCancel={() => setLocal(null)}
        onKeyUp={confirmar}
        onBlur={confirmar}
        className={`block h-11 w-full cursor-pointer accent-[var(--acento)] disabled:cursor-not-allowed disabled:opacity-50 ${FOCO}`}
      />
    </Mando>
  );
}

/** Interruptor accesible (`role="switch"`) con la ayuda del motor debajo. */
export function InterruptorColumna({ etiqueta, ayuda, activo, onCambiar, testid }: {
  etiqueta: string;
  ayuda?: string;
  activo: boolean;
  onCambiar: (activo: boolean) => void;
  testid: string;
}) {
  const id = useId();
  return (
    <div className="space-y-0.5">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={activo}
        aria-describedby={ayuda ? `${id}-ayuda` : undefined}
        data-testid={testid}
        onClick={() => onCambiar(!activo)}
        className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-xl text-left ${FOCO}`}
      >
        <span className="min-w-0 text-[13px] font-medium text-texto">{etiqueta}</span>
        <span aria-hidden="true" className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${activo ? "bg-acento" : "bg-superficie-2 ring-1 ring-borde ring-inset"}`}>
          <span className={`absolute top-0.5 size-5 rounded-full bg-superficie shadow-[0_1px_3px_var(--sombra)] transition-transform motion-reduce:transition-none ${activo ? "translate-x-[1.125rem]" : "translate-x-0.5"}`} />
        </span>
      </button>
      {ayuda && <p id={`${id}-ayuda`} className="text-xs leading-relaxed text-texto-suave">{ayuda}</p>}
    </div>
  );
}

/** Una lista corta de opciones con nombre (`<select>` nativo: teclado, lector de pantalla y selector móvil gratis). */
export function SeleccionColumna({ etiqueta, ayuda, opciones, valor, onCambiar, testid }: {
  etiqueta: string;
  ayuda?: string;
  opciones: ReadonlyArray<{ valor: string; etiqueta: string; deshabilitada?: boolean }>;
  valor: string;
  onCambiar: (valor: string) => void;
  testid: string;
}) {
  const id = useId();
  return (
    <Mando id={id} etiqueta={etiqueta} ayuda={ayuda}>
      <select
        id={id}
        value={valor}
        aria-describedby={ayuda ? `${id}-ayuda` : undefined}
        data-testid={testid}
        onChange={(evento) => onCambiar(evento.currentTarget.value)}
        className={`block min-h-11 w-full rounded-xl border border-borde bg-superficie px-3 text-[13px] text-texto ${FOCO}`}
      >
        {opciones.map((opcion) => <option key={opcion.valor} value={opcion.valor} disabled={opcion.deshabilitada}>{opcion.etiqueta}</option>)}
      </select>
    </Mando>
  );
}

/** Opciones excluyentes como botones (forma, tamaño de globo): grupo de radio con foco itinerante y flechas. */
export function GrupoOpcionesColumna<T extends string | number>({ etiqueta, ayuda, opciones, valor, onCambiar, testid }: {
  etiqueta: string;
  ayuda?: string;
  opciones: ReadonlyArray<{ valor: T; etiqueta: string; descripcion?: string }>;
  valor: T;
  onCambiar: (valor: T) => void;
  testid: string;
}) {
  const id = useId();
  const botones = useRef<Array<HTMLButtonElement | null>>([]);
  return (
    <div className="space-y-1">
      <p id={id} className="text-[13px] font-medium text-texto">{etiqueta}</p>
      <div role="radiogroup" aria-labelledby={id} aria-describedby={ayuda ? `${id}-ayuda` : undefined} data-testid={testid} className="flex flex-wrap gap-1.5">
        {opciones.map((opcion, posicion) => {
          const elegido = opcion.valor === valor;
          return (
            <button
              key={String(opcion.valor)}
              ref={(nodo) => { botones.current[posicion] = nodo; }}
              type="button"
              role="radio"
              aria-checked={elegido}
              tabIndex={elegido ? 0 : -1}
              title={opcion.descripcion}
              onClick={() => onCambiar(opcion.valor)}
              onKeyDown={(evento) => {
                const siguiente = flechas(evento, posicion, opciones.length);
                if (siguiente === null) return;
                onCambiar(opciones[siguiente]!.valor);
                botones.current[siguiente]?.focus();
              }}
              className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl px-3.5 text-[13px] font-medium ring-1 ring-inset transition-colors ${FOCO} ${elegido ? "bg-acento-suave text-acento ring-acento" : "bg-superficie text-texto-suave ring-borde hover:text-texto"}`}
            >
              {opcion.etiqueta}
            </button>
          );
        })}
      </div>
      {ayuda && <p id={`${id}-ayuda`} className="text-xs leading-relaxed text-texto-suave">{ayuda}</p>}
    </div>
  );
}
