"use client";

import { useState } from "react";
import { ChevronDown, RotateCcw } from "lucide-react";
import { TEXTO_ESTADO_PRECIO, estadoPrecioMaterial, nombreMaterialCliente } from "@/lib/cotizacion/borrador-profesional";
import type { LineaMaterialProfesional } from "@/lib/cotizacion/profesional";
import { Campo, MensajesDeError } from "./Campo";
import { CLASE_NO_VIGENTE, importeOGuion, numero, pesos } from "./formato";

type Props = {
  clave: string;
  materiales: readonly LineaMaterialProfesional[];
  /** Lo que el usuario escribió como precio por paquete, por variante (sin entrada: el del catálogo). */
  precios: Record<string, string>;
  /** Qué dice cada precio malo o a medias, por variante. */
  errores: Record<string, string>;
  atenuar: boolean;
  /** Subtotal de cada material según el último cálculo de Python. */
  subtotalDe: (variantId: string) => number | null;
  /** Total de materiales según Python, o `null`. */
  total: number | null;
  onPrecio: (variantId: string, texto: string | null) => void;
};

/**
 * Los precios por paquete de los materiales de la propuesta. Plegado: lo común
 * es dejar el precio de catálogo. Con un precio malo o a medias se abre solo,
 * porque el campo que hay que corregir no puede quedar escondido.
 */
export function PreciosMateriales({ clave, materiales, precios, errores, atenuar, subtotalDe, total, onPrecio }: Props) {
  const [abierto, setAbierto] = useState(false);
  const hayErrores = Object.keys(errores).length > 0;
  return (
    <details
      className="group mt-5 rounded-xl ring-1 ring-borde-suave ring-inset"
      open={abierto || hayErrores}
      onToggle={(evento) => setAbierto(evento.currentTarget.open)}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-2.5 text-[13px] font-semibold text-texto focus-visible:outline-2 focus-visible:outline-acento">
        <span>
          Tus materiales · {materiales.length} {materiales.length === 1 ? "producto" : "productos"}
          <span className="block text-xs font-normal text-texto-suave">Con precio de catálogo; cámbialo si compras a otro.</span>
        </span>
        <span className="flex items-center gap-2 tabular-nums">
          <span className={atenuar && total !== null ? CLASE_NO_VIGENTE : ""}>{total !== null && importeOGuion(total)}</span>
          <ChevronDown className="size-4 text-texto-suave transition-transform group-open:rotate-180" aria-hidden="true" />
        </span>
      </summary>
      <ul className="border-t border-borde-suave px-3.5" aria-label="Materiales del precio al cliente">
        {materiales.map((material) => {
          const escrito = precios[material.variant_id];
          const estado = estadoPrecioMaterial(escrito, material.precio_paquete_catalogo_cop);
          const error = errores[material.variant_id];
          const nombre = nombreMaterialCliente(material.descripcion);
          const idEntrada = `precio-${clave}-${material.variant_id}`;
          const valor = subtotalDe(material.variant_id);
          return (
            <li key={material.variant_id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 border-b border-borde-suave py-3 last:border-b-0 @xl:grid-cols-[minmax(0,1fr)_minmax(0,15rem)_5.5rem]">
              <span className="col-start-1 row-start-1 min-w-0">
                <span className="block text-[13px] font-medium text-texto">{nombre}</span>
                <span className={`block text-xs ${estado === "vacio" || estado === "ilegible" ? "text-error" : estado === "propio" ? "text-acento" : "text-texto-suave"}`}>
                  {numero.format(material.paquetes)} {material.paquetes === 1 ? "paquete" : "paquetes"} · {TEXTO_ESTADO_PRECIO[estado]}
                </span>
              </span>
              <span className="col-span-2 row-start-2 flex items-center gap-1.5 @xl:col-span-1 @xl:col-start-2 @xl:row-start-1">
                <Campo
                  id={idEntrada}
                  className="flex-1"
                  tipo="pesos"
                  derecha
                  etiqueta="Por paquete"
                  nombre={`Precio por paquete de ${nombre}`}
                  valor={escrito !== undefined ? escrito : numero.format(material.precio_paquete_catalogo_cop)}
                  onValor={(texto) => onPrecio(material.variant_id, texto)}
                  error={error}
                  destacado={estado === "propio"}
                />
                {/* El hueco del botón se reserva siempre: el campo no cambia de ancho al escribir. */}
                <span className="grid size-11 shrink-0 place-items-center">
                  {estado !== "catalogo" && (
                    <button
                      type="button"
                      onClick={() => onPrecio(material.variant_id, null)}
                      aria-label={`Volver al precio de catálogo de ${nombre}`}
                      title={`Precio de catálogo: ${pesos.format(material.precio_paquete_catalogo_cop)}`}
                      className="grid size-11 place-items-center rounded-lg text-texto-suave hover:bg-acento-suave hover:text-acento focus-visible:outline-2 focus-visible:outline-acento"
                    >
                      <RotateCcw className="size-4" aria-hidden="true" />
                    </button>
                  )}
                </span>
              </span>
              <span className={`col-start-2 row-start-1 text-right text-[13px] font-semibold tabular-nums text-texto @xl:col-start-3 ${atenuar && valor !== null ? CLASE_NO_VIGENTE : ""}`}>{importeOGuion(valor)}</span>
              <MensajesDeError mensajes={error ? [{ id: idEntrada, texto: error }] : []} />
            </li>
          );
        })}
      </ul>
    </details>
  );
}
