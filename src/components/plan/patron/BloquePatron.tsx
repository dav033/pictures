"use client";

import type { ReactNode } from "react";
import { ClipboardList, Info, Palette } from "lucide-react";
import type { PatronColorResuelto } from "@/lib/plan/patron-color";
import { useVistaEnVivo, type VistasEnVivo } from "../vistas-en-vivo";
import type { ColorLeyenda } from "./leyenda";
import { dibujoPatron, VistaPatron } from "./VistaPatron";
import { ResumenPatron } from "./ResumenPatron";

type Props = {
  /** Patrón aplicado de la pieza, como lo expandió Python; sin él se ofrece crearlo. */
  resuelto?: PatronColorResuelto;
  /**
   * Dibujo en vivo del deslizador de colores de esta pieza (`id`), mientras
   * su reparto va camino del plan: se muestra en lugar de `resuelto`. Los
   * avisos que el plan ya traía siguen aquí; los que trae el reparto nuevo
   * los muestra el deslizador, junto a lo que se mueve. Solo este bloque se
   * vuelve a pintar con cada respuesta de Python.
   */
  enVivo?: { vistas: VistasEnVivo<PatronColorResuelto>; id: string };
  /**
   * El deslizador de colores de un confeti: va justo bajo el nombre del
   * patrón, al lado del dibujo (debajo de él en un teléfono), para que el
   * decorador vea la pieza entera mientras lo mueve.
   */
  reparto?: ReactNode;
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

/**
 * Hueco del dibujo según su forma, para que lo llene: una columna alta pide
 * un marco angosto y alto; un arco o una guirnalda, uno ancho. En móvil el
 * marco ocupa todo el ancho y cambia su alto.
 */
function marcoDibujo(ancho: number): string {
  if (ancho < 0.7) return "h-72 @md:w-36 @md:min-h-72";
  if (ancho <= 1.5) return "h-64 @md:w-56 @md:min-h-56";
  return "h-52 @md:w-64 @md:min-h-44";
}

const botonSecundario = "ui-pressable inline-flex h-9 items-center gap-1.5 rounded-xl border border-borde px-3 text-[13px] font-medium text-acento hover:bg-acento-suave focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento disabled:opacity-50";

/**
 * "Patrón de color" dentro del detalle de una pieza: la vista compacta, el
 * nombre y la frase de Python, cuántos globos van de cada color y los accesos
 * al editor y a la hoja de armado; en un confeti, también el deslizador de
 * colores junto al dibujo que cambia. Sin patrón, una invitación a crearlo.
 */
export function BloquePatron({ resuelto, enVivo, reparto, leyenda, tipo, oficialId, espejo = false, proporcion, repeticiones, nombrePieza, onEditar, onHojaArmado, ocupado = false, modoDev = false }: Props) {
  const vivo = useVistaEnVivo(enVivo?.vistas, enVivo?.id ?? "");
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
  const mostrado = vivo ?? resuelto;
  // En vivo, lo que el reparto nuevo trae de más lo dice el deslizador: aquí no se repite ni se mueve lo de siempre.
  const avisos = vivo ? vivo.avisos.filter((aviso) => resuelto.avisos.includes(aviso)) : resuelto.avisos;
  const dibujo = dibujoPatron(mostrado, { tipo, oficialId, espejo, proporcion });
  const ancho = dibujo.caja.alto > 0 ? dibujo.caja.ancho / dibujo.caja.alto : 1;
  return (
    <section aria-label="Patrón de color" data-testid="bloque-patron" data-en-vivo={vivo ? true : undefined} className="@container rounded-2xl bg-superficie-suave p-3 ring-1 ring-borde-suave ring-inset">
      <div className="flex flex-col gap-3 @md:flex-row">
        <div className={`relative overflow-hidden rounded-xl bg-superficie ring-1 ring-borde-suave ring-inset @md:h-auto @md:shrink-0 ${marcoDibujo(ancho)}`}>
          <VistaPatron resuelto={mostrado} dibujo={dibujo} leyenda={leyenda} tipo={tipo} oficialId={oficialId} espejo={espejo} proporcion={proporcion} etiqueta={`${nombrePieza}: patrón ${mostrado.nombre.toLowerCase()}`} className="absolute inset-0 size-full p-1.5" />
        </div>
        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-[13px] font-semibold text-texto">Patrón de color</p>
            <span className="rounded-full bg-acento-suave px-2.5 py-0.5 text-xs font-semibold text-acento">{mostrado.nombre}</span>
            {vivo && <span className="text-[11px] font-medium text-texto-suave">· así queda con tu reparto</span>}
          </div>
          {reparto}
          {mostrado.descripcion && <p className="text-[13px] leading-relaxed text-texto-suave">{mostrado.descripcion}</p>}
          <ResumenPatron conteo={mostrado.conteo} repeticiones={repeticiones} leyenda={leyenda} compacto />
          {avisos.length > 0 && (
            <ul aria-label="Avisos del patrón" className="space-y-0.5 text-xs text-texto-suave">
              {avisos.map((aviso) => <li key={aviso} className="flex gap-1.5"><Info className="mt-px size-3.5 shrink-0 text-texto-tenue" aria-hidden="true" />{aviso}</li>)}
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
      {modoDev && (mostrado.prompt_gemini || mostrado.prompt_lora) && (
        <details className="mt-2 text-[11px] text-texto-suave">
          <summary className="cursor-pointer select-none">Frases del patrón en el prompt (dev)</summary>
          {mostrado.prompt_gemini && <p className="mt-1"><span className="font-semibold">Gemini:</span> {mostrado.prompt_gemini}</p>}
          {mostrado.prompt_lora && <p className="mt-1"><span className="font-semibold">LoRA:</span> {mostrado.prompt_lora}</p>}
        </details>
      )}
    </section>
  );
}
