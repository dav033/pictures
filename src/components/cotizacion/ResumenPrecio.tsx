"use client";

import { TITULOS_SECCION } from "@/lib/cotizacion/borrador-profesional";
import { SECCIONES_COSTO, type CotizacionProfesionalResultado, type SeccionCosto } from "@/lib/cotizacion/profesional";
import { totalDeLista, subtituloDelPrecio, type Leyenda } from "@/lib/cotizacion/vigencia";
import { NumeroAnimado } from "@/components/propuesta/NumeroAnimado";
import { CLASE_NO_VIGENTE, numero, pesos } from "./formato";

type Props = {
  datos: CotizacionProfesionalResultado | null;
  /** Filas que formaron parte del cálculo, por lista: una lista sin ninguna no aparece (no vale $ 0). */
  enviadas: Record<SeccionCosto, string[]> | null;
  /** El resultado que se ve es el anterior. */
  atenuar: boolean;
  leyenda: Leyenda;
  onReintentar: () => void;
  incluyeIva: boolean;
};

export function BotonReintentar({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="ml-1 inline-flex min-h-11 items-center px-1 text-[13px] font-medium text-acento underline focus-visible:outline-2 focus-visible:outline-acento">
      Reintentar
    </button>
  );
}

/** «Así se arma tu precio»: cada importe es el que calculó Python; aquí solo se listan. */
export function ResumenPrecio({ datos, enviadas, atenuar, leyenda, onReintentar, incluyeIva }: Props) {
  const gastos = datos && enviadas
    ? SECCIONES_COSTO.flatMap((seccion) => {
      const total = totalDeLista(datos[seccion].total_cop, enviadas[seccion].length);
      return total === null ? [] : [[TITULOS_SECCION[seccion], total] as const];
    })
    : [];
  return (
    <div className="rounded-2xl bg-superficie p-4 ring-1 ring-borde-suave ring-inset">
      <h3 className="text-[13px] font-semibold text-texto">Así se arma tu precio</h3>
      <p className="mt-0.5 text-xs text-texto-suave">{subtituloDelPrecio(incluyeIva)}</p>
      <p className={`mt-2 text-xs ${leyenda.tono === "error" ? "text-error" : leyenda.tono === "aviso" ? "text-aviso" : "text-texto-suave"}`}>
        {leyenda.texto}
        {leyenda.reintentar && <BotonReintentar onClick={onReintentar} />}
      </p>
      {datos && (
        <div className={atenuar ? CLASE_NO_VIGENTE : ""}>
          <dl className="mt-2 space-y-1 text-[13px]">
            <div className="flex justify-between gap-3">
              <dt className="text-texto-suave">Materiales</dt>
              <dd className="tabular-nums text-texto">{pesos.format(datos.materiales.total_cop)}</dd>
            </div>
            {gastos.map(([nombre, valor]) => (
              <div key={nombre} className="flex justify-between gap-3">
                <dt className="text-texto-suave">{nombre}</dt>
                <dd className="tabular-nums text-texto">{pesos.format(valor)}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-3 border-t border-borde-suave pt-1 font-medium">
              <dt className="text-texto">Lo que te cuesta todo</dt>
              <dd className="tabular-nums text-texto">{pesos.format(datos.total_costos_cop)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-texto-suave">Tu ganancia{datos.utilidad_porcentaje === null ? "" : ` (${numero.format(datos.utilidad_porcentaje)} %)`}</dt>
              <dd className="tabular-nums text-texto">{pesos.format(datos.utilidad_cop)}</dd>
            </div>
          </dl>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-2 border-t border-borde-suave pt-3">
            <span className="block text-xs font-medium text-acento">{atenuar ? "Último precio calculado" : "Precio al cliente"}</span>
            <span className="text-2xl font-semibold tracking-tight tabular-nums text-texto">
              <NumeroAnimado valor={datos.precio_sugerido_cop} formato="pesos" />
              {atenuar && <span className="sr-only"> (precio anterior, no actualizado)</span>}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
