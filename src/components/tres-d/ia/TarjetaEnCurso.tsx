"use client";

import { useEffect, useState } from "react";
import { Loader2, Square } from "lucide-react";
import type { ProgresoRefinado } from "../useRefinadoFoto";
import { pasoLegible } from "@/lib/globos3d/turnos-ia";
import { BurbujaPedido } from "./TarjetaTurno";
import type { EnCurso } from "./useAsistenteIA";

const FASE: Readonly<Record<EnCurso["fase"], string>> = { leyendo_foto: "Leyendo la foto…", pensando: "Pensando…" };

/** Los segundos que lleva trabajando la IA (se actualiza cada segundo). */
function useSegundos(desde: number): number {
  const [ahora, setAhora] = useState(() => Date.now());  // prerender-seguro: solo se pinta con un pedido en curso (PanelIA: `ia.enCurso &&`), nunca en el prerender
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return Math.max(0, Math.round((ahora - desde) / 1000));
}

/** El pedido que se está atendiendo: la fase, los pasos que la IA ya dio (en vivo) y «Detener». */
export function TarjetaEnCurso({ enCurso, alDetener }: { enCurso: EnCurso; alDetener: () => void }) {
  const segundos = useSegundos(enCurso.inicio);
  const ultimo = enCurso.pasos[enCurso.pasos.length - 1];
  return (
    <>
      <BurbujaPedido pedido={enCurso.pedido} contexto={enCurso.contexto} foto={enCurso.foto} />
      <article aria-label="La IA está trabajando" className="rounded-xl border border-taller-resalte bg-taller-tarjeta p-3 text-[12.5px] text-taller-texto">
        <header className="mb-1.5 flex items-center gap-2 text-[11.5px] text-taller-acento">
          <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
          {/* El contador no se anuncia (el hilo es una región viva y lo repetiría cada segundo). */}
          <span aria-hidden>Trabajando · {segundos} s</span>
          <span className="flex-1" />
          <button type="button" onClick={alDetener} aria-label="Detener el pedido a la IA"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-taller-borde bg-taller-boton px-2.5 text-xs font-medium text-taller-texto hover:bg-taller-encima lg:min-h-8">
            <Square className="size-3" aria-hidden /> Detener
          </button>
        </header>
        <ol className="grid gap-0.5 text-[11.5px] text-taller-suave">
          {enCurso.pasos.slice(-4).map((p) => (
            <li key={p.n}><span className={p.ok ? "text-taller-valido" : "text-taller-peligro"} aria-hidden>{p.ok ? "✓" : "✗"}</span> {pasoLegible(p)}</li>
          ))}
          <li role="status"><span aria-hidden className="text-taller-acento">◌</span> {ultimo ? "Siguiente paso…" : FASE[enCurso.fase]}</li>
        </ol>
      </article>
    </>
  );
}

/** La comparación con la foto (rondas automáticas): en qué ronda va y «Detener». */
export function TarjetaComparando({ progreso, alDetener }: { progreso: ProgresoRefinado; alDetener: () => void }) {
  return (
    <article aria-label="Comparando con la foto" className="flex items-center gap-2 rounded-xl border border-taller-resalte bg-taller-tarjeta p-3 text-[12.5px] text-taller-texto">
      <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
      <span role="status" className="flex-1">{progreso.fase === "revisando" ? "Revisando si mejoró…" : `Comparando con la foto… ronda ${progreso.ronda}/${progreso.total}`}</span>
      <button type="button" onClick={alDetener} aria-label="Detener la comparación con la foto"
        className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-taller-borde bg-taller-boton px-2.5 text-xs font-medium hover:bg-taller-encima lg:min-h-8">
        <Square className="size-3" aria-hidden /> Detener
      </button>
    </article>
  );
}
