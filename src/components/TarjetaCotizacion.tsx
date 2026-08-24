"use client";

import { useState } from "react";
import type { Cotizacion } from "@/lib/cotizacion/motor";
import { useBorradorCotizacion, type LineaBorrador } from "@/lib/estado/borrador-cotizacion";

const pesos = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

type Props = {
  cotizacion: Cotizacion;
  /** The parent disables editing while a chat/image request is in flight. */
  editable?: boolean;
  /** Confirmed lines are handed back to the parent, which owns regeneration. */
  onAplicar?: (lineas: LineaBorrador[]) => void;
};

function detalleLinea(linea: LineaBorrador): string {
  const paquetes = linea.paquetes ?? 0;
  const unidades = linea.unidadesPaquete ?? 0;
  const tamano = linea.tamanoCodigo ? ` · ${linea.tamanoCodigo}${linea.diamPulg ? ` (${Math.round(linea.diamPulg * 2.54 * 10) / 10} cm)` : ""}` : "";
  return `${tamano} · ${paquetes} paquete${paquetes === 1 ? "" : "s"} de ${unidades} · necesitas ${linea.cantidadNecesaria}${
    linea.sobrante ? ` · ${linea.sobrante} de sobra` : ""
  }${!linea.disponible ? " · agotado" : ""}`;
}

export function TarjetaCotizacion({ cotizacion, editable = false, onAplicar }: Props) {
  const borrador = useBorradorCotizacion(cotizacion);
  const [editando, setEditando] = useState(false);
  const puedeEditar = editable && Boolean(onAplicar);

  function aplicar(): void {
    if (!onAplicar) return;
    onAplicar(borrador.incluidas);
    setEditando(false);
  }

  function cancelar(): void {
    borrador.descartar();
    setEditando(false);
  }

  return (
    <div className="mt-3 max-w-[85%] space-y-2 rounded-xl border border-borde bg-superficie p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-texto">Cotización</span>
        <span className="text-sm font-semibold text-acento">{pesos.format(borrador.total)}</span>
      </div>

      <ul className="space-y-1.5 text-sm text-texto">
        {borrador.lineas.map((linea, indice) => {
          const nombre = linea.nombre ?? linea.tamano;
          const identificador = `${linea.id}-${indice}`;
          return (
            <li
              key={identificador}
              className={`flex flex-col rounded-lg ${linea.excluida ? "bg-fondo/50 px-2 py-1.5 opacity-60" : ""}`}
            >
              {linea.sinReferencia ? (
                <span className="text-texto-suave">
                  {linea.tamano}
                  {linea.color ? ` ${linea.color}` : ""} · sin referencia disponible en el catálogo
                </span>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <span className={`truncate ${linea.excluida ? "line-through" : ""}`}>{nombre}</span>
                    <span className="shrink-0">{pesos.format(linea.subtotal ?? 0)}</span>
                  </div>

                  {linea.excluida ? (
                    editando ? (
                      <button
                        type="button"
                        onClick={() => borrador.restaurar(linea.id)}
                        className="mt-1 self-start text-xs font-medium text-acento hover:underline"
                      >
                        Restaurar línea
                      </button>
                    ) : (
                      <span className="text-xs text-texto-suave">Línea quitada de esta edición</span>
                    )
                  ) : editando ? (
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-texto-suave">
                      <label className="flex items-center gap-1" htmlFor={`paquetes-${identificador}`}>
                        Paquetes
                        <input
                          id={`paquetes-${identificador}`}
                          type="number"
                          min={1}
                          step={1}
                          inputMode="numeric"
                          value={linea.paquetes ?? 1}
                          onChange={(evento) => borrador.cambiarPaquetes(linea.id, Number(evento.target.value))}
                          className="w-14 rounded border border-borde bg-fondo px-1.5 py-1 text-center text-xs text-texto outline-none focus:border-acento"
                        />
                      </label>
                      <span aria-live="polite">{detalleLinea(linea)}</span>
                      <button
                        type="button"
                        onClick={() => borrador.quitar(linea.id)}
                        className="font-medium text-acento hover:underline"
                      >
                        Quitar
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs text-texto-suave">{detalleLinea(linea)}</span>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>

      <p className="text-xs text-texto-suave">
        Incluye {cotizacion.mermaPorcentaje}% de merma por reventones al inflar/montar · precios{" "}
        {cotizacion.incluyeIva ? "con IVA incluido" : "sin IVA"} · no incluye montaje ni complementos.
      </p>

      {puedeEditar && !editando && (
        <button
          type="button"
          onClick={() => setEditando(true)}
          className="text-xs font-medium text-acento hover:underline"
        >
          Editar cotización
        </button>
      )}

      {puedeEditar && editando && (
        <div className="flex items-center justify-end gap-3 border-t border-borde pt-2">
          <button type="button" onClick={cancelar} className="text-xs text-texto-suave hover:text-texto">
            Cancelar
          </button>
          <button
            type="button"
            onClick={aplicar}
            disabled={!borrador.hayCambios}
            className="rounded-lg bg-acento px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Aplicar cambios
          </button>
        </div>
      )}
    </div>
  );
}
