"use client";

import { TrendingUp } from "lucide-react";
import { FICHAS_GANANCIA, fichaActiva } from "@/lib/cotizacion/lectura-numeros";
import { NumeroAnimado } from "@/components/propuesta/NumeroAnimado";
import { AYUDAS } from "@/components/guiado/ayudas-guiada";
import { Ayuda } from "@/components/ui/Ayuda";
import { CLASE_NO_VIGENTE } from "./formato";
import { registrarCotizacion, useRegistroEscrito } from "./registro-cotizacion";

type Props = {
  clave: string;
  valor: string;
  /** Qué está mal con lo escrito (mensaje para el usuario), o `null`. */
  error: string | null;
  /** Lo que ganas según el último cálculo de Python (solo con una ganancia escrita), o `null`. */
  ganancia?: { cop: number; atenuar: boolean } | null;
  onValor: (texto: string) => void;
};

/**
 * «Tu ganancia»: un porcentaje que se suma a lo que te cuesta todo. El campo
 * empieza vacío; las fichas 20 / 30 / 40 % son un atajo que lo rellena al
 * tocarlas, no un valor por defecto. La ficha activa se marca cuando lo escrito
 * coincide con ella. Lo que ganas en pesos es el de Python.
 */
export function CampoGanancia({ clave, valor, error, ganancia = null, onValor }: Props) {
  const id = `ganancia-${clave}`;
  const activa = fichaActiva(valor);
  const registrarEscrito = useRegistroEscrito();
  return (
    <div className="mt-3 rounded-2xl bg-superficie p-4 ring-1 ring-borde-suave ring-inset">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          <label htmlFor={id} className="flex items-center gap-2 text-sm font-semibold text-texto">
            <span className="grid size-7 place-items-center rounded-lg bg-exito-suave text-exito" aria-hidden="true">
              <TrendingUp className="size-4" />
            </span>
            Tu ganancia
          </label>
          <Ayuda {...AYUDAS.ganancia} />
        </span>
        {ganancia && ganancia.cop > 0 && (
          <span className={`text-right text-xs text-texto-suave ${ganancia.atenuar ? CLASE_NO_VIGENTE : ""}`}>
            Ganas{" "}
            <span className="text-sm font-semibold tabular-nums text-exito">
              <NumeroAnimado valor={ganancia.cop} formato="pesos" duracion={0.6} />
            </span>
          </span>
        )}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <span className="relative">
          <input
            id={id}
            inputMode="decimal"
            autoComplete="off"
            value={valor}
            onChange={(evento) => {
              registrarEscrito("ganancia", "ganancia", { valor: evento.target.value.slice(0, 12), origen: "escrito" });
              onValor(evento.target.value);
            }}
            aria-invalid={error !== null}
            aria-errormessage={error ? `${id}-error` : undefined}
            aria-describedby={`${id}-ayuda${error ? ` ${id}-error` : ""}`}
            placeholder="Ej. 30"
            className={`h-11 w-24 rounded-lg border bg-fondo pl-2.5 pr-7 text-right text-lg font-bold tabular-nums text-texto outline-none transition-colors placeholder:text-sm placeholder:font-normal placeholder:text-texto-tenue focus-visible:border-acento focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-acento ${error ? "border-error" : "border-borde"}`}
          />
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-sm font-semibold text-texto-suave">%</span>
        </span>
        <div role="group" aria-label="Ganancias sugeridas" className="flex items-center gap-1.5">
          {FICHAS_GANANCIA.map((porcentaje) => (
            <button
              key={porcentaje}
              type="button"
              onClick={() => {
                registrarCotizacion("ganancia", { valor: String(porcentaje), origen: "ficha" });
                onValor(String(porcentaje));
              }}
              aria-pressed={activa === porcentaje}
              className={`inline-flex h-11 min-w-11 items-center justify-center rounded-full px-3 text-[13px] font-semibold tabular-nums ring-1 ring-inset transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-acento ${activa === porcentaje ? "bg-acento text-sobre-acento shadow-[0_4px_14px_var(--sombra-acento)] ring-acento" : "bg-fondo text-texto ring-borde hover:bg-acento-suave hover:text-acento"}`}
            >
              {porcentaje} %
            </button>
          ))}
        </div>
      </div>
      <span id={`${id}-ayuda`} className="mt-2 block text-xs text-texto-suave">Se suma a lo que te cuesta todo (materiales y tus gastos).</span>
      {error && <p id={`${id}-error`} className="mt-1 text-xs text-error">{error}</p>}
    </div>
  );
}
