"use client";

import { ClipboardList, Info, Palette } from "lucide-react";
import type { PatronColorResuelto } from "@/lib/plan/patron-color";
import type { ColorLeyenda } from "./leyenda";
import { VistaPatron } from "./VistaPatron";
import { ResumenPatron } from "./ResumenPatron";

type Props = {
  /** Patrón aplicado de la pieza, como lo expandió Python; sin él se ofrece crearlo. */
  resuelto?: PatronColorResuelto;
  leyenda: readonly ColorLeyenda[];
  tipo: string;
  oficialId?: string;
  espejo?: boolean;
  proporcion?: number;
  repeticiones: number;
  nombrePieza: string;
  onEditar?: () => void;
  onHojaArmado?: () => void;
  ocupado?: boolean;
  modoDev?: boolean;
};

const botonSecundario = "ui-pressable inline-flex h-9 items-center gap-1.5 rounded-xl border border-borde px-3 text-[13px] font-medium text-acento hover:bg-acento-suave focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento disabled:opacity-50";

/**
 * "Patrón de color" dentro del detalle de una pieza: la vista compacta, el
 * nombre y la frase de Python, cuántos globos van de cada color y los accesos
 * al editor y a la hoja de armado. Sin patrón, una invitación a crearlo.
 */
export function BloquePatron({ resuelto, leyenda, tipo, oficialId, espejo = false, proporcion, repeticiones, nombrePieza, onEditar, onHojaArmado, ocupado = false, modoDev = false }: Props) {
  if (!resuelto) {
    if (!onEditar) return null;
    return (
      <section aria-label="Patrón de color" className="flex flex-wrap items-center gap-3 rounded-2xl border border-dashed border-borde bg-superficie-suave p-3">
        <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-xl bg-acento-suave text-acento"><Palette className="size-5" /></span>
        <span className="min-w-0 flex-1 basis-48">
          <span className="block text-[13px] font-semibold text-texto">Patrón de color</span>
          <span className="block text-xs text-texto-suave">Decide dónde va cada color: espiral, anillos, degradé, flores… y saca la hoja de armado.</span>
        </span>
        <button type="button" onClick={onEditar} disabled={ocupado} data-testid="crear-patron" className={botonSecundario}>
          <Palette className="size-4" aria-hidden="true" />Crear patrón
        </button>
      </section>
    );
  }
  return (
    <section aria-label="Patrón de color" data-testid="bloque-patron" className="@container rounded-2xl bg-superficie-suave p-3 ring-1 ring-borde-suave ring-inset">
      <div className="flex flex-col gap-3 @md:flex-row">
        <div className="grid h-44 place-items-center overflow-hidden rounded-xl bg-superficie ring-1 ring-borde-suave ring-inset @md:h-auto @md:min-h-44 @md:w-40 @md:shrink-0">
          <VistaPatron resuelto={resuelto} leyenda={leyenda} tipo={tipo} oficialId={oficialId} espejo={espejo} proporcion={proporcion} etiqueta={`${nombrePieza}: patrón ${resuelto.nombre.toLowerCase()}`} className="size-full max-h-52 p-2" />
        </div>
        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-[13px] font-semibold text-texto">Patrón de color</p>
            <span className="rounded-full bg-acento-suave px-2.5 py-0.5 text-xs font-semibold text-acento">{resuelto.nombre}</span>
          </div>
          {resuelto.descripcion && <p className="text-[13px] leading-relaxed text-texto-suave">{resuelto.descripcion}</p>}
          <ResumenPatron conteo={resuelto.conteo} repeticiones={repeticiones} leyenda={leyenda} compacto />
          {resuelto.avisos.length > 0 && (
            <ul aria-label="Avisos del patrón" className="space-y-0.5 text-xs text-texto-suave">
              {resuelto.avisos.map((aviso) => <li key={aviso} className="flex gap-1.5"><Info className="mt-px size-3.5 shrink-0 text-texto-tenue" aria-hidden="true" />{aviso}</li>)}
            </ul>
          )}
          <div className="flex flex-wrap gap-2 pt-0.5">
            {onEditar && (
              <button type="button" onClick={onEditar} disabled={ocupado} data-testid="editar-patron" className={botonSecundario}>
                <Palette className="size-4" aria-hidden="true" />Editar patrón
              </button>
            )}
            {onHojaArmado && (
              <button type="button" onClick={onHojaArmado} aria-haspopup="dialog" data-testid="abrir-hoja-armado" className={botonSecundario}>
                <ClipboardList className="size-4" aria-hidden="true" />Hoja de armado
              </button>
            )}
          </div>
        </div>
      </div>
      {modoDev && (resuelto.prompt_gemini || resuelto.prompt_lora) && (
        <details className="mt-2 text-[11px] text-texto-suave">
          <summary className="cursor-pointer select-none">Frases del patrón en el prompt (dev)</summary>
          {resuelto.prompt_gemini && <p className="mt-1"><span className="font-semibold">Gemini:</span> {resuelto.prompt_gemini}</p>}
          {resuelto.prompt_lora && <p className="mt-1"><span className="font-semibold">LoRA:</span> {resuelto.prompt_lora}</p>}
        </details>
      )}
    </section>
  );
}
