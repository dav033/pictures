"use client";

import { Calculator, ChevronDown } from "lucide-react";
import { subtituloDelPrecio, totalDeLista, type Leyenda } from "@/lib/cotizacion/vigencia";
import { TITULOS_SECCION } from "@/lib/cotizacion/borrador-profesional";
import { SECCIONES_COSTO, type CotizacionProfesionalResultado, type SeccionCosto } from "@/lib/cotizacion/profesional";
import { NumeroAnimado } from "@/components/propuesta/NumeroAnimado";
import { BotonReintentar } from "./ResumenPrecio";
import { CLASE_NO_VIGENTE, pesos } from "./formato";

type Props = {
  datos: CotizacionProfesionalResultado | null;
  enviadas: Record<SeccionCosto, string[]> | null;
  atenuar: boolean;
  leyenda: Leyenda;
  incluyeIva: boolean;
  /** Productos de la propuesta que el precio NO incluye, ya dicho en una frase; `null` si todos entran. */
  avisoExcluidos: string | null;
  abierta: boolean;
  idPanel: string;
  onAlternar: () => void;
  onReintentar: () => void;
};

/**
 * Lo primero que se ve: el precio al cliente, grande y con su estado, qué
 * incluye en una frase y el desglose en pocas fichas. Cada importe es de
 * Python; las fichas no suman nada (cada lista de gastos muestra su propio
 * total y solo aparecen las que entraron en el cálculo).
 */
export function EncabezadoPrecio({ datos, enviadas, atenuar, leyenda, incluyeIva, avisoExcluidos, abierta, idPanel, onAlternar, onReintentar }: Props) {
  const fichas: Array<[string, number]> = datos && enviadas
    ? [
      ["Materiales", datos.materiales.total_cop],
      ...SECCIONES_COSTO.flatMap((seccion): Array<[string, number]> => {
        const total = totalDeLista(datos[seccion].total_cop, enviadas[seccion].length);
        return total === null ? [] : [[TITULOS_SECCION[seccion], total]];
      }),
      ["Tu ganancia", datos.utilidad_cop],
    ]
    : [];
  return (
    <div className="grid items-center gap-x-5 gap-y-2.5 px-4 py-4 @xl:px-5.5 @2xl:grid-cols-[minmax(0,1fr)_auto]">
      <div className="flex min-w-0 items-center gap-3 @2xl:col-start-1">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-linear-to-br from-acento to-acento-2 text-white shadow-[0_6px_18px_var(--sombra-acento)]">
          <Calculator className="size-5" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block text-xs font-medium text-acento">Precio al cliente</span>
          <span className="block text-sm text-texto-suave">{subtituloDelPrecio(incluyeIva)}</span>
        </span>
      </div>
      <div className="grid gap-1 @2xl:col-start-2 @2xl:row-span-3 @2xl:row-start-1 @2xl:max-w-[22rem] @2xl:justify-items-end">
        {/* flex-wrap: a 390 px el precio y «Ajustar mi precio» no caben en una fila y el botón quedaba cortado; ahora baja entero. */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 @2xl:justify-end">
          <span data-precio-total className={`block min-w-0 text-2xl font-semibold tracking-tight tabular-nums text-texto @xl:text-3xl ${atenuar ? CLASE_NO_VIGENTE : ""}`}>
            {datos ? <NumeroAnimado valor={datos.precio_sugerido_cop} formato="pesos" /> : "—"}
            {atenuar && <span className="sr-only"> (precio anterior, no actualizado)</span>}
          </span>
          <button
            type="button"
            onClick={onAlternar}
            aria-expanded={abierta}
            aria-controls={idPanel}
            className="ui-pressable inline-flex h-11 max-w-full shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl bg-acento px-3.5 text-[13px] font-semibold text-sobre-acento hover:bg-acento-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento"
          >
            {abierta ? "Ocultar ajustes" : "Ajustar mi precio"}
            <ChevronDown className={`size-4 transition-transform ${abierta ? "rotate-180" : ""}`} aria-hidden="true" />
          </button>
        </div>
        <p className={`text-xs @2xl:text-right ${leyenda.tono === "error" ? "text-error" : leyenda.tono === "aviso" ? "text-aviso" : "text-texto-suave"}`} aria-live="polite">
          {leyenda.texto}
          {leyenda.reintentar && <BotonReintentar onClick={onReintentar} />}
        </p>
      </div>
      {fichas.length > 0 && (
        <ul className={`flex flex-wrap gap-1.5 @2xl:col-start-1 ${atenuar ? CLASE_NO_VIGENTE : ""}`} aria-label="Desglose del precio">
          {fichas.map(([nombre, valor]) => (
            <li key={nombre} className="rounded-full bg-superficie px-2.5 py-1 text-xs text-texto-suave ring-1 ring-borde-suave ring-inset">
              {nombre} <span className="font-semibold tabular-nums text-texto">{pesos.format(valor)}</span>
            </li>
          ))}
        </ul>
      )}
      {avisoExcluidos && <p className="text-xs text-aviso @2xl:col-start-1" data-testid="aviso-productos-excluidos">{avisoExcluidos}</p>}
    </div>
  );
}
