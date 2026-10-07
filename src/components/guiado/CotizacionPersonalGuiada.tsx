"use client";

import type { Cotizacion } from "@/lib/cotizacion/motor";
import { HEX_COLORES_V2 } from "@/lib/rag/taxonomy/v2";
import { nombreLineaCliente, pulgadasDe } from "./formato";

const pesos = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const numero = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });

type FilaCotizacion = { clave: string; nombre: string; color?: string; cantidad: number; paquetes: number; unidadesPaquete: number | null; sobrante: number; subtotal: number };

/**
 * Filas para PRESENTAR: ordenadas por color y tamaño, y las del mismo nombre de cliente (mismo color y tamaño)
 * en una sola fila con cantidades, paquetes y subtotales sumados. El total NO sale de aquí: es cotizacion.total.
 */
function filasCotizacion(cotizacion: Cotizacion): FilaCotizacion[] {
  const filas = new Map<string, FilaCotizacion>();
  for (const linea of cotizacion.lineas) {
    const nombre = nombreLineaCliente(linea);
    const clave = nombre.toLocaleLowerCase("es");
    const previa = filas.get(clave);
    const unidades = linea.unidadesPaquete ?? null;
    if (previa) {
      previa.cantidad += linea.cantidadNecesaria ?? 0;
      previa.paquetes += linea.paquetes ?? 0;
      previa.sobrante += linea.sobrante ?? 0;
      previa.subtotal += linea.subtotal ?? 0;
      if (previa.unidadesPaquete !== unidades) previa.unidadesPaquete = null;
    } else {
      filas.set(clave, { clave: linea.id, nombre, ...(linea.color ? { color: linea.color } : {}), cantidad: linea.cantidadNecesaria ?? 0, paquetes: linea.paquetes ?? 0, unidadesPaquete: unidades, sobrante: linea.sobrante ?? 0, subtotal: linea.subtotal ?? 0 });
    }
  }
  const pulgadas = (fila: FilaCotizacion) => Number.parseFloat((pulgadasDe(fila.nombre) ?? "99").replace(",", "."));
  return [...filas.values()].sort((a, b) => (a.color ?? a.nombre).localeCompare(b.color ?? b.nombre, "es") || pulgadas(a) - pulgadas(b));
}

export function CotizacionPersonalGuiada({ cotizacion }: { cotizacion: Cotizacion }) {
  const sobranteTotal = cotizacion.lineas.reduce((total, linea) => total + (linea.sobrante ?? 0), 0);
  const filas = filasCotizacion(cotizacion);
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
        {filas.map((fila) => {
          const hex = fila.color ? HEX_COLORES_V2[fila.color as keyof typeof HEX_COLORES_V2] : undefined;
          return (
            <li key={fila.clave} className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-start gap-x-2.5 gap-y-1 border-b border-borde-suave py-3 last:border-b-0">
              <span aria-hidden="true" className={`mt-0.5 size-4 rounded-full ring-1 ring-inset ${fila.color === "blanco" ? "ring-borde" : "ring-black/10"}`} style={{ backgroundColor: hex ?? "#9ca3af" }} />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-texto">{fila.nombre}</span>
                <span className="mt-0.5 block text-xs leading-5 text-texto-suave">
                  Usas {numero.format(fila.cantidad)} globos · compras {numero.format(fila.paquetes)} {fila.paquetes === 1 ? "paquete" : "paquetes"}{fila.unidadesPaquete ? ` de ${numero.format(fila.unidadesPaquete)}` : ""}
                  {fila.sobrante > 0 && ` · te sobran ${numero.format(fila.sobrante)}`}
                </span>
              </span>
              <span className="pt-0.5 text-right text-sm font-semibold tabular-nums text-texto">{pesos.format(fila.subtotal)}</span>
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
