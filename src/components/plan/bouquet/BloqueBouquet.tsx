"use client";

import { ClipboardList, Info, Layers } from "lucide-react";
import type { ArmadoBouquetResuelto } from "@/lib/plan/armado-bouquet";
import type { ColorLeyenda } from "../patron/leyenda";
import { LeyendaPatron } from "../patron/LeyendaPatron";
import { GraficaBouquet } from "./GraficaBouquet";
import { resumenInsumos } from "./leyenda-bouquet";

type Props = {
  /** Armado de la pieza, como lo resolvió Python; sin él se ofrece crearlo. */
  resuelto?: ArmadoBouquetResuelto;
  leyenda: readonly ColorLeyenda[];
  nombrePieza: string;
  onEditar?: () => void;
  onHojaArmado?: () => void;
  ocupado?: boolean;
  modoDev?: boolean;
};

const botonSecundario = "ui-pressable inline-flex h-9 items-center gap-1.5 rounded-xl border border-borde px-3 text-[13px] font-medium text-acento hover:bg-acento-suave focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50";

/**
 * Como en el bloque del patrón: el botón que abre el editor no se deshabilita
 * mientras se guarda, para que el foco pueda volver a él al cerrar; ocupado,
 * sigue enfocable y el toque no hace nada.
 */
function propsAbrirEditor(ocupado: boolean, abrir: () => void) {
  return {
    "aria-disabled": ocupado || undefined,
    title: ocupado ? "Espera a que termine de guardarse el último cambio" : undefined,
    onClick: () => {
      if (!ocupado) abrir();
    },
  };
}

/**
 * "Armado del bouquet" dentro del detalle de una pieza (ADR-0030): la gráfica
 * compacta por niveles, el nombre y la frase de Python, lo que el armado
 * necesita y no se cotiza (pesas, cintas, helio, varillas, base), sus avisos y
 * los accesos al editor y a la hoja de armado. Sin armado, una invitación a crearlo.
 */
export function BloqueBouquet({ resuelto, leyenda, nombrePieza, onEditar, onHojaArmado, ocupado = false, modoDev = false }: Props) {
  if (!resuelto) {
    if (!onEditar) return null;
    return (
      <section aria-label="Armado del bouquet" className="flex flex-wrap items-center gap-3 rounded-2xl border border-dashed border-borde bg-superficie-suave p-3">
        <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-xl bg-acento-suave text-acento"><Layers className="size-5" /></span>
        <span className="min-w-0 flex-1 basis-48">
          <span className="block text-[13px] font-semibold text-texto">Armado del bouquet</span>
          <span className="block text-xs text-texto-suave">Decide cómo se arma por niveles: con base o con helio, qué va arriba y dónde van los números; y saca la hoja de armado.</span>
        </span>
        <button type="button" {...propsAbrirEditor(ocupado, onEditar)} data-testid="crear-armado" className={botonSecundario}>
          <Layers className="size-4" aria-hidden="true" />Crear armado
        </button>
      </section>
    );
  }
  const insumos = resumenInsumos(resuelto.insumos, resuelto.duracion_estimada);
  return (
    <section aria-label="Armado del bouquet" data-testid="bloque-armado" className="@container rounded-2xl bg-superficie-suave p-3 ring-1 ring-borde-suave ring-inset">
      <div className="flex flex-col gap-3 @md:flex-row">
        <div className="relative h-56 overflow-hidden rounded-xl bg-superficie ring-1 ring-borde-suave ring-inset @md:h-auto @md:min-h-52 @md:w-52 @md:shrink-0">
          <GraficaBouquet resuelto={resuelto} leyenda={leyenda} etiqueta={`${nombrePieza}: ${resuelto.nombre.toLowerCase()}`} className="absolute inset-0 size-full p-1.5 [&>svg]:size-full" />
        </div>
        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-[13px] font-semibold text-texto">Armado del bouquet</p>
            <span className="rounded-full bg-acento-suave px-2.5 py-0.5 text-xs font-semibold text-acento">{resuelto.nombre}</span>
            {resuelto.grupos > 1 && <span className="text-[11px] font-medium text-texto-suave">· {resuelto.grupos} bouquets, uno por número</span>}
          </div>
          {resuelto.descripcion && <p className="text-[13px] leading-relaxed text-texto-suave">{resuelto.descripcion}</p>}
          <LeyendaPatron leyenda={leyenda} etiqueta="Leyenda del armado" />
          {insumos && <p data-testid="insumos-armado" className="text-xs text-texto-suave"><span className="font-semibold text-texto">Necesita:</span> {insumos}</p>}
          {resuelto.avisos.length > 0 && (
            <ul aria-label="Avisos del armado" className="space-y-0.5 text-xs text-texto-suave">
              {resuelto.avisos.map((aviso) => <li key={aviso} className="flex gap-1.5"><Info className="mt-px size-3.5 shrink-0 text-texto-tenue" aria-hidden="true" />{aviso}</li>)}
            </ul>
          )}
          <div className="flex flex-wrap gap-2 pt-0.5">
            {onEditar && (
              <button type="button" {...propsAbrirEditor(ocupado, onEditar)} data-testid="editar-armado" className={botonSecundario}>
                <Layers className="size-4" aria-hidden="true" />Editar armado
              </button>
            )}
            {onHojaArmado && (
              <button type="button" onClick={onHojaArmado} aria-haspopup="dialog" data-testid="abrir-hoja-armado-bouquet" className={botonSecundario}>
                <ClipboardList className="size-4" aria-hidden="true" />Hoja de armado
              </button>
            )}
          </div>
        </div>
      </div>
      {modoDev && (resuelto.prompt_gemini || resuelto.prompt_lora) && (
        <details className="mt-2 text-[11px] text-texto-suave">
          <summary className="cursor-pointer select-none">Frases del armado en el prompt (dev)</summary>
          {resuelto.prompt_gemini && <p className="mt-1"><span className="font-semibold">Gemini:</span> {resuelto.prompt_gemini}</p>}
          {resuelto.prompt_lora && <p className="mt-1"><span className="font-semibold">LoRA:</span> {resuelto.prompt_lora}</p>}
        </details>
      )}
    </section>
  );
}
