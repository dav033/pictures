"use client";

import { useEffect, useId, useMemo, useRef, useState, type RefObject } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ChevronDown } from "lucide-react";
import { IconoEstructura } from "@/components/plan/IconoEstructura";
import type { EstructuraOficialId } from "@/lib/plan/estructuras-oficiales";
import { CifraAnimada } from "./ajuste/AjustarPlan";
import { DUR, grupoConRitmo, hijoEscalonado } from "./animacion/movimiento";
import { GloboMiniatura } from "./GloboMiniatura";
import { tablaGlobos, type LineaGlobo, type PiezaVista, type TablaGlobos } from "./piezas-vista";

/**
 * «Ver detalle»: una tabla compacta por pieza (filas = colores, columnas = solo los tamaños que lleva, celdas =
 * cantidades, total por color y por pieza). La primera columna queda fija y la tabla se desliza DENTRO de sí misma en
 * el móvil: la página nunca se desplaza en horizontal. Solo muestra lo que Python resolvió (`piezas-vista.ts`).
 * Compartido por «Tu plan» y la tarjeta de una idea.
 */

const entero = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });

/** Si la tabla no cabe y hacia dónde queda contenido: decide el degradado y el aviso «Desliza…». */
function useDesborde(ref: RefObject<HTMLDivElement | null>): { hay: boolean; alFinal: boolean; desplazada: boolean } {
  const [estado, setEstado] = useState({ hay: false, alFinal: false, desplazada: false });
  useEffect(() => {
    const caja = ref.current;
    if (!caja) return;
    const medir = () => {
      const hay = caja.scrollWidth - caja.clientWidth > 2;
      const alFinal = caja.scrollLeft + caja.clientWidth >= caja.scrollWidth - 2;
      const desplazada = caja.scrollLeft > 2;
      setEstado((actual) => (actual.hay === hay && actual.alFinal === alFinal && actual.desplazada === desplazada ? actual : { hay, alFinal, desplazada }));
    };
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(caja);
    caja.addEventListener("scroll", medir, { passive: true });
    return () => {
      observador.disconnect();
      caja.removeEventListener("scroll", medir);
    };
  }, [ref]);
  return estado;
}

export function TablaGlobosPieza({ titulo, oficial, tabla, repeticiones = 1 }: { titulo: string; oficial: EstructuraOficialId | null; tabla: TablaGlobos; repeticiones?: number }) {
  const idTitulo = useId();
  const caja = useRef<HTMLDivElement>(null);
  const desborde = useDesborde(caja);
  const reducido = useReducedMotion();
  const conTotal = tabla.columnas.length > 1;
  const conPie = tabla.filas.length > 1;
  // Con productos Sempertex, cada fila nombra el globo real («Reflex Dorado»), no un color genérico.
  const conProductos = tabla.filas.some((fila) => fila.producto);
  if (tabla.filas.length === 0) return null;
  return (
    <section aria-labelledby={idTitulo}>
      <h4 id={idTitulo} className="mb-1.5 flex min-w-0 items-center gap-1.5 text-sm font-medium text-texto">
        {oficial && <IconoEstructura id={oficial} className="size-5 shrink-0 text-acento" />}
        <span className="min-w-0 truncate">{repeticiones > 1 ? `${repeticiones} × ` : ""}{titulo}</span>
        <span className="shrink-0 font-normal text-texto-suave">· {entero.format(tabla.total)} {tabla.total === 1 ? "globo" : "globos"}</span>
      </h4>
      <div className="relative">
        <div
          ref={caja}
          role="region"
          tabIndex={desborde.hay ? 0 : -1}
          aria-labelledby={idTitulo}
          className="overflow-x-auto overscroll-x-contain rounded-xl ring-1 ring-borde-suave focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50"
        >
          <table className="w-max min-w-full border-separate border-spacing-0 text-sm tabular-nums">
            <caption className="sr-only">{conProductos ? `Globos Sempertex de ${titulo} por producto y tamaño` : `Globos de ${titulo} por color y tamaño`}</caption>
            <thead>
              <tr className="text-xs text-texto-suave">
                <th scope="col" className={`sticky left-0 z-[1] bg-superficie-suave px-2 py-1.5 text-left font-medium sm:px-2.5 ${desborde.desplazada ? "shadow-[4px_0_6px_-4px_var(--sombra)]" : ""}`}>{conProductos ? "Globo Sempertex" : "Color"}</th>
                {tabla.columnas.map((columna) => (
                  <th key={columna.clave} scope="col" className="min-w-10 bg-superficie-suave px-1.5 py-1.5 text-right font-medium whitespace-nowrap sm:min-w-12 sm:px-2">
                    <span aria-hidden>{columna.etiqueta}</span>
                    <span className="sr-only">{columna.descripcion}</span>
                  </th>
                ))}
                {conTotal && <th scope="col" className="min-w-10 bg-acento-suave/60 px-2 py-1.5 text-right font-semibold text-texto sm:min-w-12 sm:px-2.5">Total</th>}
              </tr>
            </thead>
            <motion.tbody variants={grupoConRitmo(0.04)} initial="oculto" animate="visible">
              {tabla.filas.map((fila) => (
                <motion.tr key={fila.clave} variants={hijoEscalonado}>
                  <th scope="row" className={`sticky left-0 z-[1] border-t border-borde-suave bg-superficie px-2 py-1.5 text-left font-normal sm:px-2.5 ${desborde.desplazada ? "shadow-[4px_0_6px_-4px_var(--sombra)]" : ""}`}>
                    <span className="flex items-center gap-1.5">
                      <GloboMiniatura hex={fila.hex} acabado={fila.acabado} pulgadas={fila.pulgadas} tamano={20} className="shrink-0" />
                      {fila.producto
                        ? <span className="line-clamp-2 max-w-[5.75rem] text-[0.8125rem] leading-tight text-texto sm:max-w-[9rem]" title={`Sempertex ${fila.producto}`}>{fila.producto}</span>
                        : <span className="max-w-[7.5rem] truncate text-texto" title={fila.etiqueta}>{fila.etiqueta}</span>}
                    </span>
                  </th>
                  {fila.celdas.map((celda, posicion) => (
                    <td key={tabla.columnas[posicion]!.clave} className="border-t border-borde-suave px-1.5 py-1.5 text-right text-texto sm:px-2">
                      {celda > 0 ? <CifraAnimada valor={celda} /> : <><span aria-hidden className="text-texto-suave/50">·</span><span className="sr-only">0</span></>}
                    </td>
                  ))}
                  {conTotal && <td className="border-t border-borde-suave bg-acento-suave/40 px-2 py-1.5 text-right font-semibold sm:px-2.5 text-texto"><CifraAnimada valor={fila.total} /></td>}
                </motion.tr>
              ))}
            </motion.tbody>
            {conPie && (
              <tfoot>
                <tr className="font-semibold text-texto">
                  <th scope="row" className={`sticky left-0 z-[1] border-t border-borde bg-superficie-suave px-2 py-1.5 text-left sm:px-2.5 ${desborde.desplazada ? "shadow-[4px_0_6px_-4px_var(--sombra)]" : ""}`}>Total</th>
                  {tabla.totalesColumna.map((valor, posicion) => (
                    <td key={tabla.columnas[posicion]!.clave} className="border-t border-borde bg-superficie-suave px-1.5 py-1.5 text-right sm:px-2"><CifraAnimada valor={valor} /></td>
                  ))}
                  {conTotal && <td className="border-t border-borde bg-acento-suave/60 px-2 py-1.5 text-right sm:px-2.5"><CifraAnimada valor={tabla.total} /></td>}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        {desborde.hay && !desborde.alFinal && <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-8 rounded-r-xl bg-gradient-to-r from-transparent to-superficie" />}
      </div>
      {desborde.hay && !desborde.alFinal && (
        <p className="mt-1 flex items-center justify-end gap-1 text-xs text-texto-suave">
          Desliza para ver más tamaños
          <motion.span aria-hidden animate={reducido ? undefined : { x: [0, 4, 0] }} transition={{ duration: 0.8, repeat: 1, ease: "easeInOut", delay: 0.4 }}>→</motion.span>
        </p>
      )}
    </section>
  );
}

/**
 * El contenido de «Ver detalle»: una tabla por pieza con globos, o una sola «Toda la decoración» cuando las cantidades
 * no vienen separadas por pieza (`lineasSinPieza`, ideas estimadas de la biblioteca). Nada más: ni lista plana ni
 * párrafos de tamaños.
 */
export function DetalleGlobos({ piezas, total, nota, lineasSinPieza }: { piezas: readonly PiezaVista[]; total: number; nota?: string; lineasSinPieza?: readonly LineaGlobo[] }) {
  const tablas = useMemo(() => {
    if (lineasSinPieza?.length) return [{ id: "toda", titulo: "Toda la decoración", oficial: null, repeticiones: 1, tabla: tablaGlobos(lineasSinPieza) }];
    return piezas.filter((pieza) => pieza.lineas.length > 0).map((pieza) => ({ id: pieza.id, titulo: pieza.nombre, oficial: pieza.oficial, repeticiones: pieza.repeticiones, tabla: tablaGlobos(pieza.lineas) }));
  }, [piezas, lineasSinPieza]);
  return (
    <div className="space-y-4 pb-1 pt-2">
      {tablas.map((item) => <TablaGlobosPieza key={item.id} titulo={item.titulo} oficial={item.oficial} tabla={item.tabla} repeticiones={item.repeticiones} />)}
      {tablas.length > 1 && (
        <p className="text-right text-sm font-semibold text-texto">Todo el plan: <span className="tabular-nums"><CifraAnimada valor={total} /></span> {total === 1 ? "globo" : "globos"}</p>
      )}
      {nota && <p className="text-xs text-texto-suave">{nota}</p>}
    </div>
  );
}

/** «Ver detalle» / «Ocultar detalle», con el chevron que gira. */
export function BotonVerDetalle({ abierto, onClick, controls }: { abierto: boolean; onClick: () => void; controls?: string }) {
  return (
    <button
      type="button"
      aria-expanded={abierto}
      aria-controls={controls}
      onClick={onClick}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-lg text-sm font-medium text-acento focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50"
    >
      {abierto ? "Ocultar detalle" : "Ver detalle"}
      <motion.span animate={{ rotate: abierto ? 180 : 0 }} transition={{ duration: DUR.corta }} className="inline-flex"><ChevronDown className="size-4" aria-hidden /></motion.span>
    </button>
  );
}
