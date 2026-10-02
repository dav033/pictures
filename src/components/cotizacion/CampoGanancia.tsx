"use client";

import { FICHAS_GANANCIA, fichaActiva } from "@/lib/cotizacion/lectura-numeros";

type Props = {
  clave: string;
  valor: string;
  /** Qué está mal con lo escrito (mensaje para el usuario), o `null`. */
  error: string | null;
  onValor: (texto: string) => void;
};

/**
 * «Tu ganancia»: un porcentaje que se suma a lo que te cuesta todo. El campo
 * empieza vacío; las fichas 20 / 30 / 40 % son un atajo que lo rellena al
 * tocarlas, no un valor por defecto. La ficha activa se marca cuando lo escrito
 * coincide con ella.
 */
export function CampoGanancia({ clave, valor, error, onValor }: Props) {
  const id = `ganancia-${clave}`;
  const activa = fichaActiva(valor);
  return (
    <div className="mt-3 rounded-2xl bg-superficie p-4 ring-1 ring-borde-suave ring-inset">
      <label htmlFor={id} className="block text-[13px] font-semibold text-texto">Tu ganancia</label>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="flex items-center gap-2">
          <input
            id={id}
            inputMode="decimal"
            value={valor}
            onChange={(evento) => onValor(evento.target.value)}
            aria-invalid={error !== null}
            aria-errormessage={error ? `${id}-error` : undefined}
            aria-describedby={`${id}-ayuda${error ? ` ${id}-error` : ""}`}
            placeholder="Ej. 30"
            className={`h-11 w-24 rounded-lg border bg-fondo px-2.5 text-right text-base font-semibold tabular-nums text-texto outline-none placeholder:font-normal placeholder:text-texto-suave focus-visible:border-acento focus-visible:outline-2 focus-visible:outline-acento ${error ? "border-error" : "border-borde"}`}
          />
          <span className="text-sm text-texto-suave">%</span>
        </span>
        <div role="group" aria-label="Ganancias sugeridas" className="flex items-center gap-1.5">
          {FICHAS_GANANCIA.map((porcentaje) => (
            <button
              key={porcentaje}
              type="button"
              onClick={() => onValor(String(porcentaje))}
              aria-pressed={activa === porcentaje}
              className={`inline-flex h-11 min-w-11 items-center justify-center rounded-full px-3 text-[13px] font-medium tabular-nums ring-1 ring-inset focus-visible:outline-2 focus-visible:outline-acento ${activa === porcentaje ? "bg-acento text-sobre-acento ring-acento" : "bg-superficie text-texto ring-borde hover:bg-acento-suave"}`}
            >
              {porcentaje} %
            </button>
          ))}
        </div>
      </div>
      <span id={`${id}-ayuda`} className="mt-1 block text-xs text-texto-suave">Se suma a lo que te cuesta todo (materiales y tus gastos).</span>
      {error && <p id={`${id}-error`} className="mt-1 text-xs text-error">{error}</p>}
    </div>
  );
}
