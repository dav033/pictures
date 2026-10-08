"use client";

import { ChevronRight } from "lucide-react";
import { coloresDelFormato } from "@/lib/globos3d/formatos";
import { COLUMNA_QUINCE_AZUL } from "@/lib/globos3d/organico-presets";
import { formaColumna, type ColorOrganico, type OpcionesOrganico } from "@/lib/globos3d/organico";
import { Deslizador, SelectorColor } from "./PanelFlor";

/** Lo que se puede cambiar de la columna orgánica desde la pantalla; el resto sale del preset. */
export type AjustesOrganico = {
  semilla: number;
  altoCm: number;
  /** Multiplica el grosor de la columna (1 = el del preset). */
  grosor: number;
  densidad: number;
  colores: ColorOrganico[];
  conFlores: boolean;
  huecosFlores: number;
  conPedestal: boolean;
};

const BASE = COLUMNA_QUINCE_AZUL.opciones;

export const AJUSTES_QUINCE_AZUL: AjustesOrganico = {
  semilla: BASE.semilla, altoCm: 230, grosor: 1, densidad: 1, colores: BASE.colores.map((c) => ({ ...c })),
  conFlores: true, huecosFlores: BASE.huecosFlores, conPedestal: true,
};

/** Las opciones del motor orgánico a partir del preset y los ajustes de pantalla. */
export function opcionesDeAjustes(a: AjustesOrganico): OpcionesOrganico {
  const columna = formaColumna({ altoCm: a.altoCm, radioBaseCm: 42 * a.grosor, radioMedioCm: 36 * a.grosor, radioPuntaCm: 27 * a.grosor, inclinacionCm: 8, serpenteoCm: 3 });
  return { ...BASE, semilla: a.semilla, densidad: a.densidad, colores: a.colores, huecosFlores: a.conFlores ? a.huecosFlores : 0, tramos: [columna, ...BASE.tramos.slice(1)] };
}

/**
 * Los ajustes de pantalla de una pieza orgánica ya armada (el editor solitario): semilla, densidad, colores y flores;
 * alto y grosor salen de su primer tramo si es una columna (la de XV o una igual).
 */
export function ajustesDeOpciones(o: OpcionesOrganico, conFlores: boolean): AjustesOrganico & { esColumna: boolean } {
  const tramo = o.tramos[0];
  const esColumna = tramo?.id === "columna" && tramo.recorrido.length > 1 && tramo.grosor.length >= 4;
  const punta = esColumna ? tramo.grosor[3]!.radioCm : 27;
  const fin = esColumna ? tramo.recorrido[tramo.recorrido.length - 1]!.y : 0;
  return {
    semilla: o.semilla, densidad: o.densidad ?? 1, colores: o.colores.map((c) => ({ ...c })), huecosFlores: o.huecosFlores || BASE.huecosFlores, conFlores, conPedestal: false,
    altoCm: esColumna ? Math.round(fin + punta * 0.8) : 230, grosor: esColumna ? Math.round((tramo.grosor[0]!.radioCm / 42) * 100) / 100 : 1, esColumna,
  };
}

/**
 * Lleva los ajustes de pantalla a las opciones de una pieza orgánica: semilla, densidad, colores y huecos de flores sobre
 * las que ya tiene; si es una columna y cambiaron su alto o su grosor, su primer tramo se rehace como la de XV.
 */
export function aplicarAjustes(o: OpcionesOrganico, antes: AjustesOrganico, a: AjustesOrganico): OpcionesOrganico {
  const forma = a.altoCm !== antes.altoCm || a.grosor !== antes.grosor;
  const tramos = forma ? [formaColumna({ altoCm: a.altoCm, radioBaseCm: 42 * a.grosor, radioMedioCm: 36 * a.grosor, radioPuntaCm: 27 * a.grosor, inclinacionCm: 8, serpenteoCm: 3 }), ...o.tramos.slice(1)] : o.tramos;
  return { ...o, semilla: a.semilla, densidad: a.densidad, colores: a.colores, huecosFlores: a.conFlores ? a.huecosFlores : 0, tramos };
}

const BOTON = "min-h-11 rounded-[9px] px-2 text-sm ring-1 transition-colors lg:min-h-8 lg:text-xs";
const INACTIVO = "bg-superficie text-texto ring-borde hover:bg-superficie-suave";

/** Editor de la columna orgánica: forma, azar (semilla), densidad, mezcla de colores por peso, flores y pedestal. */
export function PanelOrganico({ valor, onCambio, conForma = true, conPedestal = true }: {
  valor: AjustesOrganico; onCambio: (v: AjustesOrganico) => void;
  /** Alto y grosor (solo si es una columna). */
  conForma?: boolean;
  /** «Mostrar el pedestal» (en la escena el pedestal es una pieza aparte). */
  conPedestal?: boolean;
}) {
  const pon = (cambio: Partial<AjustesOrganico>) => onCambio({ ...valor, ...cambio });
  const ponColor = (i: number, cambio: Partial<ColorOrganico>) => pon({ colores: valor.colores.map((c, j) => (j === i ? { ...c, ...cambio } : c)) });
  const totalPeso = valor.colores.reduce((s, c) => s + c.peso, 0) || 1;
  return (
    <>
      <section className="flex flex-col gap-2 rounded-2xl bg-superficie p-3 ring-1 ring-borde">
        <h2 className="text-sm font-semibold text-texto">Columna orgánica</h2>
        <button type="button" onClick={() => onCambio(AJUSTES_QUINCE_AZUL)} className={`${BOTON} ${INACTIVO}`}>Columna azul de XV con guirnalda</button>
        <p className="text-xs text-texto-suave">{COLUMNA_QUINCE_AZUL.descripcion}</p>
        {conForma && <Deslizador id="org-alto" etiqueta="Alto de la columna" valor={valor.altoCm} min={150} max={280} paso={5} texto={`${(valor.altoCm / 100).toLocaleString("es-CO", { maximumFractionDigits: 2 })} m`} onCambio={(v) => pon({ altoCm: v })} />}
        {conForma && <Deslizador id="org-grosor" etiqueta="Grosor" valor={valor.grosor} min={0.7} max={1.3} paso={0.05} texto={`${Math.round(valor.grosor * 100)} %`} onCambio={(v) => pon({ grosor: v })} />}
        <Deslizador id="org-densidad" etiqueta="Densidad" valor={valor.densidad} min={0.8} max={1.3} paso={0.05} texto={`${Math.round(valor.densidad * 100)} %`} onCambio={(v) => pon({ densidad: v })} />
        <Deslizador id="org-semilla" etiqueta="Variante (azar)" valor={valor.semilla} min={1} max={40} paso={1} texto={`#${valor.semilla}`} onCambio={(v) => pon({ semilla: v })} />
      </section>

      <section className="flex flex-col gap-3 rounded-2xl bg-superficie p-3 ring-1 ring-borde">
        <h2 className="text-sm font-semibold text-texto">Mezcla de colores</h2>
        <p className="text-xs text-texto-suave">Toca un color para cambiar su peso, su confeti o el color. Para cambiar un color en toda la columna, usa «Colores de la escena».</p>
        {valor.colores.map((c, i) => {
          const ref = coloresDelFormato("R-12").find((x) => x.codigo === c.codigo);
          return (
            <details key={i} className="group rounded-xl bg-superficie-suave p-2">
              <summary className="flex cursor-pointer list-none items-center gap-2 text-sm text-texto [&::-webkit-details-marker]:hidden">
                <ChevronRight className="size-4 shrink-0 text-texto-suave transition-transform group-open:rotate-90" aria-hidden />
                <span className="size-5 rounded-full ring-1 ring-borde" style={{ background: ref?.hexGlobo }} />
                {ref?.nombreCompleto ?? c.codigo}{c.confeti ? " con confeti" : ""}
                <span className="ml-auto font-mono text-xs text-texto-suave">{Math.round((c.peso / totalPeso) * 100)} %</span>
              </summary>
              <div className="mt-2 flex flex-col gap-2">
                <Deslizador id={`org-peso-${i}`} etiqueta="Peso" valor={c.peso} min={0} max={80} paso={1} texto={`${c.peso}`} onCambio={(v) => ponColor(i, { peso: v })} />
                <label className="flex items-center gap-2 text-xs text-texto" htmlFor={`org-confeti-${i}`}>
                  <input id={`org-confeti-${i}`} type="checkbox" checked={Boolean(c.confeti)} onChange={(e) => ponColor(i, { confeti: e.target.checked })} /> Con confeti (en globos de cristal)
                </label>
                <SelectorColor formatoId="R-12" valor={c.codigo} onCambio={(codigo) => ponColor(i, { codigo })} etiqueta={`Color ${i + 1}`} />
              </div>
            </details>
          );
        })}
      </section>

      <section className="flex flex-col gap-2 rounded-2xl bg-superficie p-3 ring-1 ring-borde">
        <h2 className="text-sm font-semibold text-texto">Flores y escena</h2>
        <label className="flex items-center gap-2 text-sm text-texto" htmlFor="org-flores">
          <input id="org-flores" type="checkbox" checked={valor.conFlores} onChange={(e) => pon({ conFlores: e.target.checked })} /> Flores artificiales en los huecos
        </label>
        {valor.conFlores && <Deslizador id="org-huecos" etiqueta="Racimos de flores" valor={valor.huecosFlores} min={2} max={30} paso={1} texto={`${valor.huecosFlores}`} onCambio={(v) => pon({ huecosFlores: v })} />}
        {conPedestal && <label className="flex items-center gap-2 text-sm text-texto" htmlFor="org-pedestal">
          <input id="org-pedestal" type="checkbox" checked={valor.conPedestal} onChange={(e) => pon({ conPedestal: e.target.checked })} /> Mostrar el pedestal
        </label>}
        <p className="text-xs text-texto-suave">Las flores son follaje: no cuentan como globos en la cotización.</p>
      </section>
    </>
  );
}
