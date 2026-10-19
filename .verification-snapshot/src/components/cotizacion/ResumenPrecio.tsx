"use client";

import { motion } from "motion/react";
import { TITULOS_SECCION } from "@/lib/cotizacion/borrador-profesional";
import { SECCIONES_COSTO, type CotizacionProfesionalResultado, type SeccionCosto } from "@/lib/cotizacion/profesional";
import { totalDeLista, subtituloDelPrecio, type Leyenda } from "@/lib/cotizacion/vigencia";
import { NumeroAnimado } from "@/components/propuesta/NumeroAnimado";
import { EASE_SALIDA } from "@/components/guiado/animacion/movimiento";
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

/** El color de cada parte del precio, el mismo en la barra y en su línea. */
const COLOR_MATERIALES = "bg-acento-2";
const COLOR_GANANCIA = "bg-exito";
const COLOR_SECCION: Record<SeccionCosto, string> = {
  mano_de_obra: "bg-acento",
  equipos_transporte: "bg-aviso",
  indirectos: "bg-texto-tenue",
};

export function BotonReintentar({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="ml-1 inline-flex min-h-11 items-center px-1 text-[13px] font-medium text-acento underline focus-visible:outline-2 focus-visible:outline-acento">
      Reintentar
    </button>
  );
}

/** Una parte del precio: signo, punto de color, nombre e importe de Python. */
function Parte({ signo, color, nombre, valor }: { signo: "" | "+"; color: string; nombre: string; valor: number }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="flex min-w-0 items-center gap-2 text-texto-suave">
        <span aria-hidden="true" className="w-3 shrink-0 text-center font-semibold text-texto-tenue">{signo}</span>
        <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${color}`} />
        <span className="truncate">{nombre}</span>
      </dt>
      <dd className="shrink-0 tabular-nums text-texto">{pesos.format(valor)}</dd>
    </div>
  );
}

/**
 * «Así se arma tu precio»: materiales + tus gastos + tu ganancia = precio al
 * cliente. Cada importe es el que calculó Python; aquí solo se listan, y la
 * barra muestra qué parte del precio es cada uno.
 */
export function ResumenPrecio({ datos, enviadas, atenuar, leyenda, onReintentar, incluyeIva }: Props) {
  const gastos = datos && enviadas
    ? SECCIONES_COSTO.flatMap((seccion) => {
      const total = totalDeLista(datos[seccion].total_cop, enviadas[seccion].length);
      return total === null ? [] : [{ seccion, nombre: TITULOS_SECCION[seccion], valor: total }];
    })
    : [];
  const partes = datos
    ? [
      { clave: "materiales", color: COLOR_MATERIALES, valor: datos.materiales.total_cop },
      ...gastos.map(({ seccion, valor }) => ({ clave: seccion, color: COLOR_SECCION[seccion], valor })),
      { clave: "ganancia", color: COLOR_GANANCIA, valor: datos.utilidad_cop },
    ]
    : [];
  const precio = datos?.precio_sugerido_cop ?? 0;
  return (
    <div className="rounded-2xl bg-superficie p-4 ring-1 ring-borde-suave ring-inset">
      <h3 className="text-sm font-semibold text-texto">Así se arma tu precio</h3>
      <p className="mt-0.5 text-xs text-texto-suave">{subtituloDelPrecio(incluyeIva)}</p>
      <p className={`mt-2 text-xs ${leyenda.tono === "error" ? "text-error" : leyenda.tono === "aviso" ? "text-aviso" : "text-texto-suave"}`}>
        {leyenda.texto}
        {leyenda.reintentar && <BotonReintentar onClick={onReintentar} />}
      </p>
      {datos && (
        <div className={atenuar ? CLASE_NO_VIGENTE : ""}>
          {precio > 0 && (
            <div aria-hidden="true" className="mt-3 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-fondo">
              {partes.filter((parte) => parte.valor > 0).map((parte) => (
                <motion.span
                  key={parte.clave}
                  className={`block h-full first:rounded-l-full last:rounded-r-full ${parte.color}`}
                  initial={false}
                  animate={{ width: `${Math.min(100, (parte.valor / precio) * 100)}%` }}
                  transition={{ duration: 0.5, ease: EASE_SALIDA }}
                />
              ))}
            </div>
          )}
          <dl className="mt-3 space-y-1.5 text-[13px]">
            <Parte signo="" color={COLOR_MATERIALES} nombre="Materiales" valor={datos.materiales.total_cop} />
            {gastos.map(({ seccion, nombre, valor }) => (
              <Parte key={seccion} signo="+" color={COLOR_SECCION[seccion]} nombre={nombre} valor={valor} />
            ))}
            <div className="flex justify-between gap-3 border-t border-dashed border-borde-suave pt-1.5 font-medium">
              <dt className="pl-5 text-texto">Lo que te cuesta todo</dt>
              <dd className="tabular-nums text-texto">{pesos.format(datos.total_costos_cop)}</dd>
            </div>
            <Parte
              signo="+"
              color={COLOR_GANANCIA}
              nombre={`Tu ganancia${datos.utilidad_porcentaje === null ? "" : ` (${numero.format(datos.utilidad_porcentaje)} %)`}`}
              valor={datos.utilidad_cop}
            />
          </dl>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-2 rounded-xl bg-acento-suave px-3 py-2.5">
            <span className="flex items-center gap-2 text-xs font-semibold text-acento">
              <span aria-hidden="true" className="text-base leading-none">=</span>
              {atenuar ? "Último precio calculado" : "Precio al cliente"}
            </span>
            <span className="text-2xl font-bold tracking-tight tabular-nums text-texto">
              <NumeroAnimado valor={datos.precio_sugerido_cop} formato="pesos" />
              {atenuar && <span className="sr-only"> (precio anterior, no actualizado)</span>}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
