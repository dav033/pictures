"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Clock, Gauge } from "lucide-react";
import type { GuiaPiezaPlan, PasoPlanGuiado } from "@/lib/ia/guiado/generar-pasos-plan";
import type { GuiaArmado } from "@/lib/ia/guiado/guias-armado";
import { EASE_SALIDA } from "./animacion/movimiento";
import { conMayuscula, medidasEnPalabras, textoGlobos } from "./formato";
import { Plegable } from "./Plegable";

/**
 * «Aprender a hacerlo» de un plan: primero los pasos del plan como lista que se va marcando, con su progreso;
 * después, plegada por pieza, la guía aproximada de armado (herramientas, pasos, consejos y fuentes).
 */
export function GuiaPlan({ pasos, guias }: { pasos: readonly PasoPlanGuiado[]; guias: readonly GuiaPiezaPlan[] }) {
  const [hechos, setHechos] = useState<ReadonlySet<number>>(() => new Set());
  const total = pasos.length;
  const progreso = total ? hechos.size / total : 0;
  const alternar = (orden: number) => setHechos((actuales) => {
    const siguiente = new Set(actuales);
    if (siguiente.has(orden)) siguiente.delete(orden); else siguiente.add(orden);
    return siguiente;
  });

  return (
    <section className="mt-3 w-full rounded-3xl border border-borde-suave bg-superficie p-4 shadow-[0_1px_2px_var(--sombra)] sm:p-5" aria-label="Cómo armar tu plan">
      <p className="text-xs font-semibold uppercase tracking-wide text-acento">Paso a paso</p>
      <h3 className="mt-1 text-lg font-semibold text-texto">Cómo armar tu decoración</h3>
      <p className="mt-1 text-sm text-texto-suave">Marca cada paso cuando lo termines. Las cantidades son las de tu plan.</p>

      {total > 0 && (
        <>
          <div className="mt-4 flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-superficie-2" role="progressbar" aria-label="Pasos terminados" aria-valuemin={0} aria-valuemax={total} aria-valuenow={hechos.size}>
              <motion.div className="h-full origin-left rounded-full bg-exito" initial={false} animate={{ scaleX: progreso }} transition={{ duration: 0.4, ease: EASE_SALIDA }} />
            </div>
            <span className="shrink-0 text-xs tabular-nums text-texto-suave">{hechos.size} de {total}</span>
          </div>
          <ol className="mt-4 space-y-1">
            {pasos.map((paso) => (
              <PasoMarcable key={paso.orden} paso={paso} hecho={hechos.has(paso.orden)} onAlternar={() => alternar(paso.orden)} />
            ))}
          </ol>
        </>
      )}

      {guias.length > 0 && (
        <div className="mt-5 space-y-2.5">
          <h4 className="text-sm font-semibold text-texto">Guía aproximada por pieza</h4>
          {guias.map((item) => {
            const medidas = medidasEnPalabras(item.medidas);
            return (
              <Plegable
                key={item.estructura_id}
                titulo={`${item.nombre}${medidas ? ` · ${medidas}` : ""}`}
                subtitulo={<ChipsGuia guia={item.guia} />}
              >
                {item.globos.length > 0 && (
                  <p className="text-sm text-texto-suave">Lleva {item.globos.map((globo) => textoGlobos(globo.cantidad, globo.color, globo.tamano)).join(", ")}.</p>
                )}
                <ContenidoGuia guia={item.guia} />
              </Plegable>
            );
          })}
        </div>
      )}
    </section>
  );
}

function PasoMarcable({ paso, hecho, onAlternar }: { paso: PasoPlanGuiado; hecho: boolean; onAlternar: () => void }) {
  const reducido = useReducedMotion();
  return (
    <li>
      <button
        type="button"
        role="checkbox"
        aria-checked={hecho}
        onClick={onAlternar}
        className="flex min-h-11 w-full items-start gap-3 rounded-xl px-1 py-2 text-left transition-colors hover:bg-superficie-suave focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50"
      >
        <span className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border-2 transition-colors ${hecho ? "border-exito bg-exito text-fondo" : "border-borde"}`} aria-hidden>
          {hecho && (
            <svg viewBox="0 0 16 16" className="size-3.5" fill="none">
              <motion.path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" initial={reducido ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.25, ease: EASE_SALIDA }} />
            </svg>
          )}
        </span>
        <span className={`text-sm leading-6 transition-colors ${hecho ? "text-texto-suave line-through" : "text-texto"}`}>
          <span className="sr-only">Paso {paso.orden}: </span>{paso.texto}
        </span>
      </button>
    </li>
  );
}

/** Dificultad y tiempo de una guía, como chips. */
export function ChipsGuia({ guia }: { guia: GuiaArmado }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      <span className="inline-flex items-center gap-1 rounded-full bg-superficie-2 px-2 py-0.5 text-xs text-texto-suave"><Gauge className="size-3.5" aria-hidden />Dificultad {guia.dificultad}</span>
      <span className="inline-flex min-w-0 items-center gap-1 rounded-full bg-superficie-2 px-2 py-0.5 text-xs text-texto-suave"><Clock className="size-3.5 shrink-0" aria-hidden /><span className="line-clamp-1">{tiempoCorto(guia.tiempo_aprox)}</span></span>
    </span>
  );
}

/** Herramientas, pasos, consejos y fuentes de una guía de armado (los dos últimos, plegados). */
export function ContenidoGuia({ guia }: { guia: GuiaArmado }) {
  const consejos = [...guia.reglas_aproximadas, ...guia.consejos];
  return (
    <div className="mt-3 space-y-3 text-sm text-texto">
      <p className="text-xs text-texto-suave">{conMayuscula(guia.tiempo_aprox)}</p>
      <div>
        <p className="font-medium">Herramientas y materiales</p>
        <ul className="ml-5 mt-1 list-disc space-y-1">{[...guia.herramientas, ...guia.materiales_base].map((item, indice) => <li key={indice}>{item}</li>)}</ul>
      </div>
      <ol className="space-y-2">
        {guia.pasos.map((paso, indice) => <li key={indice}><strong>{indice + 1}. {paso.titulo}.</strong> {paso.detalle}</li>)}
      </ol>
      {consejos.length > 0 && (
        <Plegable titulo="Consejos" variante="linea">
          <ul className="ml-5 list-disc space-y-1">{consejos.map((item, indice) => <li key={indice}>{item}</li>)}</ul>
        </Plegable>
      )}
      {guia.fuentes.length > 0 && (
        <Plegable titulo="Fuentes" variante="linea">
          <ul className="ml-5 list-disc space-y-1">{guia.fuentes.map((fuente) => <li key={fuente.url}><a className="text-acento underline underline-offset-2" href={fuente.url} target="_blank" rel="noreferrer">{fuente.titulo}</a></li>)}</ul>
        </Plegable>
      )}
    </div>
  );
}

/** «2-3 horas para un arco de 3-4 m, 1 persona…» → «2-3 horas»: la frase completa va dentro de la guía. */
function tiempoCorto(tiempo: string): string {
  const corto = tiempo.split(/[,;(]| para /)[0]!.trim();
  return corto.length > 0 && corto.length <= 40 ? corto : tiempo.slice(0, 40);
}
