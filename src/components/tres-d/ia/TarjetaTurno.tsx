"use client";

import { Eye, Paperclip, Redo2, RotateCcw, Undo2 } from "lucide-react";
import type { EstadoTurnoEnEscena } from "@/lib/globos3d/deshacer-turno";
import { deltaGlobos, lineasDeDiff, textoGlobos, type LineaDiff } from "@/lib/globos3d/diff-escenas";
import { costeTexto, pasoLegible, segundos, type EstadoTurno, type TurnoPanel } from "@/lib/globos3d/turnos-ia";
import type { Marca } from "./useAsistenteIA";

const ETIQUETA_ESTADO: Readonly<Record<EstadoTurno, string>> = { aplicado: "✓ aplicado", sin_cambios: "sin cambios en la escena", error: "no se pudo", detenido: "detenido" };
const SIGNO: Readonly<Record<LineaDiff["signo"], string>> = { "+": "text-taller-valido", "−": "text-taller-peligro", "~": "text-taller-acento" };
const BTN_CHICO = "inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-taller-borde bg-taller-boton px-2.5 text-xs font-medium text-taller-texto hover:bg-taller-encima disabled:cursor-not-allowed disabled:opacity-45 aria-pressed:border-taller-resalte aria-pressed:bg-taller-elegido lg:min-h-8";

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
  /** Lo que se puede hacer hoy con el turno; `undefined` si es de otra escena o de otro editor (no actúa sobre esta). */
  estado: EstadoTurnoEnEscena | undefined;
  /** Lo que se dijo al deshacer o rehacer este turno. */
  aviso: string | undefined;
  esUltimo: boolean;
  /** Teléfono: la tarjeta es un resumen (los cambios y los pasos van plegados). */
  compacta: boolean;
  viendoAntes: boolean;
  /** ¿La pieza sigue en la escena? (las quitadas no se pueden señalar ni elegir). */
  hayPieza: (id: string) => boolean;
  alDeshacer: (id: string) => void;
  alRehacer: (id: string) => void;
  alVerAntes: (id: string) => void;
  alApuntar: (marcas: readonly Marca[] | null) => void;
  alElegir: (id: string) => void;
  alReintentar: (turno: TurnoPanel) => void;
};

/**
 * La respuesta de la IA a un pedido como tarjeta: qué hizo, una línea por pieza cambiada (al pasar el cursor o enfocar una línea se
 * marca esa pieza en el visor; Enter la elige y la suma al alcance), los pasos que dio, «Deshacer turno» / «Rehacer turno» según
 * lo que haya hoy en la escena y «Ver antes». Un turno deshecho se ve atenuado.
 */
export function TarjetaTurno({ turno, estado, aviso, esUltimo, compacta, viendoAntes, hayPieza, alDeshacer, alRehacer, alVerAntes, alApuntar, alElegir, alReintentar }: Props) {
  const diff = turno.diff;
  const lineas = diff ? lineasDeDiff(diff) : [];
  const delta = diff ? deltaGlobos(diff) : 0;
  const fallo = turno.estado === "error" || turno.estado === "detenido";
  const deshecho = estado !== undefined && !estado.deshacible && estado.rehacible;
  const ajeno = diff !== null && estado === undefined;
  const insignia = ajeno ? "de otra escena" : deshecho ? "deshecho" : diff && delta !== 0 ? textoGlobos(delta) : ETIQUETA_ESTADO[turno.estado];
  const nota = aviso ?? turno.nota;
  const cambios = lineas.length > 0 && (
      <details open={!compacta} className="mb-1.5">
        <summary className="min-h-8 cursor-pointer text-[11.5px] text-taller-suave">{lineas.length} {lineas.length === 1 ? "cambio" : "cambios"}</summary>
        <ul className="grid gap-0.5" aria-label="Cambios en la escena">
          {lineas.map((l, i) => {
            const vive = !ajeno && l.id !== null && l.signo !== "−" && hayPieza(l.id);
            const marcas = vive && l.id ? [{ id: l.id, nueva: l.signo === "+" }] : null;
            return (
              <li key={`${l.id}-${i}`}>
                <button type="button" disabled={!vive} onClick={() => l.id && alElegir(l.id)} title={vive ? "Ver en la escena y pedirle cosas a esta pieza" : undefined}
                  onMouseEnter={() => alApuntar(marcas)} onMouseLeave={() => alApuntar(null)} onFocus={() => alApuntar(marcas)} onBlur={() => alApuntar(null)}
                  aria-label={`${l.signo === "+" ? "Nueva" : l.signo === "−" ? "Quitada" : "Cambiada"}: ${l.titulo}${l.detalle ? `, ${l.detalle}` : ""}${vive ? ". Enter la elige en la escena" : ""}`}
                  className="flex min-h-10 w-full items-baseline gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-taller-encima enabled:cursor-pointer disabled:cursor-default lg:min-h-7 lg:py-0.5">
                  <span aria-hidden className={`w-3.5 shrink-0 font-bold ${SIGNO[l.signo]}`}>{l.signo}</span>
                  <span className="min-w-0 break-words">{l.titulo}{l.detalle && <span className="text-taller-suave"> · {l.detalle}</span>}</span>
                  {vive && <Eye className="ml-auto size-3.5 shrink-0 self-center text-taller-suave" aria-hidden />}
                </button>
              </li>
            );
          })}
        </ul>
        {esUltimo && !ajeno && lineas.some((l) => l.id) && <p className="mt-1 text-[11px] text-taller-suave">{compacta ? "Toca una línea para verla en la escena y pedir cambios sobre esa pieza." : "Pasa el cursor por una línea para verla en la escena; al elegirla, esa pieza es sobre la que pides."}</p>}
      </details>
    );
  const pasos = turno.pasos.length > 0 && (
      <details className="mb-1.5">
        <summary className="min-h-8 cursor-pointer text-[11.5px] text-taller-suave">{turno.pasos.length} {turno.pasos.length === 1 ? "paso" : "pasos"} de la IA</summary>
        <ol className="mt-1 grid gap-0.5 text-[11.5px] text-taller-suave">
          {turno.pasos.map((p, i) => <li key={i}><span className="text-taller-valido" aria-hidden>✓</span> {pasoLegible(p)}</li>)}
        </ol>
      </details>
    );
  const pie = (
    <footer className={`flex flex-wrap items-center gap-1.5 ${compacta ? "mb-1.5" : ""}`}>
      {estado && diff && (
        <>
          {estado.rehacible && !estado.deshacible ? (
            <button type="button" onClick={() => alRehacer(turno.id)} title="Vuelve a poner lo que hizo la IA en este turno (lo que cambiaste a mano se queda)" className={BTN_CHICO}>
              <Redo2 className="size-3.5" aria-hidden /> Rehacer turno
            </button>
          ) : (
            <button type="button" onClick={() => alDeshacer(turno.id)} disabled={!estado.deshacible}
              title={estado.deshacible ? "Revierte lo que cambió este turno; lo que editaste a mano se queda" : "Todo lo que cambió este turno lo cambiaste tú después"} className={BTN_CHICO}>
              <Undo2 className="size-3.5" aria-hidden /> {estado.bloqueado ? "Ya lo cambiaste tú" : "Deshacer turno"}
            </button>
          )}
          <button type="button" onClick={() => alVerAntes(turno.id)} aria-pressed={viendoAntes} disabled={!estado.deshacible} className={BTN_CHICO}
            title="Muestra la escena sin lo de este turno mientras esté activo (Esc la vuelve a mostrar)">
            <Eye className="size-3.5" aria-hidden /> Ver antes
          </button>
        </>
      )}
      {fallo && (
        <button type="button" onClick={() => alReintentar(turno)} className={BTN_CHICO}><RotateCcw className="size-3.5" aria-hidden /> Volver a intentarlo</button>
      )}
      {turno.foto && turno.costeUsd !== null && <span className="ml-auto text-[11px] text-taller-suave" title="Estimación: leer la foto y armar la escena">{costeTexto(turno.costeUsd)}</span>}
    </footer>
  );
  return (
    <article aria-label={`Turno ${turno.numero}`} className={`rounded-xl border bg-taller-tarjeta p-3 text-[12.5px] text-taller-texto ${fallo ? "border-taller-peligro/50" : viendoAntes ? "border-taller-resalte" : "border-taller-borde"} ${deshecho || ajeno ? "opacity-70" : ""}`}>
      <header className="mb-1.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-taller-suave">
        <span>Turno {turno.numero}{turno.ms ? ` · ${segundos(turno.ms)}` : ""}</span>
        <span className="flex-1" />
        <span>{insignia}</span>
      </header>
      {turno.respuesta && turno.respuesta !== turno.pregunta?.texto && <p className={`mb-1.5 whitespace-pre-line break-words text-[13px] leading-snug ${compacta ? "line-clamp-2" : ""} ${deshecho ? "line-through decoration-taller-suave/50" : ""}`}>{turno.respuesta}</p>}
      {nota && <p role="status" className={`mb-1.5 text-xs ${fallo ? "text-taller-peligro" : "text-taller-texto-2"}`}>{nota}</p>}
      {compacta ? <>{pie}{cambios}{pasos}</> : <>{cambios}{pasos}{pie}</>}
    </article>
  );
}
