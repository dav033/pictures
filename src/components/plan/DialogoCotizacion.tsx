"use client";

/* Catalog images come from runtime URLs and already carry explicit dimensions. */
/* eslint-disable @next/next/no-img-element */

import * as Dialog from "@radix-ui/react-dialog";
import { motion, useReducedMotion } from "motion/react";
import { Check, TriangleAlert, X } from "lucide-react";
import type { CompraConsolidada, PlanResuelto } from "@/lib/plan/resuelto";
import { acabadoCliente, contar, esEstructuraDeGlobos, productoCliente, pulgadasCliente, tonoCliente } from "@/lib/plan/presentacion-cliente";
import { NumeroAnimado } from "@/components/propuesta/NumeroAnimado";
import { BotonAprobar } from "@/components/propuesta/BotonAprobar";
import { useFocoDeRetorno } from "@/components/ui/foco-retorno";

const pesos = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const numero = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });

type Props = {
  plan: PlanResuelto;
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
  imagenDe: (compra: CompraConsolidada) => string | undefined;
  onAprobar?: () => void;
  aprobarDeshabilitado?: boolean;
  textoAprobar?: string;
  generando?: boolean;
};

function detalleCompra(compra: CompraConsolidada): string {
  const acabado = acabadoCliente(null, compra.titulo);
  const color = compra.color ? [tonoCliente(compra.color, compra.titulo), acabado].filter(Boolean).join(" ") : null;
  return [compra.tamano_codigo ? pulgadasCliente(compra.tamano_codigo) : null, color].filter(Boolean).join(" · ");
}

/** "Compras una sola vez para las dos piezas" / "para toda la decoración". */
function fraseCompra(plan: PlanResuelto): string {
  const piezas = plan.estructuras.reduce((suma, estructura) => suma + Math.max(1, estructura.repeticiones), 0);
  const cardinales = ["", "", "las dos piezas", "las tres piezas", "las cuatro piezas", "las cinco piezas"];
  return `Compras una sola vez para ${cardinales[piezas] ?? "toda la decoración"}.`;
}

/**
 * Quote of a resolved plan (maqueta Cotizacion). Every figure comes from
 * `PlanResuelto`: what the design needs (`design_quantity`), the closed
 * packages bought (`paquetes`, `unidades_paquete`), the leftovers
 * (`sobrante`), the subtotal, the total and the budget ceiling.
 */
export function DialogoCotizacion({ plan, abierto, onAbiertoChange, imagenDe, onAprobar, aprobarDeshabilitado = false, textoAprobar = "Aprobar y ver cómo queda", generando = false }: Props) {
  const focoRetorno = useFocoDeRetorno();
  const reducir = useReducedMotion();
  const techo = plan.comercial.techo_cop;
  const total = plan.totales.total_cop;
  const excede = plan.comercial.estado === "PRESUPUESTO_EXCEDIDO" || (techo != null && total > techo);
  const comprados = plan.compras.reduce((suma, compra) => suma + compra.purchase_quantity, 0);
  const enDecoracion = plan.totales.design_quantity;
  const compras = [...plan.compras].sort((a, b) => (a.color ?? "").localeCompare(b.color ?? "") || (a.diam_pulg ?? 0) - (b.diam_pulg ?? 0));

  return (
    <Dialog.Root open={abierto} onOpenChange={onAbiertoChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-overlay backdrop-blur-[2px]" />
        <Dialog.Content
          asChild
          aria-describedby={undefined}
          {...focoRetorno}
        >
          <motion.div
            initial={reducir ? false : { opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
            className="fixed inset-x-2 bottom-2 top-auto z-50 mx-auto flex max-h-[calc(100dvh-1rem)] max-w-[55rem] flex-col overflow-hidden rounded-3xl border border-borde-suave bg-superficie shadow-[0_24px_64px_var(--sombra)] sm:inset-x-4 sm:top-1/2 sm:bottom-auto sm:max-h-[calc(100dvh-3rem)] sm:-translate-y-1/2"
          >
            <div className="flex items-start justify-between gap-4 px-5 pb-3 pt-5 sm:px-7 sm:pt-6">
              <div className="min-w-0">
                <p className="text-xs font-medium text-acento">Tu cotización</p>
                <Dialog.Title className="mt-0.5 text-xl font-semibold tracking-tight text-texto sm:text-[22px]">{plan.plan.concepto.titulo}</Dialog.Title>
                <p className="mt-1 text-sm text-texto-suave">Los globos se venden en paquetes cerrados. {fraseCompra(plan)}</p>
              </div>
              <Dialog.Close className="grid size-10 shrink-0 place-items-center rounded-xl bg-acento-suave text-texto hover:text-acento focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento" aria-label="Cerrar cotización">
                <X className="size-4" aria-hidden="true" />
              </Dialog.Close>
            </div>

            {/* Focusable so the list can be scrolled with the keyboard (axe: scrollable-region-focusable). */}
            <div tabIndex={0} aria-label="Productos de la cotización" className="min-h-0 flex-1 overflow-y-auto rounded-lg px-5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-acento sm:px-7">
              <div role="table" aria-label="Productos de la cotización" className="text-sm">
                <div role="rowgroup" className="hidden border-b border-borde-suave pb-2 text-xs text-texto-suave sm:block">
                  <div role="row" className="grid grid-cols-[3.25rem_minmax(0,1fr)_10.5rem_8.5rem_6rem] gap-x-3">
                    <span role="columnheader" className="col-span-2 pl-[4rem]">Globo</span>
                    <span role="columnheader">Para tu decoración</span>
                    <span role="columnheader">Compras</span>
                    <span role="columnheader" className="text-right">Precio</span>
                  </div>
                </div>
                <div role="rowgroup">
                  {compras.map((compra, indice) => {
                    const imagen = imagenDe(compra);
                    const necesitas = compra.design_quantity;
                    const proporcion = compra.purchase_quantity > 0 ? Math.min(1, necesitas / compra.purchase_quantity) : 0;
                    return (
                      <motion.div
                        role="row"
                        key={compra.variant_id}
                        initial={reducir ? false : { opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, delay: reducir ? 0 : 0.08 + indice * 0.05 }}
                        className="grid grid-cols-[3.25rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-b border-borde-suave py-3 last:border-b-0 sm:grid-cols-[3.25rem_minmax(0,1fr)_10.5rem_8.5rem_6rem]"
                      >
                        <span role="cell" className="row-span-2 grid size-13 place-items-center overflow-hidden rounded-xl border border-borde-suave bg-white sm:row-span-1">
                          {imagen ? <img src={imagen} alt="" width={52} height={52} loading="lazy" className="size-full object-contain" /> : <span aria-hidden className="size-full bg-superficie-2" />}
                        </span>
                        <span role="cell" className="min-w-0">
                          <span className="block truncate font-medium text-texto">{productoCliente(compra.titulo)}</span>
                          <span className="mt-0.5 block truncate text-xs text-texto-suave">{detalleCompra(compra)}</span>
                        </span>
                        <span role="cell" className="text-right font-semibold tabular-nums text-texto sm:order-last">{pesos.format(compra.subtotal)}</span>
                        <span role="cell" className="col-start-2 sm:col-start-auto">
                          <span className="block text-[13px] text-texto">Necesitas <strong className="font-semibold tabular-nums">{numero.format(necesitas)}</strong></span>
                          <span aria-hidden="true" className="mt-1.5 block h-1 overflow-hidden rounded-full bg-superficie-2">
                            <motion.span
                              className="block h-full origin-left rounded-full bg-acento/80"
                              style={{ width: `${proporcion * 100}%` }}
                              initial={reducir ? false : { scaleX: 0 }}
                              animate={{ scaleX: 1 }}
                              transition={{ duration: 0.7, delay: reducir ? 0 : 0.25 + indice * 0.05, ease: [0.23, 1, 0.32, 1] }}
                            />
                          </span>
                        </span>
                        <span role="cell" className="col-span-2 col-start-2 text-[13px] text-texto sm:col-span-1 sm:col-start-auto">
                          {contar(compra.paquetes, "paquete", "paquetes")} de {numero.format(compra.unidades_paquete)}
                          <span className="block text-xs text-texto-suave">{compra.sobrante > 0 ? `sobran ${numero.format(compra.sobrante)}` : "sin sobrantes"}</span>
                        </span>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="border-t border-borde-suave bg-superficie-suave px-5 pb-5 pt-4 sm:px-7">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                {techo != null ? (
                  <div className="min-w-0 sm:w-[48%]">
                    <div className="flex items-baseline justify-between gap-3 text-[13px]">
                      <span className="text-texto-suave">Tu presupuesto</span>
                      <span className="tabular-nums text-texto-suave"><strong className="font-semibold text-texto">{pesos.format(total)}</strong> de {pesos.format(techo)}</span>
                    </div>
                    <div aria-hidden="true" className="mt-2 h-2 overflow-hidden rounded-full bg-superficie-2">
                      <motion.div
                        className={`h-full origin-left rounded-full ${excede ? "bg-aviso" : "bg-exito"}`}
                        style={{ width: `${Math.min(1, techo > 0 ? total / techo : 1) * 100}%` }}
                        initial={reducir ? false : { scaleX: 0 }}
                        animate={{ scaleX: 1 }}
                        transition={{ duration: 0.9, delay: reducir ? 0 : 0.3, ease: [0.23, 1, 0.32, 1] }}
                      />
                    </div>
                    <p className={`mt-2 inline-flex items-center gap-1.5 text-[13px] ${excede ? "text-aviso" : "text-exito"}`}>
                      {excede ? <TriangleAlert className="size-3.5" aria-hidden="true" /> : <Check className="size-3.5" aria-hidden="true" />}
                      {excede ? `Se pasa de tu presupuesto por ${pesos.format(Math.max(plan.comercial.delta_cop, total - techo))}` : "Cabe en tu presupuesto"}
                    </p>
                  </div>
                ) : (
                  <p className="text-[13px] text-texto-suave sm:w-[48%]">No me diste un presupuesto; este es el precio de lo que compras.</p>
                )}
                <div className="text-left sm:text-right">
                  <p className="text-[13px] text-texto-suave">{plan.totales.incluye_iva ? "Total con IVA" : "Total sin IVA"}</p>
                  <p className="text-3xl font-semibold tracking-tight text-texto tabular-nums sm:text-[34px]"><NumeroAnimado valor={total} formato="pesos" retraso={reducir ? 0 : 0.2} /></p>
                  <p className="mt-0.5 text-[13px] text-texto-suave">COP · {numero.format(comprados)} {plan.estructuras.every((estructura) => esEstructuraDeGlobos(estructura.tipo)) ? "globos" : "unidades"} comprados, {numero.format(enDecoracion)} en la decoración</p>
                </div>
              </div>
              <p className="mt-3 text-xs text-texto-tenue">Incluye una reserva del {plan.totales.merma_porcentaje}% por globos que se revientan al inflar o montar. No incluye montaje.</p>
              <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Dialog.Close className="ui-pressable inline-flex h-11 items-center justify-center rounded-[0.8rem] border border-borde bg-superficie px-4 text-sm font-medium text-acento hover:bg-acento-suave focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento">
                  Volver a la propuesta
                </Dialog.Close>
                {onAprobar && (
                  <BotonAprobar onClick={onAprobar} disabled={aprobarDeshabilitado} ocupado={generando} retraso={0.9}>
                    {textoAprobar}
                  </BotonAprobar>
                )}
              </div>
            </div>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
