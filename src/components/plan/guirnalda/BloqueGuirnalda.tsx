"use client";

import { ClipboardList, Info, Spline } from "lucide-react";
import type { ArmadoGuirnaldaResuelto } from "@/lib/plan/armado-guirnalda";
import type { ColorLeyenda } from "../patron/leyenda";
import { LeyendaPatron } from "../patron/LeyendaPatron";
import { GraficaGuirnalda } from "./GraficaGuirnalda";
import { formaTexto, horas, metros, NOMBRE_SOPORTE, NOMBRE_UNIDAD, NOMBRE_POSICION, resumenInsumosGuirnalda, colorDeCodigo } from "./leyenda-guirnalda";

type Props = {
  /** Armado de la pieza, como lo resolvió Python (`plan_resuelto.armados_guirnalda`). */
  resuelto: ArmadoGuirnaldaResuelto;
  leyenda: readonly ColorLeyenda[];
  nombrePieza: string;
  /** Nombre de la pieza anfitriona cuando la guirnalda va sobre otra. */
  anfitriona?: string;
  onEditar?: () => void;
  onHojaArmado?: () => void;
  ocupado?: boolean;
  modoDev?: boolean;
};

const botonSecundario = "ui-pressable inline-flex h-9 items-center gap-1.5 rounded-xl border border-borde px-3 text-[13px] font-medium text-acento hover:bg-acento-suave focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50";

/** Como en los bloques del patrón y del bouquet: ocupado, el botón sigue enfocable y el toque no hace nada. */
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
 * "Armado de la guirnalda" dentro del detalle de una pieza (ADR-0032, E6):
 * la gráfica con la forma real y los racimos numerados, y lo que Python
 * resolvió: soporte, forma y caída, unidad del racimo, relleno, remates, lo
 * que necesita y no se cotiza (metros de tira y cuerda, pegante o ganchos,
 * pesas) y la duración estimada. Solo se monta cuando el plan trae el armado
 * de la pieza: sin él, la tarjeta queda como siempre.
 */
export function BloqueGuirnalda({ resuelto, leyenda, nombrePieza, anfitriona, onEditar, onHojaArmado, ocupado = false, modoDev = false }: Props) {
  const { armado } = resuelto;
  const insumos = resumenInsumosGuirnalda(resuelto.insumos, null);
  const unidad = NOMBRE_UNIDAD[armado.racimo.unidad];
  const soporte = armado.soporte === "sobre_estructura" && anfitriona ? `Sobre ${anfitriona}` : NOMBRE_SOPORTE[armado.soporte].nombre;
  const remates = resuelto.remates.length
    ? resuelto.remates.map((remate) => `${remate.cantidad} × ${colorDeCodigo(leyenda, remate.codigo).etiqueta} (${NOMBRE_POSICION[remate.posicion].toLowerCase()})`).join(", ")
    : "Sin remates";
  const datos: Array<{ termino: string; valor: string }> = [
    { termino: "Soporte", valor: soporte },
    { termino: "Forma", valor: formaTexto(armado) },
    { termino: "Largo", valor: resuelto.largo_cuerda_m !== resuelto.largo_m ? `${metros(resuelto.largo_m)} · cuerda ${metros(resuelto.largo_cuerda_m)}` : metros(resuelto.largo_m) },
    { termino: "Racimo", valor: `${unidad.singular.charAt(0).toUpperCase()}${unidad.singular.slice(1)} de ${armado.racimo.tamano_pulg_base}″ · ${resuelto.racimos.length} ${resuelto.racimos.length === 1 ? unidad.singular : unidad.plural}` },
    { termino: "Relleno", valor: resuelto.relleno ? `${resuelto.relleno.total} globos chicos entre racimos` : "Sin relleno" },
    { termino: "Remates", valor: remates },
  ];
  return (
    <section aria-label="Armado de la guirnalda" data-testid="bloque-armado-guirnalda" className="@container rounded-2xl bg-superficie-suave p-3 ring-1 ring-borde-suave ring-inset">
      <div className="space-y-3">
        <div className="relative h-44 overflow-hidden rounded-xl bg-superficie ring-1 ring-borde-suave ring-inset @md:h-52">
          <GraficaGuirnalda resuelto={resuelto} leyenda={leyenda} conCodigos={false} etiqueta={`${nombrePieza}: ${resuelto.nombre.toLowerCase()}`} className="absolute inset-0 size-full p-1.5" />
        </div>
        <div className="min-w-0 space-y-2.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-[13px] font-semibold text-texto">Armado de la guirnalda</p>
            <span className="rounded-full bg-acento-suave px-2.5 py-0.5 text-xs font-semibold text-acento">{resuelto.nombre}</span>
            {resuelto.repeticiones > 1 && <span className="text-[11px] font-medium text-texto-suave">· {resuelto.repeticiones} guirnaldas iguales</span>}
          </div>
          {resuelto.descripcion && <p className="text-[13px] leading-relaxed text-texto-suave">{resuelto.descripcion}</p>}
          <dl data-testid="datos-armado-guirnalda" className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs @md:grid-cols-2">
            {datos.map((dato) => (
              <div key={dato.termino} className="flex min-w-0 gap-1.5">
                <dt className="shrink-0 font-semibold text-texto">{dato.termino}:</dt>
                <dd className="min-w-0 text-texto-suave">{dato.valor}</dd>
              </div>
            ))}
          </dl>
          <LeyendaPatron leyenda={leyenda} etiqueta="Leyenda del armado" />
          {insumos && <p data-testid="insumos-armado-guirnalda" className="text-xs text-texto-suave"><span className="font-semibold text-texto">Necesita (no se cotiza):</span> {insumos}</p>}
          <p data-testid="duracion-armado-guirnalda" className="text-xs text-texto-suave">
            <span className="font-semibold text-texto">Armado e instalación:</span> ≈ {horas(resuelto.duracion_estimada)}{" "}
            <span className="rounded-full bg-aviso-suave px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-aviso">estimado</span>
          </p>
          {resuelto.avisos.length > 0 && (
            <ul aria-label="Avisos del armado" className="space-y-0.5 text-xs text-texto-suave">
              {resuelto.avisos.map((aviso) => <li key={aviso} className="flex gap-1.5"><Info className="mt-px size-3.5 shrink-0 text-texto-tenue" aria-hidden="true" />{aviso}</li>)}
            </ul>
          )}
          <div className="flex flex-wrap gap-2 pt-0.5">
            {onEditar && (
              <button type="button" {...propsAbrirEditor(ocupado, onEditar)} data-testid="editar-armado-guirnalda" className={botonSecundario}>
                <Spline className="size-4" aria-hidden="true" />Editar armado
              </button>
            )}
            {onHojaArmado && (
              <button type="button" onClick={onHojaArmado} aria-haspopup="dialog" data-testid="abrir-hoja-armado-guirnalda" className={botonSecundario}>
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
