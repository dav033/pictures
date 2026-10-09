"use client";

import { Eye, Paperclip, RotateCcw, Undo2 } from "lucide-react";
import { deltaGlobos, lineasDeDiff, textoGlobos, type LineaDiff } from "@/lib/globos3d/diff-escenas";
import { costeTexto, segundos, type AmbitoTurno, type EstadoTurno, type TurnoPanel } from "@/lib/globos3d/turnos-ia";
import type { Marca } from "./useAsistenteIA";

const ETIQUETA_ESTADO: Readonly<Record<EstadoTurno, string>> = {
  aplicado: "✓ aplicado", sin_cambios: "sin cambios en la escena", deshecho: "deshecho", error: "no se pudo", detenido: "detenido",
};
const SIGNO: Readonly<Record<LineaDiff["signo"], string>> = { "+": "text-taller-valido", "−": "text-taller-peligro", "~": "text-taller-acento" };
const BTN_CHICO = "inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-taller-borde bg-taller-boton px-2.5 text-xs font-medium text-taller-texto hover:bg-taller-encima disabled:cursor-not-allowed disabled:opacity-45 aria-pressed:border-taller-resalte aria-pressed:bg-taller-elegido";

/** Lo que pidió la persona (a la derecha), con a qué se refería. */
export function BurbujaPedido({ pedido, contexto, foto }: { pedido: string; contexto: string; foto: boolean }) {
  return (
    <div className="max-w-[88%] self-end rounded-xl rounded-br-sm bg-taller-elegido px-3 py-1.5 text-[13px] text-taller-texto">
      <p className="whitespace-pre-line break-words">{pedido}</p>
      <p className="mt-0.5 flex items-center gap-1 text-[11px] text-taller-suave">{foto && <Paperclip className="size-3" aria-label="con foto" />}{foto ? "foto · " : ""}{contexto}</p>
    </div>
  );
}

type Props = {
  turno: TurnoPanel;
  ambitoActual: AmbitoTurno;
  viendoAntes: boolean;
  /** ¿La pieza sigue en la escena? (las quitadas no se pueden señalar ni elegir). */
  hayPieza: (id: string) => boolean;
  alDeshacer: (id: string) => void;
  alVerAntes: (id: string) => void;
  alApuntar: (marcas: readonly Marca[] | null) => void;
  alElegir: (id: string) => void;
  alReusar: (pedido: string) => void;
};

/**
 * La respuesta de la IA a un pedido como tarjeta: qué hizo, la lista de cambios en la escena (al pasar el cursor o enfocar una
 * línea se marca esa pieza en el visor; Enter la elige), los pasos que dio, «Deshacer turno» y «Ver antes».
 */
export function TarjetaTurno({ turno, ambitoActual, viendoAntes, hayPieza, alDeshacer, alVerAntes, alApuntar, alElegir, alReusar }: Props) {
  const diff = turno.diff;
  const lineas = diff ? lineasDeDiff(diff) : [];
  const delta = diff ? deltaGlobos(diff) : 0;
  const fallo = turno.estado === "error" || turno.estado === "detenido";
  const otroEditor = turno.ambito !== ambitoActual;
  return (
    <article aria-label={`Turno ${turno.numero}`} className={`rounded-xl border bg-taller-tarjeta p-3 text-[12.5px] text-taller-texto ${fallo ? "border-taller-peligro/50" : viendoAntes ? "border-taller-resalte" : "border-taller-borde"}`}>
      <header className="mb-1.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-taller-suave">
        <span>Turno {turno.numero}{turno.ms ? ` · ${segundos(turno.ms)}` : ""}</span>
        <span className="flex-1" />
        <span>{diff && delta !== 0 && turno.estado !== "deshecho" ? textoGlobos(delta) : ETIQUETA_ESTADO[turno.estado]}</span>
      </header>
      {turno.respuesta && turno.respuesta !== turno.pregunta?.texto && <p className="mb-1.5 whitespace-pre-line break-words text-[13px] leading-snug">{turno.respuesta}</p>}
      {turno.nota && <p role="status" className={`mb-1.5 text-xs ${fallo ? "text-taller-peligro" : "text-taller-texto-2"}`}>{turno.nota}</p>}
      {lineas.length > 0 && (
        <ul className="mb-1.5 grid gap-0.5" aria-label="Cambios en la escena">
          {lineas.map((l, i) => {
            const vive = l.id !== null && l.signo !== "−" && hayPieza(l.id);
            const marcas = vive && l.id ? [{ id: l.id, nueva: l.signo === "+" }] : null;
            return (
              <li key={`${l.id}-${i}`}>
                <button type="button" disabled={!vive} onClick={() => l.id && alElegir(l.id)}
                  onMouseEnter={() => alApuntar(marcas)} onMouseLeave={() => alApuntar(null)} onFocus={() => alApuntar(marcas)} onBlur={() => alApuntar(null)}
                  aria-label={`${l.signo === "+" ? "Nueva" : l.signo === "−" ? "Quitada" : "Cambiada"}: ${l.titulo}${l.detalle ? `, ${l.detalle}` : ""}${vive ? ". Enter la elige en la escena" : ""}`}
                  className="flex min-h-7 w-full items-baseline gap-1.5 rounded-md px-1.5 py-0.5 text-left hover:bg-taller-encima enabled:cursor-pointer disabled:cursor-default">
                  <span aria-hidden className={`w-3.5 shrink-0 font-bold ${SIGNO[l.signo]}`}>{l.signo}</span>
                  <span className="min-w-0 break-words">{l.titulo}{l.detalle && <span className="text-taller-suave"> · {l.detalle}</span>}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {turno.pasos.length > 0 && (
        <details className="mb-1.5">
          <summary className="cursor-pointer text-[11.5px] text-taller-suave">{turno.pasos.length} {turno.pasos.length === 1 ? "paso" : "pasos"} de la IA</summary>
          <ol className="mt-1 grid gap-0.5 text-[11.5px] text-taller-suave">
            {turno.pasos.map((p, i) => <li key={i}><span className="text-taller-valido" aria-hidden>✓</span> <span className="font-mono">{p.herramienta}</span> · {p.resumen}</li>)}
          </ol>
        </details>
      )}
      <footer className="flex flex-wrap items-center gap-1.5">
        {diff && (
          <>
            <button type="button" onClick={() => alDeshacer(turno.id)} disabled={turno.estado === "deshecho" || otroEditor}
              title={otroEditor ? "Este turno fue en otro editor" : "Revierte solo lo que cambió este turno; lo que editaste a mano se queda"} className={BTN_CHICO}>
              <Undo2 className="size-3.5" aria-hidden /> Deshacer turno
            </button>
            <button type="button" onClick={() => alVerAntes(turno.id)} aria-pressed={viendoAntes} disabled={otroEditor} className={BTN_CHICO}
              title="Muestra la escena sin lo de este turno mientras esté activo">
              <Eye className="size-3.5" aria-hidden /> Ver antes
            </button>
          </>
        )}
        {fallo && (
          <button type="button" onClick={() => alReusar(turno.pedido)} className={BTN_CHICO}><RotateCcw className="size-3.5" aria-hidden /> Volver a intentarlo</button>
        )}
        {turno.costeUsd !== null && <span className="ml-auto text-[11px] text-taller-suave" title="Estimación con los precios de Gemini Flash">{costeTexto(turno.costeUsd)}</span>}
      </footer>
    </article>
  );
}
