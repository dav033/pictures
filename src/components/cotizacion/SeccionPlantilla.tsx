"use client";

import { Plus, Trash2 } from "lucide-react";
import { totalFila, type DescriptorSeccion, type FilaPlantilla } from "@/lib/cotizacion/plantilla";
import type { CambioFila } from "@/lib/estado/borrador-plantilla-cotizacion";

const pesos = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

type Props = {
  seccion: DescriptorSeccion;
  filas: readonly FilaPlantilla[];
  subtotal: number;
  /** Texto de ayuda propio de la sección, cuando hace falta explicar de dónde salen las filas. */
  nota?: string;
  onAnadir: () => void;
  onCambiar: (id: string, cambio: CambioFila) => void;
  onBorrar: (id: string) => void;
};

const CELDA_NUMERO = "w-28 rounded-lg border border-transparent bg-fondo px-2 py-1.5 text-right text-[13px] tabular-nums text-texto outline-none hover:border-borde focus-visible:border-acento focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-acento";

/**
 * Una sección de la hoja de cotización: su tabla de filas, el subtotal que la
 * cierra y el botón para añadir una fila más. Solo presenta: no calcula nada
 * más que el total visible de cada fila (`totalFila`, del módulo de la hoja) y
 * recibe el subtotal ya hecho.
 */
export function SeccionPlantilla({ seccion, filas, subtotal, nota, onAnadir, onCambiar, onBorrar }: Props) {
  const idSugerencias = `sugerencias-${seccion.clave}`;
  const idTitulo = `seccion-${seccion.clave}-titulo`;

  return (
    <section aria-labelledby={idTitulo} className="overflow-hidden rounded-2xl border border-borde-suave bg-superficie">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-borde-suave bg-superficie-suave px-3 py-2.5 sm:px-4">
        <h4 id={idTitulo} className="text-sm font-semibold text-texto">{seccion.titulo}</h4>
        <p className="text-xs text-texto-suave">
          {filas.length === 0 ? "Sin filas todavía" : `${filas.length} ${filas.length === 1 ? "fila" : "filas"}`}
        </p>
      </div>

      {nota && <p className="border-b border-borde-suave px-3 py-2 text-xs text-texto-suave sm:px-4">{nota}</p>}

      {filas.length === 0 ? (
        <p className="px-3 py-4 text-[13px] text-texto-suave sm:px-4">
          Esta sección la llenas tú. Añade una fila y escribe el concepto, el costo y la cantidad.
        </p>
      ) : (
        /* Enfocable para poder desplazar la tabla con el teclado en pantallas angostas. */
        <div tabIndex={0} aria-label={`Tabla de ${seccion.titulo}`} className="overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-acento">
          <table className="w-full min-w-[34rem] border-collapse text-left">
            <caption className="sr-only">{seccion.titulo}: descripción, {seccion.etiquetaCosto.toLowerCase()}, {seccion.etiquetaCantidad.toLowerCase()} y costo total de cada fila.</caption>
            <thead>
              <tr className="text-[11px] font-medium uppercase tracking-wide text-texto-suave">
                <th scope="col" className="w-8 px-3 py-2 text-right font-medium sm:pl-4">#</th>
                <th scope="col" className="px-2 py-2 font-medium">Descripción</th>
                <th scope="col" className="w-32 px-2 py-2 text-right font-medium">{seccion.etiquetaCosto}</th>
                <th scope="col" className="w-32 px-2 py-2 text-right font-medium">{seccion.etiquetaCantidad}</th>
                <th scope="col" className="w-32 px-2 py-2 text-right font-medium">Costo total</th>
                <th scope="col" className="w-10 px-2 py-2"><span className="sr-only">Quitar fila</span></th>
              </tr>
            </thead>
            <tbody>
              {filas.map((fila, indice) => {
                const posicion = indice + 1;
                const nombre = fila.descripcion.trim() || `fila ${posicion}`;
                return (
                  <tr key={fila.id} className="border-t border-borde-suave align-middle">
                    <th scope="row" className="px-3 py-1.5 text-right text-xs font-normal tabular-nums text-texto-suave sm:pl-4">{posicion}</th>
                    <td className="px-2 py-1.5">
                      <input
                        type="text"
                        value={fila.descripcion}
                        list={seccion.sugerencias.length > 0 ? idSugerencias : undefined}
                        onChange={(evento) => onCambiar(fila.id, { descripcion: evento.target.value })}
                        aria-label={`Descripción de la fila ${posicion} de ${seccion.titulo}`}
                        placeholder="Escribe el concepto"
                        className="w-full min-w-40 rounded-lg border border-transparent bg-fondo px-2 py-1.5 text-[13px] text-texto outline-none placeholder:text-texto-suave hover:border-borde focus-visible:border-acento focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-acento"
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <input
                        type="number"
                        min={0}
                        step={100}
                        inputMode="numeric"
                        value={fila.costoUnitario}
                        onFocus={(evento) => evento.currentTarget.select()}
                        onChange={(evento) => onCambiar(fila.id, { costoUnitario: Number(evento.target.value) })}
                        aria-label={`${seccion.etiquetaCosto} de ${nombre}, en pesos`}
                        className={CELDA_NUMERO}
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <input
                        type="number"
                        min={0}
                        step={seccion.pasoCantidad}
                        inputMode="decimal"
                        value={fila.cantidad}
                        onFocus={(evento) => evento.currentTarget.select()}
                        onChange={(evento) => onCambiar(fila.id, { cantidad: Number(evento.target.value) })}
                        aria-label={`${seccion.etiquetaCantidad} de ${nombre}`}
                        className={CELDA_NUMERO}
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right text-[13px] font-semibold tabular-nums text-texto">{pesos.format(totalFila(fila))}</td>
                    <td className="px-2 py-1.5">
                      <button
                        type="button"
                        onClick={() => onBorrar(fila.id)}
                        aria-label={`Quitar ${nombre} de ${seccion.titulo}`}
                        className="grid size-7 place-items-center rounded-lg text-texto-suave hover:bg-error-suave hover:text-error focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento"
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-borde bg-superficie-suave">
                <td />
                <th scope="row" className="px-2 py-2 text-[11px] font-semibold uppercase tracking-wide text-texto-suave">Total</th>
                <td />
                <td />
                <td className="px-2 py-2 text-right text-sm font-semibold tabular-nums text-texto">{pesos.format(subtotal)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {seccion.sugerencias.length > 0 && (
        <datalist id={idSugerencias}>
          {seccion.sugerencias.map((sugerencia) => <option key={sugerencia} value={sugerencia} />)}
        </datalist>
      )}

      <div className="flex items-center justify-between gap-3 border-t border-borde-suave px-3 py-2.5 sm:px-4">
        <button
          type="button"
          onClick={onAnadir}
          className="ui-pressable inline-flex h-8 items-center gap-1.5 rounded-lg border border-borde bg-superficie px-2.5 text-xs font-semibold text-acento hover:bg-acento-suave focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento"
        >
          <Plus className="size-3.5" aria-hidden="true" />
          Añadir fila
        </button>
        {/* El subtotal ya lo cierra la fila TOTAL de la tabla; aquí solo se avisa
            que en pantalla angosta la tabla se desplaza para ver el resto. */}
        {filas.length > 0 && <p className="text-xs text-texto-suave sm:hidden">Desliza la tabla para ver el costo total</p>}
      </div>
    </section>
  );
}
