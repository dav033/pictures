"use client";

import { motion } from "motion/react";
import { Balloon, Package } from "lucide-react";
import type { ModoMateriales as Modo } from "@/lib/cotizacion/profesional";
import { RESORTE } from "@/components/guiado/animacion/movimiento";
import { CLASE_NO_VIGENTE, importeOGuion, numero } from "./formato";

type Props = {
  clave: string;
  modo: Modo;
  onModo: (modo: Modo) => void;
  /** Totales de materiales de Python en cada modo (`null` mientras no hay uno). */
  totalPaquetes: number | null;
  totalGranel: number | null;
  /** Globos que se cotizan a granel (los del plan más los extra) y los que sobrarían con paquetes, de Python. */
  globos: { plan: number; extra: number; sobrante: number } | null;
  atenuar: boolean;
};

const OPCIONES = [
  { modo: "paquete", titulo: "Por paquete", Icono: Package },
  { modo: "granel", titulo: "Por unidad (a granel)", Icono: Balloon },
] as const;

/**
 * El conmutador «Por paquete | Por unidad (a granel)» del decorador: con cada
 * opción, el total de materiales que Python calculó para ella, para comparar
 * antes de elegir. Solo aparece si el Python que respondió sabe cotizar a
 * granel. Nada se calcula aquí.
 */
export function ModoMateriales({ clave, modo, onModo, totalPaquetes, totalGranel, globos, atenuar }: Props) {
  const idTitulo = `modo-materiales-${clave}`;
  const total = (opcion: Modo) => (opcion === "paquete" ? totalPaquetes : totalGranel);
  const explicacion = !globos
    ? null
    : modo === "granel"
      ? `Cobras solo los ${numero.format(globos.plan)} globos del plan${globos.extra ? ` y ${numero.format(globos.extra)} extra` : ""}, sueltos: sin paquetes cerrados${globos.sobrante ? ` ni ${numero.format(globos.sobrante)} globos de sobra` : ""}.`
      : `Paquetes cerrados del catálogo${globos.sobrante ? `: te sobran ${numero.format(globos.sobrante)} globos` : ""}. A granel pagas solo los ${numero.format(globos.plan)} del plan.`;
  return (
    <div className="border-t border-borde-suave px-4 py-3.5 @xl:px-5.5" data-testid="modo-materiales">
      <p id={idTitulo} className="text-xs font-medium text-texto-suave">Cómo cotizas los globos</p>
      <div role="group" aria-labelledby={idTitulo} className="mt-2 grid grid-cols-2 gap-1 rounded-2xl bg-superficie-2 p-1 ring-1 ring-borde-suave ring-inset">
        {OPCIONES.map(({ modo: opcion, titulo, Icono }) => {
          const activo = opcion === modo;
          const valor = total(opcion);
          return (
            <button
              key={opcion}
              type="button"
              aria-pressed={activo}
              onClick={() => { if (!activo) onModo(opcion); }}
              className={`relative isolate min-h-14 rounded-xl px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento ${activo ? "text-texto" : "text-texto-suave hover:text-texto"}`}
            >
              {activo && (
                <motion.span
                  layoutId={`modo-materiales-activo-${clave}`}
                  transition={RESORTE}
                  aria-hidden="true"
                  className="absolute inset-0 -z-10 rounded-xl bg-superficie shadow-[0_1px_2px_var(--sombra),0_6px_16px_var(--sombra)] ring-1 ring-acento/35 ring-inset"
                />
              )}
              <span className="flex items-center gap-1.5 text-[13px] font-semibold leading-4">
                <Icono className={`size-3.5 shrink-0 ${activo ? "text-acento" : ""}`} aria-hidden="true" />
                {titulo}
              </span>
              <span className={`mt-1 block text-sm font-semibold tabular-nums ${activo ? "text-texto" : "text-texto-suave"} ${atenuar && valor !== null ? CLASE_NO_VIGENTE : ""}`}>
                {importeOGuion(valor)}
              </span>
            </button>
          );
        })}
      </div>
      {explicacion && <p className="mt-2 text-xs leading-5 text-texto-suave" aria-live="polite">{explicacion}</p>}
    </div>
  );
}
