"use client";

import { memo } from "react";
import type { ConteosAnadir, EleccionAnadir, RepositorioDeAnadir } from "@/lib/catalogo/anadir-repositorios";
import { SEG_ON } from "./ui-taller";

const OPCION = "flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center rounded-lg px-1 text-xs font-medium leading-tight text-taller-medio hover:text-taller-texto";

type Props = {
  opciones: readonly EleccionAnadir[];
  eleccion: EleccionAnadir;
  onElegir: (e: EleccionAnadir) => void;
  /** Cómo se llama cada repositorio (el nombre de su manifiesto). */
  nombres: Readonly<Record<RepositorioDeAnadir, string>>;
  conteos: ConteosAnadir;
};

/**
 * El selector de repositorio del panel «Añadir» (REQ-013): Todos · Sempertex · Mobiliario · Escenografía, cada uno con cuántas
 * entradas tiene. Botones con `aria-pressed` y 44 px de alto en el teléfono (el nombre arriba y la cuenta debajo, para que
 * los cuatro quepan en 390 px).
 */
export const SelectorRepositorio = memo(function SelectorRepositorio({ opciones, eleccion, onElegir, nombres, conteos }: Props) {
  const total = opciones.reduce((suma, id) => (id === "todos" ? suma : suma + conteos[id]), 0);
  return (
    <div role="group" aria-label="Repositorio" className="flex gap-1 rounded-[10px] bg-taller-barra p-[3px]">
      {opciones.map((id) => {
        const nombre = id === "todos" ? "Todos" : nombres[id];
        const cuenta = id === "todos" ? total : conteos[id];
        return (
          <button key={id} type="button" aria-pressed={eleccion === id} onClick={() => onElegir(id)} title={nombre}
            className={`${OPCION} ${eleccion === id ? SEG_ON : ""}`}>
            <span className="max-w-full truncate">{nombre}</span>
            <span className="font-mono text-[11px] font-normal text-taller-suave">{cuenta}</span>
          </button>
        );
      })}
    </div>
  );
});
