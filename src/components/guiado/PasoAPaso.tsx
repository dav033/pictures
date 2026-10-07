"use client";

import type { DecoracionSempertex } from "@/lib/biblioteca-sempertex/esquemas";
import { guiaParaEstructura } from "@/lib/ia/guiado/guias-armado";
import { pasoParaCliente } from "@/lib/ia/guiado/pasos-cliente";
import { ChipsGuia, ContenidoGuia } from "./GuiaPlan";
import { Plegable } from "./Plegable";

/** «Aprender a hacerlo» de una idea del carrusel: sus pasos y, plegada por estructura, la guía aproximada. */
export function PasoAPaso({ decoracion, alTerminar }: { decoracion: DecoracionSempertex; alTerminar?: () => void }) {
  const guias = decoracion.piezas.flatMap((pieza, indice) => {
    const guia = guiaParaEstructura(pieza.estructura);
    return guia ? [{ clave: `${pieza.estructura}-${indice}`, cantidad: pieza.cantidad, guia }] : [];
  });
  return (
    <section className="mt-4 rounded-3xl border border-borde-suave bg-superficie p-4 shadow-[0_1px_2px_var(--sombra)] sm:p-5" aria-label="Guía paso a paso">
      <p className="text-xs font-semibold uppercase tracking-wide text-acento">Paso a paso</p>
      <h3 className="mt-1 font-semibold text-texto">Cómo armar «{decoracion.titulo}»</h3>
      {decoracion.pasos.length > 0 && (
        <ol className="mt-4 space-y-4">
          {decoracion.pasos.map((paso) => (
            <li key={paso.orden} className="flex gap-3 text-sm leading-6">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-acento text-xs font-bold text-sobre-acento">{paso.orden}</span>
              <span className="pt-0.5">{pasoParaCliente(paso.texto)}</span>
            </li>
          ))}
        </ol>
      )}
      {guias.length > 0 && (
        <div className="mt-5 space-y-2.5">
          <h4 className="text-sm font-semibold text-texto">Guía aproximada por estructura</h4>
          {guias.map(({ clave, cantidad, guia }) => (
            <Plegable key={clave} titulo={`${cantidad > 1 ? `${cantidad} × ` : ""}${guia.nombre}`} subtitulo={<ChipsGuia guia={guia} />}>
              <ContenidoGuia guia={guia} />
            </Plegable>
          ))}
        </div>
      )}
      <p className="mt-4 text-xs text-texto-suave">Revisa los materiales y la seguridad del montaje antes de armarla.</p>
      {alTerminar && (
        <button type="button" onClick={alTerminar} className="mt-4 min-h-11 rounded-xl border border-borde-suave px-4 text-sm font-semibold text-texto transition-colors hover:border-acento hover:text-acento focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50">
          Ver otras opciones
        </button>
      )}
    </section>
  );
}
