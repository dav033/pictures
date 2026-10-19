"use client";

import { memo, useId, useMemo, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import {
  alternarOpcion, hayFiltroTaxonomia, nombreOpcion, opcionesAgrupadas, FILTRO_TAXONOMIA_VACIO,
  type EjeTaxonomia, type FiltroTaxonomia,
} from "@/lib/taller/filtros-taxonomia";
import { CHIP, CHIP_ON } from "./ui-taller";

/**
 * Filtros de la Biblioteca por celebración (qué se celebra) y temática (cómo se ve): dos botones que despliegan sus
 * opciones como chips agrupados por `grupo`, con buscador y la cuenta de items de cada una (de la clasificación local).
 * Elegir varias de un eje es «cualquiera»; entre los dos ejes, «las dos cosas». Lo elegido queda a la vista como chips
 * que se quitan con un toque.
 */

const NOMBRE_EJE: Record<EjeTaxonomia, { boton: string; buscar: string; singular: string }> = {
  celebraciones: { boton: "Celebración", buscar: "Buscar celebración: cumpleaños, boda…", singular: "celebración" },
  tematicas: { boton: "Temática", buscar: "Buscar temática: dinosaurios, boho…", singular: "temática" },
};

const BOTON_EJE = "inline-flex h-[30px] min-w-0 flex-1 items-center justify-between gap-1 rounded-lg border border-taller-borde bg-taller-panel px-2 text-xs font-medium text-taller-medio hover:text-taller-texto";

type Props = {
  filtro: FiltroTaxonomia;
  onFiltro: (f: FiltroTaxonomia) => void;
  conteos: Readonly<Record<EjeTaxonomia, ReadonlyMap<string, number>>>;
  /** La clasificación todavía se está bajando. */
  cargando: boolean;
};

function PanelEje({ eje, filtro, onFiltro, conteos }: { eje: EjeTaxonomia; filtro: FiltroTaxonomia; onFiltro: (f: FiltroTaxonomia) => void; conteos: ReadonlyMap<string, number> }) {
  const [busqueda, setBusqueda] = useState("");
  const idBuscador = useId();
  const elegidas = filtro[eje];
  const grupos = useMemo(() => opcionesAgrupadas(eje, conteos, busqueda, elegidas), [eje, conteos, busqueda, elegidas]);
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-taller-borde bg-taller-tarjeta p-2" role="group" aria-label={`Opciones de ${NOMBRE_EJE[eje].singular}`}>
      <div className="flex h-8 items-center gap-2 rounded-lg border border-taller-solitario-borde bg-taller-panel px-2 focus-within:border-taller-resalte">
        <Search className="size-3.5 shrink-0 text-taller-suave" aria-hidden />
        <label htmlFor={idBuscador} className="sr-only">{NOMBRE_EJE[eje].buscar}</label>
        <input id={idBuscador} type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder={NOMBRE_EJE[eje].buscar} autoComplete="off"
          className="h-full min-w-0 flex-1 bg-transparent text-xs text-taller-texto outline-none placeholder:text-taller-suave [&::-webkit-search-cancel-button]:hidden" />
      </div>
      <div className="flex max-h-[220px] flex-col gap-2.5 overflow-y-auto overscroll-contain pr-0.5">
        {grupos.length === 0 && <p className="px-1 text-xs text-taller-suave">{busqueda ? `Ninguna ${NOMBRE_EJE[eje].singular} coincide.` : `Ninguna ${NOMBRE_EJE[eje].singular} en esta pestaña.`}</p>}
        {grupos.map((g) => (
          <section key={g.grupo} aria-label={g.nombre} className="flex flex-col gap-1">
            <h4 className="taller-rotulo">{g.nombre}</h4>
            <div className="flex flex-wrap gap-1">
              {g.opciones.map((o) => {
                const on = elegidas.includes(o.id);
                return (
                  <button key={o.id} type="button" aria-pressed={on} onClick={() => onFiltro(alternarOpcion(filtro, eje, o.id))}
                    className={`${CHIP} !min-h-7 !px-2 ${on ? CHIP_ON : ""}`}>
                    {o.nombre} <span className="font-normal text-taller-suave">{o.n}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

export const FiltrosTaxonomia = memo(function FiltrosTaxonomia({ filtro, onFiltro, conteos, cargando }: Props) {
  const [abierto, setAbierto] = useState<EjeTaxonomia | null>(null);
  const hay = hayFiltroTaxonomia(filtro);
  const elegidas = [...filtro.celebraciones.map((id) => ({ eje: "celebraciones" as const, id })), ...filtro.tematicas.map((id) => ({ eje: "tematicas" as const, id }))];
  return (
    <div className="flex flex-col gap-1.5" role="group" aria-label="Filtros por celebración y temática">
      <div className="flex gap-1.5">
        {(["celebraciones", "tematicas"] as const).map((eje) => {
          const n = filtro[eje].length;
          return (
            <button key={eje} type="button" aria-expanded={abierto === eje} disabled={cargando} onClick={() => setAbierto(abierto === eje ? null : eje)}
              className={`${BOTON_EJE} ${n ? "border-taller-resalte text-taller-texto" : ""} disabled:opacity-60`}>
              <span className="truncate">{NOMBRE_EJE[eje].boton}{n ? ` (${n})` : cargando ? "…" : ": todas"}</span>
              <ChevronDown className={`size-3.5 shrink-0 transition-transform ${abierto === eje ? "rotate-180" : ""}`} aria-hidden />
            </button>
          );
        })}
      </div>
      {abierto && <PanelEje eje={abierto} filtro={filtro} onFiltro={onFiltro} conteos={conteos[abierto]} />}
      {hay && (
        <div className="flex flex-wrap items-center gap-1" aria-label="Filtros elegidos">
          {elegidas.map(({ eje, id }) => (
            <button key={`${eje}:${id}`} type="button" onClick={() => onFiltro(alternarOpcion(filtro, eje, id))} aria-label={`Quitar ${NOMBRE_EJE[eje].singular} ${nombreOpcion(eje, id)}`}
              className={`${CHIP} ${CHIP_ON} inline-flex !min-h-6 items-center gap-1 !px-2`}>
              {nombreOpcion(eje, id)}<X className="size-3" aria-hidden />
            </button>
          ))}
          <button type="button" onClick={() => onFiltro(FILTRO_TAXONOMIA_VACIO)} className="h-6 px-1.5 text-xs text-taller-acento hover:underline">Quitar</button>
        </div>
      )}
    </div>
  );
});
