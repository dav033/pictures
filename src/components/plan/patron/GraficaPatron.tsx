"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import type { PatronColorResuelto, PintadoPatronColor } from "@/lib/plan/patron-color";
import { colorDe, extremosFilas, unidadesFila, type ColorLeyenda } from "./leyenda";
import { MuestraNumero } from "./LeyendaPatron";

export type Pincel = { material: number; alcance: "globo" | "racimo" };

type Props = {
  resuelto: Pick<PatronColorResuelto, "geometria" | "celdas" | "extras">;
  /** Celdas a mostrar en lugar de las de `resuelto` (pintura optimista del editor). */
  celdas?: readonly (readonly number[])[];
  leyenda: readonly ColorLeyenda[];
  tipo: string;
  oficialId?: string;
  /** Con pincel y `onPintar`, cada globo y cada número de racimo se pueden pintar. */
  pincel?: Pincel;
  onPintar?: (pintado: PintadoPatronColor) => void;
  /** Lo pintado a mano en el borrador, marcado en la gráfica. */
  pintados?: readonly PintadoPatronColor[];
  className?: string;
};

/** Globo con el foco itinerante de la gráfica; `columna: -1` es el número del racimo (o de la fila). */
export type Posicion = { fila: number; columna: number };

/**
 * Dónde está el único Tab stop de la gráfica cuando cambian sus filas (otro
 * tamaño de racimo, "Deshacer", otro estilo). Si la fila elegida ya no existe,
 * vuelve al primer racimo a la vista; si existe pero es más corta, al último
 * globo de esa fila. El número del racimo (`-1`) se conserva mientras su fila
 * exista. Sin esto el foco quedaba apuntando a una fila borrada y ningún botón
 * entraba con Tab.
 */
export function posicionItinerante(elegido: Posicion, filas: readonly (readonly number[])[], primera: number): Posicion {
  const largo = filas[elegido.fila]?.length;
  if (largo === undefined) return { fila: primera, columna: 0 };
  return { fila: elegido.fila, columna: Math.min(elegido.columna, largo - 1) };
}

function tamanoCelda(columnas: number): { tamano: "md" | "sm" | "xs"; sangria: string; conNumero: boolean } {
  if (columnas <= 8) return { tamano: "md", sangria: "pl-4", conNumero: true };
  if (columnas <= 14) return { tamano: "sm", sangria: "pl-3", conNumero: true };
  return { tamano: "xs", sangria: "pl-2.5", conNumero: columnas <= 24 };
}

/**
 * Gráfica numerada del curso Sempertex: una fila por racimo (la base abajo en
 * columnas y semiarcos), cada globo con el número de su color. Estática en la
 * hoja de armado; en el editor es una rejilla ARIA: flechas para moverse,
 * Enter o Espacio para pintar, el número del racimo pinta el racimo entero.
 */
export function GraficaPatron({ resuelto, celdas, leyenda, tipo, oficialId, pincel, onPintar, pintados = [], className = "" }: Props) {
  const filasCeldas = celdas ?? resuelto.celdas;
  const unidades = unidadesFila(resuelto.geometria);
  const extremos = extremosFilas(tipo, oficialId);
  const orden = filasCeldas.map((_, fila) => fila);
  if (extremos.baseAbajo) orden.reverse();
  const columnas = Math.max(1, ...filasCeldas.map((fila) => fila.length));
  const celda = tamanoCelda(columnas);
  const rejilla = resuelto.geometria === "rejilla";
  const extrasPorFila = new Map<number, number[]>();
  for (const extra of resuelto.extras) extrasPorFila.set(extra.fila, [...(extrasPorFila.get(extra.fila) ?? []), extra.material]);
  const filasPintadas = new Set(pintados.filter((pintado) => pintado.columna === undefined).map((pintado) => pintado.fila));
  const globosPintados = new Set(pintados.filter((pintado) => pintado.columna !== undefined).map((pintado) => `${pintado.fila}:${pintado.columna}`));
  const editable = Boolean(pincel && onPintar);
  const colorPincel = pincel ? colorDe(leyenda, pincel.material) : null;
  const [elegido, setActivo] = useState<Posicion>({ fila: orden[0] ?? 0, columna: 0 });
  // Si la rejilla cambió de tamaño, el foco itinerante se reubica para que Tab siempre entre.
  const activo = posicionItinerante(elegido, filasCeldas, orden[0] ?? 0);
  const botones = useRef(new Map<string, HTMLButtonElement>());
  const arriba = extremos.baseAbajo ? extremos.fin : extremos.inicio;
  const abajo = extremos.baseAbajo ? extremos.inicio : extremos.fin;

  function describirFila(fila: number): string {
    const colores = (filasCeldas[fila] ?? []).map((material) => colorDe(leyenda, material).etiqueta);
    const extras = (extrasPorFila.get(fila) ?? []).map((material) => `centro ${colorDe(leyenda, material).etiqueta}`);
    return `${unidades.singular} ${fila + 1}: ${[...colores, ...extras].join(", ")}`;
  }

  function mover(destino: Posicion): void {
    setActivo(destino);
    botones.current.get(`${destino.fila}:${destino.columna}`)?.focus();
  }

  function teclado(evento: KeyboardEvent<HTMLDivElement>): void {
    const visual = orden.indexOf(activo.fila);
    const largo = filasCeldas[activo.fila]?.length ?? 0;
    const destinos: Record<string, Posicion | undefined> = {
      ArrowUp: visual > 0 ? { fila: orden[visual - 1]!, columna: Math.min(activo.columna, (filasCeldas[orden[visual - 1]!]?.length ?? 1) - 1) } : undefined,
      ArrowDown: visual < orden.length - 1 ? { fila: orden[visual + 1]!, columna: Math.min(activo.columna, (filasCeldas[orden[visual + 1]!]?.length ?? 1) - 1) } : undefined,
      ArrowLeft: activo.columna > -1 ? { fila: activo.fila, columna: activo.columna - 1 } : undefined,
      ArrowRight: activo.columna < largo - 1 ? { fila: activo.fila, columna: activo.columna + 1 } : undefined,
      Home: { fila: activo.fila, columna: -1 },
      End: { fila: activo.fila, columna: largo - 1 },
    };
    if (!(evento.key in destinos)) return;
    evento.preventDefault();
    const destino = destinos[evento.key];
    if (destino) mover(destino);
  }

  function pintar(fila: number, columna?: number): void {
    if (!pincel || !onPintar) return;
    onPintar(columna === undefined || pincel.alcance === "racimo" ? { fila, material: pincel.material } : { fila, columna, material: pincel.material });
  }

  const registrar = (clave: string) => (nodo: HTMLButtonElement | null) => {
    if (nodo) botones.current.set(clave, nodo);
    else botones.current.delete(clave);
  };

  const marcador = (texto: string) => <p aria-hidden="true" className="pl-9 text-[10px] font-semibold uppercase tracking-wide text-texto-tenue">{texto}</p>;

  if (!editable) {
    return (
      // Una pared ancha se desplaza de lado dentro de su marco: con el teclado también (axe: scrollable-region-focusable).
      <div tabIndex={0} role="group" aria-label="Gráfica numerada" className={`min-w-0 overflow-x-auto rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento ${className}`}>
        {marcador(arriba)}
        <ol aria-label={`Gráfica numerada, ${unidades.singular.toLowerCase()} por ${unidades.singular.toLowerCase()}`} className="my-1 space-y-1">
          {orden.map((fila) => (
            <li key={fila} aria-label={describirFila(fila)} className={`flex items-center gap-2 ${rejilla && fila % 2 === 1 ? celda.sangria : ""}`}>
              <span aria-hidden="true" className="w-7 shrink-0 text-right text-[11px] font-semibold tabular-nums text-texto-suave">{fila + 1}</span>
              <span aria-hidden="true" className="flex gap-1">
                {(filasCeldas[fila] ?? []).map((material, columna) => <MuestraNumero key={columna} color={colorDe(leyenda, material)} tamano={celda.tamano} conNumero={celda.conNumero} />)}
              </span>
              {(extrasPorFila.get(fila) ?? []).map((material, indice) => (
                <span key={indice} aria-hidden="true" className="inline-flex items-center gap-0.5 text-[10px] text-texto-suave">+<MuestraNumero color={colorDe(leyenda, material)} tamano="sm" /></span>
              ))}
            </li>
          ))}
        </ol>
        {marcador(abajo)}
      </div>
    );
  }

  return (
    <div className={`min-w-0 overflow-x-auto ${className}`}>
      {marcador(arriba)}
      <div role="grid" aria-label={`Gráfica numerada: toca un globo para pintarlo de ${colorPincel?.etiqueta ?? "otro color"}`} onKeyDown={teclado} className="my-1 space-y-1 p-0.5">
        {orden.map((fila) => {
          const cabecera = `${fila}:-1`;
          return (
            <div key={fila} role="row" className={`flex items-center gap-2 ${rejilla && fila % 2 === 1 ? celda.sangria : ""}`}>
              <span role="rowheader" className="shrink-0">
                <button
                  ref={registrar(cabecera)}
                  type="button"
                  tabIndex={activo.fila === fila && activo.columna === -1 ? 0 : -1}
                  onFocus={() => setActivo({ fila, columna: -1 })}
                  onClick={() => pintar(fila)}
                  aria-label={`Pintar ${unidades.singular.toLowerCase()} ${fila + 1} completo de ${colorPincel?.etiqueta ?? ""}`}
                  title={`Pintar ${unidades.singular.toLowerCase()} completo`}
                  className={`grid h-7 w-7 place-items-center rounded-lg text-[11px] font-semibold tabular-nums transition-colors hover:bg-acento-suave hover:text-acento focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-acento ${filasPintadas.has(fila) ? "bg-acento-suave text-acento" : "text-texto-suave"}`}
                >
                  {fila + 1}
                </button>
              </span>
              {(filasCeldas[fila] ?? []).map((material, columna) => {
                const color = colorDe(leyenda, material);
                const clave = `${fila}:${columna}`;
                return (
                  <span key={columna} role="gridcell" className="shrink-0">
                    <button
                      ref={registrar(clave)}
                      type="button"
                      tabIndex={activo.fila === fila && activo.columna === columna ? 0 : -1}
                      onFocus={() => setActivo({ fila, columna })}
                      onClick={() => pintar(fila, columna)}
                      aria-label={`${unidades.singular} ${fila + 1}, ${unidades.posicion} ${columna + 1}: ${color.etiqueta}`}
                      title={colorPincel ? `Pintar de ${colorPincel.etiqueta}` : undefined}
                      className={`block rounded-full transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento ${globosPintados.has(clave) ? "ring-2 ring-acento ring-offset-1 ring-offset-superficie" : ""}`}
                    >
                      <MuestraNumero color={color} tamano={celda.tamano} conNumero={celda.conNumero} />
                    </button>
                  </span>
                );
              })}
              {(extrasPorFila.get(fila) ?? []).map((material, indice) => {
                const color = colorDe(leyenda, material);
                return (
                  <span key={`extra-${indice}`} role="gridcell" aria-label={`${unidades.singular} ${fila + 1}, centro de flor: ${color.etiqueta}`} className="inline-flex shrink-0 items-center gap-0.5 text-[10px] text-texto-suave">
                    <span aria-hidden="true">+</span>
                    <MuestraNumero color={color} tamano="sm" />
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>
      {marcador(abajo)}
    </div>
  );
}
