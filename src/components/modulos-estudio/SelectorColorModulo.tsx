"use client";

import { useState } from "react";
import { acabadoDe, coloresPorAcabado, nombreColor } from "@/lib/modulos-estudio/configuracion";
import { referenciaPorCodigo } from "@/lib/plan/referencia-sempertex";

/**
 * Color y acabado de UN globo: primero el acabado (Fashion mate, Reflex cromado, Silk perlado, Cristal…) y debajo los
 * colores que existen en ese acabado y en el tamaño elegido, tal como los trae el catálogo Sempertex. Elegir un color
 * cambia el globo marcado; el acabado se deduce del código (ver `configuracion.ts`).
 */
export function SelectorColorModulo({ formatoId, codigo, etiqueta, onElegir }: { formatoId: string; codigo: string; etiqueta: string; onElegir: (codigo: string) => void }) {
  const grupos = coloresPorAcabado(formatoId);
  const familiaDelColor = referenciaPorCodigo(codigo)?.familia ?? grupos[0]?.familia;
  // La pestaña es del globo elegido: si la persona la cambia, se queda hasta que elija otro color o globo.
  const [pestana, setPestana] = useState<{ para: string; familia: string } | null>(null);
  const familia = pestana?.para === codigo ? pestana.familia : familiaDelColor;
  const actual = grupos.find((g) => g.familia === familia) ?? grupos[0];

  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label={`Acabado de ${etiqueta}`} className="flex flex-wrap gap-1.5">
        {grupos.map((g) => (
          <button
            key={g.familia}
            type="button"
            role="radio"
            aria-checked={g.familia === actual?.familia}
            onClick={() => setPestana({ para: codigo, familia: g.familia })}
            className={`min-h-9 rounded-full px-3 text-xs font-medium ring-1 transition-colors ${g.familia === actual?.familia ? "bg-acento text-sobre-acento ring-acento" : "bg-superficie text-texto ring-borde hover:bg-superficie-suave"}`}
          >
            {g.nombre}
          </button>
        ))}
      </div>
      <div role="group" aria-label={`Color de ${etiqueta}`} className="flex flex-wrap gap-2">
        {actual?.colores.map((c) => (
          <button
            key={c.codigo}
            type="button"
            onClick={() => onElegir(c.codigo)}
            aria-pressed={c.codigo === codigo}
            title={`${c.nombreCompleto} · ${c.codigo}`}
            aria-label={`${c.nombreCompleto} ${c.codigo}`}
            className={`size-10 rounded-full ring-2 ring-offset-2 ring-offset-superficie transition-shadow sm:size-8 ${c.codigo === codigo ? "ring-acento" : "ring-transparent hover:ring-borde"}`}
            style={{ background: c.hexGlobo, boxShadow: "inset 0 0 0 1px rgba(0,0,0,.14)" }}
          />
        ))}
      </div>
      <p className="text-sm text-texto" aria-live="polite">
        {nombreColor(codigo)} <span className="text-texto-suave">· {acabadoDe(codigo)} · {codigo}</span>
      </p>
    </div>
  );
}
