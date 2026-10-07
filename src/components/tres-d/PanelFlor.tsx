"use client";

import { useMemo } from "react";
import { NOMBRE_FAMILIA, coloresDelFormato, formatoPorId } from "@/lib/globos3d/formatos";
import { FLORES_PREDEFINIDAS, type ParteGlobo, type PropiedadesFlor, type ReglaDecoracion } from "@/lib/globos3d/decoraciones";

export type DondeDecoracion = "sola" | "columna" | "arco" | "pared";

const BOTON = "min-h-10 rounded-xl px-2 text-sm ring-1 transition-colors";
const ACTIVO = "bg-acento text-sobre-acento ring-acento";
const INACTIVO = "bg-superficie text-texto ring-borde hover:bg-superficie-suave";
const FORMATOS_PETALO = ["R-5", "R-9", "R-12", "LOL-6", "C-12"] as const;
const FORMATOS_CENTRO = ["R-5", "R-9"] as const;
const cm = (v: number) => `${v.toLocaleString("es-CO", { maximumFractionDigits: 1 })} cm`;

/** Colores oficiales que existen en ese formato, agrupados por familia (solo se ofrecen los que se fabrican). */
export function SelectorColor({ formatoId, valor, onCambio, etiqueta }: { formatoId: string; valor: string; onCambio: (codigo: string) => void; etiqueta: string }) {
  const grupos = useMemo(() => {
    const mapa = new Map<string, ReturnType<typeof coloresDelFormato>>();
    for (const c of coloresDelFormato(formatoId)) mapa.set(c.familia, [...(mapa.get(c.familia) ?? []), c]);
    return [...mapa.entries()];
  }, [formatoId]);
  return (
    <div className="max-h-40 overflow-y-auto pr-1" role="group" aria-label={etiqueta}>
      {grupos.map(([familia, lista]) => (
        <div key={familia} className="mb-1.5">
          <p className="font-mono text-[0.65rem] uppercase tracking-wider text-texto-suave">{NOMBRE_FAMILIA[familia] ?? familia}</p>
          <div className="mt-0.5 flex flex-wrap gap-1">
            {lista.map((c) => (
              <button key={c.codigo} type="button" onClick={() => onCambio(c.codigo)} aria-pressed={c.codigo === valor} title={`${c.nombreCompleto} ${c.codigo}`} aria-label={`${c.nombreCompleto} ${c.codigo}`}
                className={`size-7 rounded-full ring-2 ring-offset-1 ring-offset-superficie ${c.codigo === valor ? "ring-acento" : "ring-transparent hover:ring-borde"}`}
                style={{ background: c.hexGlobo, boxShadow: "inset 0 0 0 1px rgba(0,0,0,.12)" }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function Deslizador({ id, etiqueta, valor, min, max, paso, texto, onCambio }: { id: string; etiqueta: string; valor: number; min: number; max: number; paso: number; texto: string; onCambio: (v: number) => void }) {
  return (
    <div>
      <label htmlFor={id} className="flex items-baseline justify-between text-xs font-semibold text-texto">{etiqueta}<span className="font-mono font-normal text-texto-suave">{texto}</span></label>
      <input id={id} type="range" min={min} max={max} step={paso} value={valor} onChange={(e) => onCambio(Number(e.target.value))} className="w-full accent-[var(--color-acento,#7c3aed)]" />
    </div>
  );
}

/** Ajusta una parte al cambiar de formato: inflado dentro del rango y un color que exista en ese formato. */
function conFormato<T extends ParteGlobo>(parte: T, formatoId: string): T {
  const formato = formatoPorId(formatoId);
  if (!formato) return parte;
  const colores = coloresDelFormato(formatoId);
  const infladoCm = Math.min(formato.diametroMaxCm, Math.max(formato.diametroMaxCm * 0.4, formato.infladoDecoracionCm));
  return { ...parte, formatoId, infladoCm, codigo: colores.some((c) => c.codigo === parte.codigo) ? parte.codigo : colores[0]?.codigo ?? parte.codigo };
}

type Props = {
  flor: PropiedadesFlor;
  onFlor: (flor: PropiedadesFlor) => void;
  donde: DondeDecoracion;
  onDonde: (donde: DondeDecoracion) => void;
  regla: ReglaDecoracion;
  onRegla: (regla: ReglaDecoracion) => void;
};

/**
 * Editor de una flor de globos por propiedades: flores predefinidas como punto de partida, y cada propiedad de
 * los pétalos y del centro editable. Abajo, dónde va: sola, o colgada de las anclas de la columna o del arco
 * con una regla (cada cuántos cuartetos y en cuántas caras).
 */
export function PanelFlor({ flor, onFlor, donde, onDonde, regla, onRegla }: Props) {
  const { petalos, centro } = flor;
  const fP = formatoPorId(petalos.formatoId)!;
  const fC = centro ? formatoPorId(centro.formatoId) : undefined;
  const ponPetalos = (cambio: Partial<PropiedadesFlor["petalos"]>) => onFlor({ ...flor, petalos: { ...petalos, ...cambio } });
  const ponCentro = (cambio: Partial<NonNullable<PropiedadesFlor["centro"]>>) => centro && onFlor({ ...flor, centro: { ...centro, ...cambio } });

  return (
    <>
      <section className="rounded-2xl bg-superficie p-3 ring-1 ring-borde">
        <h2 className="mb-2 text-sm font-semibold text-texto">Flor de globos</h2>
        <div className="grid grid-cols-2 gap-1.5">
          {FLORES_PREDEFINIDAS.map((f) => (
            <button key={f.id} type="button" title={f.descripcion} onClick={() => onFlor(f.propiedades)} className={`${BOTON} ${INACTIVO}`}>{f.nombre}</button>
          ))}
        </div>
        <p className="mt-2 text-xs text-texto-suave">Elige una para empezar; después cambia cualquier propiedad.</p>
      </section>

      <section className="flex flex-col gap-2 rounded-2xl bg-superficie p-3 ring-1 ring-borde">
        <h2 className="text-sm font-semibold text-texto">Pétalos</h2>
        <Deslizador id="petalos-cantidad" etiqueta="Cantidad" valor={petalos.cantidad} min={3} max={8} paso={1} texto={`${petalos.cantidad} pétalos`} onCambio={(v) => ponPetalos({ cantidad: v })} />
        <div className="grid grid-cols-5 gap-1">
          {FORMATOS_PETALO.map((id) => (
            <button key={id} type="button" onClick={() => onFlor({ ...flor, petalos: conFormato(petalos, id) })} aria-pressed={id === petalos.formatoId} className={`${BOTON} ${id === petalos.formatoId ? ACTIVO : INACTIVO}`}>{id}</button>
          ))}
        </div>
        <Deslizador id="petalos-inflado" etiqueta="Inflado" valor={petalos.infladoCm} min={Math.round(fP.diametroMaxCm * 0.4)} max={fP.diametroMaxCm} paso={0.5} texto={cm(petalos.infladoCm)} onCambio={(v) => ponPetalos({ infladoCm: v })} />
        <Deslizador id="petalos-apertura" etiqueta="Apertura" valor={petalos.aperturaGrados} min={0} max={60} paso={1} texto={`${petalos.aperturaGrados}° ${petalos.aperturaGrados < 10 ? "(plana)" : petalos.aperturaGrados > 35 ? "(copa)" : ""}`} onCambio={(v) => ponPetalos({ aperturaGrados: v })} />
        <Deslizador id="petalos-giro" etiqueta="Giro" valor={petalos.giroGrados} min={0} max={360} paso={5} texto={`${petalos.giroGrados}°`} onCambio={(v) => ponPetalos({ giroGrados: v })} />
        <SelectorColor formatoId={petalos.formatoId} valor={petalos.codigo} onCambio={(codigo) => ponPetalos({ codigo })} etiqueta="Color de los pétalos" />
      </section>

      <section className="flex flex-col gap-2 rounded-2xl bg-superficie p-3 ring-1 ring-borde">
        <label className="flex items-center gap-2 text-sm font-semibold text-texto" htmlFor="con-centro">
          <input id="con-centro" type="checkbox" checked={Boolean(centro)} onChange={(e) => onFlor({ ...flor, centro: e.target.checked ? { formatoId: "R-5", infladoCm: 8, codigo: "570", cantidad: 1 } : null })} />
          Centro
        </label>
        {centro && fC && (
          <>
            <div className="grid grid-cols-4 gap-1">
              {FORMATOS_CENTRO.map((id) => (
                <button key={id} type="button" onClick={() => onFlor({ ...flor, centro: conFormato(centro, id) })} aria-pressed={id === centro.formatoId} className={`${BOTON} ${id === centro.formatoId ? ACTIVO : INACTIVO}`}>{id}</button>
              ))}
              {([1, 3] as const).map((n) => (
                <button key={n} type="button" onClick={() => ponCentro({ cantidad: n })} aria-pressed={centro.cantidad === n} className={`${BOTON} ${centro.cantidad === n ? ACTIVO : INACTIVO}`}>{n === 1 ? "Uno" : "Trío"}</button>
              ))}
            </div>
            <Deslizador id="centro-inflado" etiqueta="Inflado" valor={centro.infladoCm} min={Math.round(fC.diametroMaxCm * 0.4)} max={fC.diametroMaxCm} paso={0.5} texto={cm(centro.infladoCm)} onCambio={(v) => ponCentro({ infladoCm: v })} />
            <SelectorColor formatoId={centro.formatoId} valor={centro.codigo} onCambio={(codigo) => ponCentro({ codigo })} etiqueta="Color del centro" />
          </>
        )}
      </section>

      <section className="flex flex-col gap-2 rounded-2xl bg-superficie p-3 ring-1 ring-borde">
        <h2 className="text-sm font-semibold text-texto">Dónde va</h2>
        <div className="grid grid-cols-2 gap-1">
          {([["sola", "Sola"], ["columna", "En la columna"], ["arco", "En el arco"], ["pared", "En la pared"]] as const).map(([valor, etiqueta]) => (
            <button key={valor} type="button" onClick={() => onDonde(valor)} aria-pressed={donde === valor} className={`${BOTON} ${donde === valor ? ACTIVO : INACTIVO}`}>{etiqueta}</button>
          ))}
        </div>
        {donde !== "sola" && (
          <>
            <Deslizador id="regla-cada" etiqueta={donde === "pared" ? "Cada cuántas flores de la malla" : "Cada cuántos cuartetos"} valor={regla.cadaNiveles} min={1} max={6} paso={1} texto={regla.cadaNiveles === 1 ? "en todas" : `1 de cada ${regla.cadaNiveles}`} onCambio={(v) => onRegla({ ...regla, cadaNiveles: v })} />
            {donde !== "pared" && <div className="grid grid-cols-3 gap-1">
              {([1, 2, 4] as const).map((n) => (
                <button key={n} type="button" onClick={() => onRegla({ ...regla, caras: n })} aria-pressed={regla.caras === n} className={`${BOTON} ${regla.caras === n ? ACTIVO : INACTIVO}`}>{n === 1 ? "1 cara" : `${n} caras`}</button>
              ))}
            </div>}
            <p className="text-xs text-texto-suave">{donde === "pared" ? "Las flores van en los centros de flor de la malla, al frente." : "Las flores van en los huecos entre globos."} La columna, el arco y la pared son los que armaste en sus pestañas.</p>
          </>
        )}
      </section>
    </>
  );
}
