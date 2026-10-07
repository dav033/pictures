"use client";

import type { Cotizacion } from "@/lib/cotizacion/motor";
import type { DecoracionSempertex } from "@/lib/biblioteca-sempertex/esquemas";
import { HEX_COLORES_V2 } from "@/lib/rag/taxonomy/v2";
import { acabadoCliente, conAcabado, nombreLineaCliente, partesLinea, pulgadasDe } from "./formato";

const pesos = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const numero = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });

/** Tonos que el cliente nombra aparte y que la paleta junta con otro («azul marino» va con «azul»). */
const HEX_TONO: Readonly<Record<string, string>> = { "azul marino": "#1f2d5c" };

type FilaCotizacion = { clave: string; nombre: string; acabado: string | null; color?: string; hex?: string; cantidad: number; paquetes: number; unidadesPaquete: number | null; sobrante: number; subtotal: number };

/**
 * Filas para PRESENTAR: una por variante del catálogo, con el globo en palabras de cliente («Globo rosado de 12"»).
 * El nombre sale de la nota del material en la idea elegida (su color ya viene dicho para el cliente) y, sin ella,
 * del nombre de la línea. Si dos variantes quedan con el mismo nombre, se distinguen por el acabado. Ordenadas por
 * color y tamaño. El total NO sale de aquí: es cotizacion.total.
 */
function filasCotizacion(cotizacion: Cotizacion, decoracion: DecoracionSempertex | undefined): FilaCotizacion[] {
  const filas = new Map<string, FilaCotizacion>();
  for (const linea of cotizacion.lineas) {
    const variante = linea.varianteId ?? linea.id;
    const nota = decoracion?.materiales.find((material) => material.variantId === variante)?.nota;
    const fuente = nota ? { nombre: nota } : linea;
    const nombre = nombreLineaCliente(fuente);
    const colorNombre = partesLinea(fuente).color;
    const previa = filas.get(variante);
    const unidades = linea.unidadesPaquete ?? null;
    if (previa) {
      previa.cantidad += linea.cantidadNecesaria ?? 0;
      previa.paquetes += linea.paquetes ?? 0;
      previa.sobrante += linea.sobrante ?? 0;
      previa.subtotal += linea.subtotal ?? 0;
      if (previa.unidadesPaquete !== unidades) previa.unidadesPaquete = null;
    } else {
      const hex = HEX_COLORES_V2[colorNombre as keyof typeof HEX_COLORES_V2] ?? HEX_TONO[colorNombre] ?? (linea.color ? HEX_COLORES_V2[linea.color as keyof typeof HEX_COLORES_V2] : undefined);
      filas.set(variante, { clave: variante, nombre, acabado: acabadoCliente(nota ?? linea.nombre), ...(linea.color ? { color: linea.color } : {}), ...(hex ? { hex } : {}), cantidad: linea.cantidadNecesaria ?? 0, paquetes: linea.paquetes ?? 0, unidadesPaquete: unidades, sobrante: linea.sobrante ?? 0, subtotal: linea.subtotal ?? 0 });
    }
  }
  const lista = [...filas.values()];
  const repetidos = new Set(lista.filter((fila, indice) => lista.findIndex((otra) => otra.nombre === fila.nombre) !== indice).map((fila) => fila.nombre));
  for (const fila of lista) if (repetidos.has(fila.nombre) && fila.acabado) fila.nombre = conAcabado(fila.nombre, fila.acabado);
  const pulgadas = (fila: FilaCotizacion) => Number.parseFloat((pulgadasDe(fila.nombre) ?? "99").replace(",", "."));
  return lista.sort((a, b) => (a.color ?? a.nombre).localeCompare(b.color ?? b.nombre, "es") || pulgadas(a) - pulgadas(b) || a.nombre.localeCompare(b.nombre, "es"));
}

export function CotizacionPersonalGuiada({ cotizacion, decoracion }: { cotizacion: Cotizacion; decoracion?: DecoracionSempertex }) {
  const sobranteTotal = cotizacion.lineas.reduce((total, linea) => total + (linea.sobrante ?? 0), 0);
  const filas = filasCotizacion(cotizacion, decoracion);
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
          return (
            <li key={fila.clave} className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-start gap-x-2.5 gap-y-1 border-b border-borde-suave py-3 last:border-b-0">
              <span aria-hidden="true" className={`mt-0.5 size-4 rounded-full ring-1 ring-inset ${fila.color === "blanco" ? "ring-borde" : "ring-black/10"}`} style={{ backgroundColor: fila.hex ?? "#9ca3af" }} />
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
