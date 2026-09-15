"use client";

/* Catalog photos come from runtime URLs and already carry explicit dimensions. */
/* eslint-disable @next/next/no-img-element */

import { Fragment, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { RotateCcw, Trash2 } from "lucide-react";
import type { Cotizacion } from "@/lib/cotizacion/motor";
import type { ReferenceBlueprintV2 } from "@/lib/ia/reference-blueprint";
import { useBorradorCotizacion, type LineaBorrador } from "@/lib/estado/borrador-cotizacion";
import { idsSinFoto, useImagenesCatalogo } from "@/lib/estado/imagenes-catalogo";
import { agruparComprasCliente, paquetesCliente, partesPaquetesCliente, productoCliente, pulgadasCliente, sobranteCliente } from "@/lib/plan/presentacion-cliente";
import { NumeroAnimado } from "@/components/propuesta/NumeroAnimado";

const pesos = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});
const numero = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });

type Props = {
  cotizacion: Cotizacion;
  /** The parent disables editing while a chat/image request is in flight. */
  editable?: boolean;
  /** Confirmed lines are handed back to the parent, which owns regeneration. */
  onAplicar?: (lineas: LineaBorrador[]) => void;
  referenceBlueprint?: ReferenceBlueprintV2;
};

function tamanoLinea(linea: LineaBorrador): string | null {
  if (linea.tamanoCodigo) return pulgadasCliente(linea.tamanoCodigo);
  if (linea.diamPulg) return `${numero.format(linea.diamPulg)} pulgadas`;
  // Plan quotes use "sin tamaño aplicable" for items without a size (number balloons, backdrops).
  return linea.tamano && !/^sin tama/i.test(linea.tamano) ? pulgadasCliente(linea.tamano) : null;
}

/**
 * Rows shown for the draft: outside editing, one row per product + size + color
 * even when the cheapest mix buys two package sizes (D3). While editing, each
 * line keeps its own row because packages are adjusted per package size.
 * Lines without a catalog match or removed from the draft never merge.
 */
export function filasBorrador(lineas: readonly LineaBorrador[], editando: boolean) {
  return agruparComprasCliente(lineas, (linea) => ({
    product_id: editando || linea.sinReferencia || linea.excluida ? `${linea.id}|${linea.excluida ? "x" : ""}` : linea.productId ?? null,
    titulo: linea.nombre ?? linea.id,
    tamano_codigo: linea.tamanoCodigo ?? linea.tamano,
    diam_pulg: linea.diamPulg ?? null,
    color: linea.color ?? null,
    necesitas: linea.cantidadNecesaria,
    paquetes: linea.paquetes ?? 0,
    unidades_paquete: linea.unidadesPaquete ?? 0,
    sobrante: linea.sobrante ?? 0,
    subtotal: linea.subtotal ?? 0,
  }));
}

/**
 * Quote without a plan (tool `cotizar`), in the same style as the plan quote
 * dialog (maqueta Cotizacion): product photo, what the design needs, closed
 * packages bought, leftovers and price. The customer can still adjust packages
 * or remove lines; the parent owns regeneration.
 */
export function TarjetaCotizacion({ cotizacion, editable = false, onAplicar, referenceBlueprint }: Props) {
  const borrador = useBorradorCotizacion(cotizacion);
  const [editando, setEditando] = useState(false);
  const reducir = useReducedMotion();
  const puedeEditar = editable && Boolean(onAplicar);
  // Lines from a plan quote carry no photo: load it from the catalog like the proposal card does (D9).
  const { imagenes: imagenesCatalogo } = useImagenesCatalogo(idsSinFoto(cotizacion.lineas));
  const elementosReferencia = new Set((referenceBlueprint?.elements ?? []).map((elemento) => elemento.element_id));

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
    <motion.section
      aria-label="Cotización"
      initial={reducir ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.23, 1, 0.32, 1] }}
      className="@container mt-3 w-full max-w-190 overflow-hidden rounded-[20px] border border-borde-suave bg-superficie shadow-[0_1px_2px_var(--sombra),0_12px_32px_var(--sombra)]"
    >
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 px-4 pt-4 @xl:px-5.5">
        <div>
          <p className="text-xs font-medium text-acento">Tu cotización</p>
          <p className="mt-0.5 text-sm text-texto-suave">Los globos se venden en paquetes cerrados.</p>
        </div>
        <p className="text-right">
          <span className="block text-xs text-texto-suave">{cotizacion.incluyeIva ? "Total con IVA" : "Total sin IVA"}</span>
          <span className="block text-2xl font-semibold tracking-tight tabular-nums text-texto"><NumeroAnimado valor={borrador.total} formato="pesos" /></span>
        </p>
      </div>

      <ul className="mt-2 px-4 @xl:px-5.5" aria-label="Productos de la cotización">
        {filasBorrador(borrador.lineas, editando).map((fila, indice) => {
          const linea = fila.items[0]!;
          const identificador = `${linea.id}-${indice}`;
          const tamano = tamanoLinea(linea);
          const detalle = [tamano, linea.color].filter(Boolean).join(" · ");
          if (linea.sinReferencia) {
            return (
              <li key={identificador} className="border-b border-borde-suave py-3 text-[13px] text-texto-suave last:border-b-0">
                {detalle || "Globo"} · todavía no está disponible en el catálogo
              </li>
            );
          }
          const nombre = linea.nombre ? productoCliente(linea.nombre) : detalle || "Producto";
          const compra = { paquetes: paquetesCliente(fila.paquetes), resto: sobranteCliente(fila.sobrante) };
          const proporcion = fila.compradas > 0 ? Math.min(1, fila.necesitas / fila.compradas) : 0;
          const foto = fila.items.map((item) => item.foto ?? (item.varianteId ? imagenesCatalogo[item.varianteId] : undefined)).find(Boolean);
          const deLaFoto = fila.items.some((item) => item.referenciaElementIds?.some((id) => elementosReferencia.has(id)) ?? false);
          return (
            <motion.li
              key={identificador}
              initial={reducir ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: linea.excluida ? 0.55 : 1, y: 0 }}
              transition={{ duration: 0.3, delay: reducir ? 0 : indice * 0.05 }}
              className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-b border-borde-suave py-3 last:border-b-0 @xl:grid-cols-[3rem_minmax(0,1fr)_9.5rem_8rem_5.5rem]"
            >
              <span className="row-span-2 grid size-12 place-items-center overflow-hidden rounded-xl border border-borde-suave bg-white @xl:row-span-1">
                {foto ? <img src={foto} alt="" width={48} height={48} loading="lazy" className="size-full object-contain" /> : <span aria-hidden className="size-full bg-superficie-2" />}
              </span>
              <span className="min-w-0">
                <span className={`block truncate text-sm font-medium text-texto ${linea.excluida ? "line-through" : ""}`}>{nombre}</span>
                <span className="mt-0.5 block truncate text-xs text-texto-suave">
                  {detalle}
                  {deLaFoto && <span className="ml-1.5 rounded-full bg-acento-suave px-1.5 py-px text-[11px] text-acento">de tu foto</span>}
                  {fila.items.some((item) => !item.disponible) && <span className="ml-1.5 text-aviso">agotado</span>}
                </span>
              </span>
              <span className="text-right text-sm font-semibold tabular-nums text-texto @xl:order-last">{pesos.format(fila.subtotal)}</span>
              <span className="col-start-2 @xl:col-start-auto">
                <span className="block text-[13px] text-texto">Necesitas <strong className="font-semibold tabular-nums">{numero.format(fila.necesitas)}</strong></span>
                <span aria-hidden="true" className="mt-1.5 block h-1 overflow-hidden rounded-full bg-superficie-2">
                  <motion.span
                    className="block h-full origin-left rounded-full bg-acento/80"
                    style={{ width: `${proporcion * 100}%` }}
                    initial={reducir ? false : { scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: 0.7, delay: reducir ? 0 : 0.2 + indice * 0.05, ease: [0.23, 1, 0.32, 1] }}
                  />
                </span>
              </span>
              <span className="col-span-2 col-start-2 text-[13px] text-texto @xl:col-span-1 @xl:col-start-auto">
                {linea.excluida ? (
                  editando ? (
                    <button type="button" onClick={() => borrador.restaurar(linea.id)} className="inline-flex items-center gap-1 text-xs font-medium text-acento hover:underline focus-visible:outline-2 focus-visible:outline-acento">
                      <RotateCcw className="size-3" aria-hidden="true" />Restaurar
                    </button>
                  ) : (
                    <span className="text-xs text-texto-suave">Quitada de esta edición</span>
                  )
                ) : editando ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-1 text-xs text-texto-suave" htmlFor={`paquetes-${identificador}`}>
                      Paquetes
                      <input
                        id={`paquetes-${identificador}`}
                        type="number"
                        min={1}
                        step={1}
                        inputMode="numeric"
                        value={linea.paquetes ?? 1}
                        onChange={(evento) => borrador.cambiarPaquetes(linea.id, Number(evento.target.value))}
                        className="w-14 rounded-lg border border-borde bg-fondo px-1.5 py-1 text-center text-xs text-texto outline-none focus-visible:border-acento focus-visible:outline-2 focus-visible:outline-acento"
                      />
                    </label>
                    <button type="button" onClick={() => borrador.quitar(linea.id)} aria-label={`Quitar ${nombre}`} className="grid size-7 place-items-center rounded-lg text-texto-suave hover:bg-error-suave hover:text-error focus-visible:outline-2 focus-visible:outline-acento">
                      <Trash2 className="size-3.5" aria-hidden="true" />
                    </button>
                    <span className="w-full text-xs text-texto-suave" aria-live="polite">{compra.paquetes} · {compra.resto}</span>
                  </span>
                ) : (
                  <>
                    {partesPaquetesCliente(fila.paquetes).map((parte, posicion) => <Fragment key={parte}>{posicion > 0 && " + "}<span className="whitespace-nowrap">{parte}</span></Fragment>)}
                    <span className={`block text-xs ${fila.sobrante < 0 ? "text-aviso" : "text-texto-suave"}`}>{compra.resto}</span>
                  </>
                )}
              </span>
            </motion.li>
          );
        })}
      </ul>

      <div className="mt-2 border-t border-borde-suave bg-superficie-suave px-4 py-3 @xl:px-5.5">
        <p className="text-xs text-texto-suave">
          Incluye {cotizacion.mermaPorcentaje}% de reserva por globos que se revientan al inflar o montar · precios {cotizacion.incluyeIva ? "con IVA incluido" : "sin IVA"} · no incluye montaje ni complementos.
        </p>
        {puedeEditar && (
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            {editando ? (
              <>
                <button type="button" onClick={cancelar} className="inline-flex h-9 items-center rounded-xl px-3 text-[13px] font-medium text-texto-suave hover:text-texto focus-visible:outline-2 focus-visible:outline-acento">
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={aplicar}
                  disabled={!borrador.hayCambios}
                  className="ui-pressable inline-flex h-9 items-center rounded-xl bg-acento px-3.5 text-[13px] font-semibold text-sobre-acento hover:bg-acento-hover disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento"
                >
                  Aplicar cambios
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setEditando(true)} className="inline-flex h-9 items-center rounded-xl border border-borde bg-superficie px-3.5 text-[13px] font-medium text-acento hover:bg-acento-suave focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento">
                Editar cotización
              </button>
            )}
          </div>
        )}
      </div>
    </motion.section>
  );
}
