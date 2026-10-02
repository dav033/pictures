"use client";

import { useEffect } from "react";
import { Plus, Trash2 } from "lucide-react";
import { DESCRIPCIONES_SECCION, TITULOS_SECCION, type ErroresFila, type FilaCosto } from "@/lib/cotizacion/borrador-profesional";
import type { FilaQuitada } from "@/lib/cotizacion/deshacer-fila";
import { estadoFilas } from "@/lib/cotizacion/limites-filas";
import type { SeccionCosto } from "@/lib/cotizacion/profesional";
import { Campo, MensajesDeError } from "./Campo";
import { CLASE_NO_VIGENTE, importeOGuion } from "./formato";

type Props = {
  seccion: SeccionCosto;
  clave: string;
  filas: FilaCosto[];
  /** Qué dice cada celda mala, por id de fila. */
  errores: Record<string, ErroresFila>;
  /** Lo que impide calcular si hay más gastos que el tope. */
  exceso?: string;
  /** El resultado que se ve es el anterior: los importes se atenúan. */
  atenuar: boolean;
  /** Subtotal de una fila según el último cálculo, o `null` si esa fila no formó parte. */
  subtotal: (id: string) => number | null;
  /** Total de la lista según Python, o `null` si la lista no estuvo en el cálculo («—»). */
  total: number | null;
  /** El gasto que acaba de quitarse, para devolverlo. */
  quitada: FilaQuitada | null;
  /** Fila que debe recibir el foco (la que se acaba de agregar). */
  foco: string | null;
  onFocoListo: () => void;
  onCambiar: (id: string, cambios: Partial<FilaCosto>) => void;
  onAgregar: () => void;
  onQuitar: (id: string) => void;
  onDeshacer: () => void;
};

export function SeccionGastos(props: Props) {
  const { seccion, clave, filas, errores, exceso, atenuar, subtotal, total, quitada, foco, onFocoListo } = props;
  const titulo = TITULOS_SECCION[seccion];
  const limite = estadoFilas(filas.length);
  const idAyuda = `${seccion}-${clave}-limite`;

  useEffect(() => {
    if (!foco || !filas.some((fila) => fila.id === foco)) return;
    document.getElementById(`${seccion}-${clave}-${foco}-descripcion`)?.focus();
    onFocoListo();
  }, [foco, filas, seccion, clave, onFocoListo]);

  return (
    <div className="mt-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[13px] font-semibold text-texto">{titulo}</h3>
        <button
          type="button"
          onClick={props.onAgregar}
          disabled={limite.llena}
          aria-label={`Agregar a ${titulo}`}
          aria-describedby={limite.llena ? idAyuda : undefined}
          className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-[13px] font-medium text-acento hover:bg-acento-suave focus-visible:outline-2 focus-visible:outline-acento disabled:cursor-not-allowed disabled:text-texto-suave disabled:hover:bg-transparent"
        >
          <Plus className="size-4" aria-hidden="true" />Agregar
        </button>
      </div>
      <p className="-mt-2 text-xs text-texto-suave">{DESCRIPCIONES_SECCION[seccion]}</p>
      {(limite.contador || exceso) && (
        <p id={idAyuda} className={`mt-1 text-xs ${exceso ? "text-error" : limite.llena ? "text-aviso" : "text-texto-suave"}`}>
          {exceso ?? `${limite.contador}${limite.motivoSinAgregar ? `. ${limite.motivoSinAgregar}` : ""}`}
        </p>
      )}
      {filas.length > 0 && (
        <ul className="mt-1.5 space-y-3" aria-label={titulo}>
          {filas.map((fila) => {
            const base = `${seccion}-${clave}-${fila.id}`;
            const fallos = errores[fila.id] ?? {};
            const valor = subtotal(fila.id);
            const nombreFila = fila.descripcion.trim() || "este gasto";
            return (
              <li key={fila.id} className="grid gap-1.5 @xl:grid-cols-[minmax(0,1fr)_8rem_5rem_6.5rem_2.75rem]">
                <div className="flex items-start gap-2 @xl:contents">
                  <Campo
                    id={`${base}-descripcion`}
                    className="flex-1 @xl:col-start-1"
                    etiqueta="Descripción"
                    nombre={`Descripción (${titulo})`}
                    valor={fila.descripcion}
                    maxLength={120}
                    onValor={(texto) => props.onCambiar(fila.id, { descripcion: texto })}
                    error={fallos.descripcion}
                  />
                  <span className={`shrink-0 self-center text-right text-[13px] font-medium tabular-nums text-texto @xl:col-start-4 @xl:row-start-1 ${atenuar && valor !== null ? CLASE_NO_VIGENTE : ""}`}>
                    {importeOGuion(valor)}
                  </span>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_5rem_2.75rem] gap-1.5 @xl:contents">
                  <Campo
                    id={`${base}-costo`}
                    tipo="pesos"
                    derecha
                    etiqueta="Valor por unidad"
                    nombre={`Valor por unidad (${titulo})`}
                    valor={fila.costo}
                    onValor={(texto) => props.onCambiar(fila.id, { costo: texto })}
                    error={fallos.costo}
                  />
                  <Campo
                    id={`${base}-cantidad`}
                    tipo="decimal"
                    derecha
                    etiqueta="Cantidad"
                    nombre={`Cantidad (${titulo})`}
                    valor={fila.cantidad}
                    onValor={(texto) => props.onCambiar(fila.id, { cantidad: texto })}
                    error={fallos.cantidad}
                  />
                  <button
                    type="button"
                    onClick={() => props.onQuitar(fila.id)}
                    aria-label={`Quitar ${nombreFila}`}
                    className="grid size-11 place-items-center rounded-lg text-texto-suave hover:bg-error-suave hover:text-error focus-visible:outline-2 focus-visible:outline-acento"
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </div>
                <MensajesDeError
                  mensajes={[
                    ...(fallos.descripcion ? [{ id: `${base}-descripcion`, texto: fallos.descripcion }] : []),
                    ...(fallos.costo ? [{ id: `${base}-costo`, texto: fallos.costo }] : []),
                    ...(fallos.cantidad ? [{ id: `${base}-cantidad`, texto: fallos.cantidad }] : []),
                  ]}
                />
              </li>
            );
          })}
        </ul>
      )}
      {filas.length > 0 && (
        <p className={`mt-2 text-right text-[13px] text-texto-suave ${atenuar && total !== null ? CLASE_NO_VIGENTE : ""}`}>
          Total: <span className="font-semibold tabular-nums text-texto">{importeOGuion(total)}</span>
        </p>
      )}
      {quitada && (
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-texto-suave" role="status">
          Quitaste «{quitada.fila.descripcion.trim() || "un gasto"}».
          <button type="button" onClick={props.onDeshacer} className="inline-flex min-h-11 items-center px-1 font-medium text-acento underline focus-visible:outline-2 focus-visible:outline-acento">
            Deshacer
          </button>
        </p>
      )}
    </div>
  );
}
