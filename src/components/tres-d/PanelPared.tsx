"use client";

import { useState } from "react";
import { coloresDelFormato, formatoPorId } from "@/lib/globos3d/formatos";
import { PATRONES_MALLA, type PatronMalla } from "@/lib/globos3d/paredes";
import { Deslizador, SelectorColor } from "./PanelFlor";

export type OpcionesPared = {
  formatoId: "LOL-6" | "LOL-12";
  infladoCm: number;
  anchoCm: number;
  altoCm: number;
  patron: PatronMalla;
  colores: string[];
  union: { infladoCm: number; codigo: string };
};

/** Los valores del mural flor de Celebra ed. 2 (LOL Violeta, Lila, Fucsia y Rosado; uniones Pastel Rosado). */
export const PARED_INICIAL: OpcionesPared = { formatoId: "LOL-12", infladoCm: 24, anchoCm: 300, altoCm: 225, patron: "rombos", colores: ["051", "650", "012", "009"], union: { infladoCm: 10, codigo: "609" } };

const BOTON = "min-h-10 rounded-xl px-2 text-sm ring-1 transition-colors";
const ACTIVO = "bg-acento text-sobre-acento ring-acento";
const INACTIVO = "bg-superficie text-texto ring-borde hover:bg-superficie-suave";
const m = (cm: number) => `${(cm / 100).toLocaleString("es-CO", { maximumFractionDigits: 2 })} m`;

/** Editor de la malla Link-O-Loon tipo flor: medidas, eslabón, patrón y colores de las flores y de las uniones. */
export function PanelPared({ valor, onCambio }: { valor: OpcionesPared; onCambio: (v: OpcionesPared) => void }) {
  const [puesto, setPuesto] = useState<number | "union">(0);
  const patron = PATRONES_MALLA.find((p) => p.id === valor.patron) ?? PATRONES_MALLA[0]!;
  const fLol = formatoPorId(valor.formatoId)!;
  const pon = (cambio: Partial<OpcionesPared>) => onCambio({ ...valor, ...cambio });
  const elegirFormato = (formatoId: OpcionesPared["formatoId"]) => {
    const f = formatoPorId(formatoId)!;
    const existen = coloresDelFormato(formatoId);
    pon({ formatoId, infladoCm: f.id === "LOL-6" ? 12 : 24, colores: valor.colores.map((c) => (existen.some((e) => e.codigo === c) ? c : existen[0]?.codigo ?? c)) });
  };
  const puestoValido = puesto === "union" || puesto < patron.colores ? puesto : 0;

  return (
    <>
      <section className="flex flex-col gap-2 rounded-2xl bg-superficie p-3 ring-1 ring-borde">
        <h2 className="text-sm font-semibold text-texto">Malla Link-O-Loon tipo flor</h2>
        <p className="text-xs text-texto-suave">Cadenetas en diagonal con una pareja de unión en cada cruce; cada 4 eslabones forman una flor.</p>
        <Deslizador id="pared-ancho" etiqueta="Ancho" valor={valor.anchoCm} min={80} max={500} paso={10} texto={m(valor.anchoCm)} onCambio={(v) => pon({ anchoCm: v })} />
        <Deslizador id="pared-alto" etiqueta="Alto" valor={valor.altoCm} min={80} max={350} paso={10} texto={m(valor.altoCm)} onCambio={(v) => pon({ altoCm: v })} />
        <div className="grid grid-cols-2 gap-1">
          {(["LOL-6", "LOL-12"] as const).map((id) => (
            <button key={id} type="button" onClick={() => elegirFormato(id)} aria-pressed={valor.formatoId === id} className={`${BOTON} ${valor.formatoId === id ? ACTIVO : INACTIVO}`}>{id}</button>
          ))}
        </div>
        <Deslizador id="pared-inflado" etiqueta="Inflado del eslabón" valor={valor.infladoCm} min={Math.round(fLol.diametroMaxCm * 0.6)} max={fLol.diametroMaxCm} paso={0.5} texto={`${valor.infladoCm} cm`} onCambio={(v) => pon({ infladoCm: v })} />
      </section>

      <section className="flex flex-col gap-2 rounded-2xl bg-superficie p-3 ring-1 ring-borde">
        <h2 className="text-sm font-semibold text-texto">Colores</h2>
        <div className="grid grid-cols-2 gap-1">
          {PATRONES_MALLA.map((p) => (
            <button key={p.id} type="button" onClick={() => { pon({ patron: p.id }); setPuesto(0); }} aria-pressed={valor.patron === p.id} className={`${BOTON} ${valor.patron === p.id ? ACTIVO : INACTIVO}`}>{p.nombre}</button>
          ))}
        </div>
        <p className="text-xs text-texto-suave">{patron.descripcion}</p>
        <div className="flex flex-wrap items-center gap-2">
          {Array.from({ length: patron.colores }, (_, i) => {
            const ref = coloresDelFormato(valor.formatoId).find((c) => c.codigo === valor.colores[i]);
            return (
              <button key={i} type="button" onClick={() => setPuesto(i)} aria-pressed={puestoValido === i} title={`Flores ${i + 1}: ${ref?.nombreCompleto ?? ""}`} aria-label={`Color de flores ${i + 1}: ${ref?.nombreCompleto ?? ""}`}
                className={`grid size-10 place-items-center rounded-full font-mono text-xs ring-2 ring-offset-2 ring-offset-superficie ${puestoValido === i ? "ring-acento" : "ring-borde"}`}
                style={{ background: ref?.hexGlobo, color: "rgba(0,0,0,.55)" }}>{i + 1}</button>
            );
          })}
          <button type="button" onClick={() => setPuesto("union")} aria-pressed={puestoValido === "union"} title="Parejas de unión"
            className={`inline-flex min-h-10 items-center gap-2 rounded-full px-3 text-xs ring-2 ring-offset-2 ring-offset-superficie ${puestoValido === "union" ? "ring-acento" : "ring-borde"}`}>
            <span className="size-4 rounded-full" style={{ background: coloresDelFormato("R-5").find((c) => c.codigo === valor.union.codigo)?.hexGlobo }} /> Uniones R-5
          </button>
        </div>
        {puestoValido === "union" ? (
          <>
            <Deslizador id="union-inflado" etiqueta="Inflado de las uniones" valor={valor.union.infladoCm} min={6} max={12.5} paso={0.5} texto={`${valor.union.infladoCm} cm`} onCambio={(v) => pon({ union: { ...valor.union, infladoCm: v } })} />
            <SelectorColor formatoId="R-5" valor={valor.union.codigo} onCambio={(codigo) => pon({ union: { ...valor.union, codigo } })} etiqueta="Color de las uniones" />
          </>
        ) : (
          <SelectorColor formatoId={valor.formatoId} valor={valor.colores[puestoValido] ?? ""} onCambio={(codigo) => pon({ colores: valor.colores.map((c, i) => (i === puestoValido ? codigo : c)) })} etiqueta={`Color de las flores ${puestoValido + 1}`} />
        )}
      </section>
    </>
  );
}
