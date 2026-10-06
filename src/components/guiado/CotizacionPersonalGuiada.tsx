"use client";

import type { Cotizacion } from "@/lib/cotizacion/motor";
import { HEX_COLORES_V2 } from "@/lib/rag/taxonomy/v2";

const pesos = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const numero = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });

export function CotizacionPersonalGuiada({ cotizacion }: { cotizacion: Cotizacion }) {
  const sobranteTotal = cotizacion.lineas.reduce((total, linea) => total + (linea.sobrante ?? 0), 0);
  return (
    <section aria-label="Cotización de materiales" data-testid="cotizacion-personal-guiada" className="mt-3 w-full overflow-hidden rounded-[20px] border border-borde-suave bg-superficie shadow-[0_1px_2px_var(--sombra),0_12px_32px_var(--sombra)]">
      <div className="flex flex-wrap items-end justify-between gap-3 px-4 pt-4 @xl:px-5.5">
        <p className="text-sm font-medium text-acento">Materiales para tu decoración</p>
        <p className="text-right">
          <span className="block text-xs text-texto-suave">Total con IVA</span>
          <span className="block text-2xl font-semibold tracking-tight tabular-nums text-texto">{pesos.format(cotizacion.total)}</span>
        </p>
      </div>
      <ul className="mt-2 px-4 @xl:px-5.5" aria-label="Materiales por color">
        {cotizacion.lineas.map((linea) => {
          const hex = linea.color ? HEX_COLORES_V2[linea.color as keyof typeof HEX_COLORES_V2] : undefined;
          const cantidad = linea.cantidadNecesaria ?? 0;
          const paquetes = linea.paquetes ?? 0;
          const unidadesPaquete = linea.unidadesPaquete ?? 0;
          const sobrante = linea.sobrante ?? 0;
          return (
            <li key={linea.id} className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-start gap-x-2.5 gap-y-1 border-b border-borde-suave py-3 last:border-b-0">
              <span aria-hidden="true" className={`mt-0.5 size-4 rounded-full ring-1 ring-inset ${linea.color === "blanco" ? "ring-borde" : "ring-black/10"}`} style={{ backgroundColor: hex ?? "#9ca3af" }} />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-texto">{linea.nombre ?? "Globo"}</span>
                <span className="mt-0.5 block text-xs leading-5 text-texto-suave">
                  Usas {numero.format(cantidad)} globos · compras {numero.format(paquetes)} {paquetes === 1 ? "paquete" : "paquetes"} de {numero.format(unidadesPaquete)}
                  {sobrante > 0 && ` · te sobran ${numero.format(sobrante)}`}
                </span>
              </span>
              <span className="pt-0.5 text-right text-sm font-semibold tabular-nums text-texto">{pesos.format(linea.subtotal ?? 0)}</span>
            </li>
          );
        })}
      </ul>
      <div className="border-t border-borde-suave bg-superficie-suave px-4 py-3 @xl:px-5.5">
        <p className="text-xs text-texto-suave">Precio de tienda en línea, IVA incluido. No incluye el montaje.</p>
        {sobranteTotal > 0 && <p className="mt-1 text-xs text-texto-suave">Los globos se venden en paquetes cerrados; te sobran {numero.format(sobranteTotal)} para reponer los que se revienten.</p>}
      </div>
    </section>
  );
}
