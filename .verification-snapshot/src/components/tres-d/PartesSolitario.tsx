"use client";

import { Plus } from "lucide-react";
import type { Escena, EscenaArmada } from "@/lib/globos3d/escena";
import { IconoTipo, medidaPrincipal, padreDe } from "./tipos-pieza";
import { FILA, FILA_ON } from "./ui-taller";

type Props = {
  /** La escena aislada del editor solitario y cómo se abrió (para «antes → ahora»). */
  escena: Escena;
  armada: EscenaArmada | null;
  inicial: { escena: Escena; armada: EscenaArmada | null };
  raizId: string;
  seleccion: string | null;
  onSeleccion: (id: string) => void;
  onColgar: () => void;
};

const signo = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/**
 * Columna izquierda del editor solitario: las partes (la estructura y lo que cuelga de ella), «Colgar decoración» y el
 * recuadro «Antes → ahora» (la medida principal y cuántos globos más o menos).
 */
export function PartesSolitario({ escena, armada, inicial, raizId, seleccion, onSeleccion, onColgar }: Props) {
  const raiz = escena.nodos.find((n) => n.id === raizId);
  const raizInicial = inicial.escena.nodos.find((n) => n.id === raizId);
  const hechoRaiz = armada?.porNodo.find((n) => n.id === raizId);
  const hechoInicial = inicial.armada?.porNodo.find((n) => n.id === raizId);
  const partes = escena.nodos.filter((n) => n.id !== raizId);
  const antes = raizInicial ? medidaPrincipal(raizInicial.pieza, hechoInicial?.caja) : null;
  const ahora = raiz ? medidaPrincipal(raiz.pieza, hechoRaiz?.caja) : null;
  // Globos de más o de menos, por formato (para decir «+12 globos R-12» si es uno solo).
  const porFormato = new Map<string, number>();
  for (const x of armada?.materiales ?? []) porFormato.set(x.formatoId, (porFormato.get(x.formatoId) ?? 0) + x.cantidad);
  for (const x of inicial.armada?.materiales ?? []) porFormato.set(x.formatoId, (porFormato.get(x.formatoId) ?? 0) - x.cantidad);
  const cambiados = [...porFormato.entries()].filter(([, n]) => n !== 0);
  const total = cambiados.reduce((s, [, n]) => s + n, 0);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-0.5 px-2 py-3.5">
      <h2 className="taller-rotulo px-2 pb-2.5">Partes</h2>
      <ul className="flex min-h-0 flex-col gap-0.5 overflow-y-auto">
        {raiz && (
          <li>
            <button type="button" onClick={() => onSeleccion(raiz.id)} aria-pressed={seleccion === raiz.id} className={`${FILA} ${seleccion === raiz.id ? FILA_ON : ""}`}>
              <span className="text-taller-acento"><IconoTipo pieza={raiz.pieza} /></span>
              <span className="min-w-0 flex-1 truncate">{raiz.nombre}</span>
              <span className="font-mono text-[11px]">{hechoRaiz?.globos.length ?? ""}</span>
            </button>
          </li>
        )}
        {partes.map((n) => {
          const hecho = armada?.porNodo.find((x) => x.id === n.id);
          const nivel = padreDe(n) === raizId ? 1 : 2;
          return (
            <li key={n.id}>
              <button type="button" onClick={() => onSeleccion(n.id)} aria-pressed={seleccion === n.id} className={`${FILA} ${seleccion === n.id ? FILA_ON : ""}`} style={{ paddingLeft: `${8 + nivel * 20}px` }}>
                <span className="text-taller-deco"><IconoTipo pieza={n.pieza} className="size-[15px]" /></span>
                <span className="min-w-0 flex-1 truncate">{n.nombre}{hecho && hecho.copias > 1 ? ` ×${hecho.copias}` : ""}</span>
                <span className="font-mono text-[11px] text-taller-suave">{hecho?.globos.length ?? ""}</span>
              </button>
            </li>
          );
        })}
        <li>
          <button type="button" onClick={onColgar} className={`${FILA} text-taller-medio`} style={{ paddingLeft: "28px" }}><Plus className="size-[15px]" aria-hidden />Colgar decoración</button>
        </li>
      </ul>
      <div className="flex-1" />
      <div className="mx-2 rounded-xl border border-taller-borde bg-taller-tarjeta p-3" aria-live="polite">
        <div className="text-xs text-taller-medio">Antes → ahora</div>
        {antes && ahora && (
          <div className="mt-1.5 flex flex-wrap items-baseline gap-2">
            {antes !== ahora && <span className="font-mono text-[13px] text-taller-suave line-through">{antes}</span>}
            <span className="font-mono text-base font-medium">{ahora}</span>
          </div>
        )}
        <div className="mt-1 text-xs text-taller-medio">
          {total === 0 && cambiados.length === 0 ? "Los mismos globos" : (
            <><span className={`font-mono ${total >= 0 ? "text-taller-valido" : "text-taller-peligro"}`}>{signo(total)}</span> globos{cambiados.length === 1 ? ` ${cambiados[0]![0]}` : ""}</>
          )}
        </div>
      </div>
    </div>
  );
}
