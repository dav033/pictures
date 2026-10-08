"use client";

import { useMemo } from "react";
import { ChevronRight } from "lucide-react";
import type { Pieza } from "@/lib/globos3d/piezas";
import type { ColorOrganico } from "@/lib/globos3d/organico";
import { coloresDelFormato } from "@/lib/globos3d/formatos";
import { FLORES_ARTIFICIALES, type OpcionesFlores, type TipoFlorArtificial } from "@/lib/globos3d/flores-artificiales";
import { piezaDeGenerador } from "@/lib/globos3d/generadores-organicos";
import { SILUETAS_TRAZO, cajaTrazo, escalarTrazo, puntosDeSilueta, type ParametrosTrazoOrganico } from "@/lib/globos3d/trazo-organico";
import { Deslizador, SelectorColor } from "./PanelFlor";
import { CHIP, CHIP_ON, metros } from "./ui-taller";

type Organico = Extract<Pieza, { tipo: "organico" }>;
type Props = { pieza: Organico; trazo: ParametrosTrazoOrganico; onPieza: (pieza: Pieza, agrupar?: string) => void };

const FORMATOS = ["R-36", "R-24", "R-18", "R-12", "R-9", "R-5"] as const;
const FOLLAJE = Object.values(FLORES_ARTIFICIALES);

/**
 * Editor solitario de la **guirnalda orgánica de trazo libre**: silueta, medidas por fuera, grosor, cuánto se abulta en
 * racimos, densidad, variante, mezcla de tamaños, colores con su peso y follaje (flores y hojas de tela). Todo cambia el
 * generador y la pieza se vuelve a armar desde él (la forma no se deforma al cambiar los colores, ni al revés).
 */
export function EditorTrazo({ pieza, trazo, onPieza }: Props) {
  const caja = useMemo(() => cajaTrazo(trazo), [trazo]);
  const grosor = useMemo(() => Math.max(...trazo.puntos.map((q) => q.grosor)), [trazo]);
  const silueta = trazo.silueta ?? null;
  const huecos = pieza.flores ? pieza.opciones.huecosFlores : 0;
  const pon = (t: ParametrosTrazoOrganico, agrupar?: string, flores: OpcionesFlores | null = pieza.flores, n = huecos || 10) => onPieza(piezaDeGenerador({ tipo: "trazo", trazo: t }, flores, n), agrupar);
  const ponColor = (i: number, cambio: Partial<ColorOrganico>) => pon({ ...trazo, colores: trazo.colores.map((c, j) => (j === i ? { ...c, ...cambio } : c)) });
  const totalPeso = trazo.colores.reduce((s, c) => s + c.peso, 0) || 1;
  const pesoDe = (f: string) => trazo.mezcla[f] ?? 0;
  const proporcion = pieza.flores?.proporcion ?? [];
  const ponFollaje = (proporcionNueva: OpcionesFlores["proporcion"]) =>
    pon(trazo, undefined, proporcionNueva.length ? { semilla: pieza.flores?.semilla ?? 9, proporcion: proporcionNueva, tallosPorRacimo: proporcionNueva.length > 1 ? 2 : 1 } : null, huecos || 10);

  return (
    <>
      <section className="flex flex-col gap-2.5" aria-label="Silueta">
        <h3 className="taller-rotulo">Silueta</h3>
        <div role="radiogroup" aria-label="Silueta" className="grid grid-cols-2 gap-1.5">
          {SILUETAS_TRAZO.map((s) => (
            <button key={s.id} type="button" role="radio" aria-checked={s.id === silueta} title={s.descripcion}
              onClick={() => pon({ ...trazo, silueta: s.id, puntos: puntosDeSilueta(s.id, { anchoCm: caja.anchoCm, altoCm: Math.max(caja.altoCm, grosor + 10), grosorCm: grosor }) })}
              className={`${CHIP} ${s.id === silueta ? CHIP_ON : ""} min-w-0 truncate px-2`}>{s.nombre}</button>
          ))}
        </div>
        {!silueta && <p className="text-xs text-taller-suave">Silueta libre ({trazo.puntos.length} puntos, de una foto o de la IA). Elegir una de arriba la reemplaza.</p>}
      </section>

      <section className="flex flex-col gap-2.5" aria-label="Medidas">
        <h3 className="taller-rotulo">Medidas</h3>
        <Deslizador id="trazo-ancho" etiqueta="Ancho (por fuera)" valor={Math.round(caja.anchoCm)} min={80} max={900} paso={10} texto={metros(caja.anchoCm)} onCambio={(v) => pon(escalarTrazo(trazo, { anchoCm: v }), "medida")} />
        <Deslizador id="trazo-alto" etiqueta="Alto (por fuera)" valor={Math.round(caja.altoCm)} min={40} max={400} paso={10} texto={metros(caja.altoCm)} onCambio={(v) => pon(escalarTrazo(trazo, { altoCm: v }), "medida")} />
        <Deslizador id="trazo-grosor" etiqueta="Grosor mayor" valor={Math.round(grosor)} min={20} max={140} paso={2} texto={`${Math.round(grosor)} cm`} onCambio={(v) => pon(escalarTrazo(trazo, { grosor: v / grosor }), "grosor")} />
        <Deslizador id="trazo-racimos" etiqueta="Racimos (bultos)" valor={Math.round((trazo.racimos ?? 0.35) * 100)} min={0} max={100} paso={5} texto={`${Math.round((trazo.racimos ?? 0.35) * 100)} %`} onCambio={(v) => pon({ ...trazo, racimos: v / 100 }, "racimos")} />
        <Deslizador id="trazo-densidad" etiqueta="Densidad" valor={trazo.densidad ?? 1.25} min={0.8} max={1.7} paso={0.05} texto={`${Math.round((trazo.densidad ?? 1.25) * 100)} %`} onCambio={(v) => pon({ ...trazo, densidad: v }, "densidad")} />
        <Deslizador id="trazo-semilla" etiqueta="Variante (azar)" valor={trazo.semilla} min={1} max={60} paso={1} texto={`#${trazo.semilla}`} onCambio={(v) => pon({ ...trazo, semilla: v }, "semilla")} />
      </section>

      <section className="flex flex-col gap-2.5" aria-label="Tamaños de globo">
        <h3 className="taller-rotulo">Tamaños de globo</h3>
        <p className="text-xs text-taller-suave">Cuánto pesa cada tamaño; los grandes solo van donde el cuerpo es grueso.</p>
        {FORMATOS.map((f) => (
          <Deslizador key={f} id={`trazo-${f}`} etiqueta={f} valor={Math.round(pesoDe(f) * 100)} min={0} max={70} paso={1} texto={`${Math.round(pesoDe(f) * 100)}`}
            onCambio={(v) => {
              const mezcla = { ...trazo.mezcla, [f]: v / 100 };
              if (Object.values(mezcla).some((w) => w > 0)) pon({ ...trazo, mezcla }, `tamano-${f}`);
            }} />
        ))}
      </section>

      <section className="flex flex-col gap-2.5" aria-label="Colores">
        <h3 className="taller-rotulo">Colores</h3>
        {trazo.colores.map((c, i) => {
          const ref = coloresDelFormato("R-12").find((x) => x.codigo === c.codigo);
          return (
            <details key={i} className="group rounded-xl bg-taller-tarjeta p-2">
              <summary className="flex cursor-pointer list-none items-center gap-2 text-[13px] [&::-webkit-details-marker]:hidden">
                <ChevronRight className="size-4 shrink-0 text-taller-suave transition-transform group-open:rotate-90" aria-hidden />
                <span className="size-5 rounded-full ring-1 ring-taller-borde" style={{ background: ref?.hexGlobo }} />
                <span className="min-w-0 flex-1 truncate">{ref?.nombreCompleto ?? c.codigo}{c.confeti ? " con confeti" : ""}</span>
                <span className="font-mono text-[11px] text-taller-suave">{Math.round((c.peso / totalPeso) * 100)} %</span>
              </summary>
              <div className="mt-2 flex flex-col gap-2">
                <Deslizador id={`trazo-peso-${i}`} etiqueta="Peso" valor={c.peso} min={0} max={80} paso={1} texto={`${c.peso}`} onCambio={(v) => ponColor(i, { peso: v })} />
                <label className="flex items-center gap-2 text-xs" htmlFor={`trazo-confeti-${i}`}>
                  <input id={`trazo-confeti-${i}`} type="checkbox" checked={Boolean(c.confeti)} onChange={(e) => ponColor(i, { confeti: e.target.checked })} /> Con confeti (en globos de cristal)
                </label>
                <SelectorColor formatoId="R-12" valor={c.codigo} onCambio={(codigo) => ponColor(i, { codigo })} etiqueta={`Color ${i + 1}`} />
                {trazo.colores.length > 1 && <button type="button" onClick={() => pon({ ...trazo, colores: trazo.colores.filter((_, j) => j !== i) })} className="min-h-8 self-start text-xs text-taller-acento hover:underline">Quitar este color</button>}
              </div>
            </details>
          );
        })}
        {trazo.colores.length < 6 && <button type="button" onClick={() => pon({ ...trazo, colores: [...trazo.colores, { codigo: "005", peso: 15 }] })} className="min-h-8 self-start text-xs text-taller-acento hover:underline">+ Añadir un color</button>}
      </section>

      <section className="flex flex-col gap-2.5" aria-label="Flores y hojas">
        <h3 className="taller-rotulo">Flores y hojas</h3>
        <div className="flex flex-wrap gap-1.5">
          {FOLLAJE.map((f) => {
            const activa = proporcion.find((p) => p.tipo === f.tipo);
            return (
              <button key={f.tipo} type="button" aria-pressed={Boolean(activa)} title={f.descripcion}
                onClick={() => ponFollaje(activa ? proporcion.filter((p) => p.tipo !== f.tipo) : [...proporcion, { tipo: f.tipo as TipoFlorArtificial, colorId: f.colores[0]!.id, peso: proporcion.length ? 1 : 2 }])}
                className={`${CHIP} ${activa ? CHIP_ON : ""}`}>{f.nombre}</button>
            );
          })}
        </div>
        {proporcion.map((p, i) => {
          const f = FLORES_ARTIFICIALES[p.tipo];
          return f.colores.length > 1 ? (
            <div key={p.tipo} className="flex items-center gap-2 text-xs">
              <span className="w-28 truncate">{f.nombre}</span>
              {f.colores.map((c) => (
                <button key={c.id} type="button" aria-pressed={c.id === p.colorId} onClick={() => ponFollaje(proporcion.map((x, j) => (j === i ? { ...x, colorId: c.id } : x)))}
                  className={`${CHIP} ${c.id === p.colorId ? CHIP_ON : ""} gap-1.5`}><span className="size-3 rounded-full" style={{ background: c.hex }} />{c.nombre}</button>
              ))}
            </div>
          ) : null;
        })}
        {pieza.flores && <Deslizador id="trazo-huecos" etiqueta="Cuántos racimos" valor={huecos} min={2} max={40} paso={1} texto={`${huecos}`} onCambio={(v) => pon(trazo, "huecos", pieza.flores, v)} />}
        <p className="text-xs text-taller-suave">Las flores y hojas son de tela: no cuentan como globos en la cotización.</p>
      </section>
    </>
  );
}
