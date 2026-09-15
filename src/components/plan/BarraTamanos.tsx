"use client";

import { motion, useReducedMotion } from "motion/react";
import { contar } from "@/lib/plan/presentacion-cliente";

export type TramoTamano = { pulgadas: number; unidades: number };

type Props = {
  tramos: TramoTamano[];
  /** "resumen": first label "Globos de 5 pulgadas"; "detalle": "5 pulgadas · 26". */
  variante?: "resumen" | "detalle";
  /** Accessible sentence for the bar ("Globos de 5, 9 y 12 pulgadas"). */
  descripcion?: string | null;
  retraso?: number;
  className?: string;
};

/** Groups size lines (`mezcla_real`, `globos_por_tamano`) by inches, smallest first. */
export function tramosPorTamano(lineas: ReadonlyArray<{ pulgadas: number | null; unidades: number }>): TramoTamano[] {
  const porTamano = new Map<number, number>();
  for (const linea of lineas) {
    if (linea.pulgadas == null || linea.unidades <= 0) continue;
    porTamano.set(linea.pulgadas, (porTamano.get(linea.pulgadas) ?? 0) + linea.unidades);
  }
  return [...porTamano.entries()].sort((a, b) => a[0] - b[0]).map(([pulgadas, unidades]) => ({ pulgadas, unidades }));
}

/**
 * Proportional bar of balloon sizes that grows from the left. Each segment's
 * shade deepens with the size; the labels under it carry the information.
 */
export function BarraTamanos({ tramos, variante = "resumen", descripcion, retraso = 0, className = "" }: Props) {
  const reducir = useReducedMotion();
  const total = tramos.reduce((suma, tramo) => suma + tramo.unidades, 0);
  if (total <= 0 || tramos.length === 0) return null;
  const maximo = tramos[tramos.length - 1]!.pulgadas;
  return (
    <div className={className}>
      {descripcion && <p className="sr-only">{descripcion}</p>}
      <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-superficie-2">
        <motion.div
          className="flex h-full w-full origin-left gap-0.5"
          initial={reducir ? false : { scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.9, delay: retraso, ease: [0.23, 1, 0.32, 1] }}
        >
          {tramos.map((tramo) => (
            <span
              key={tramo.pulgadas}
              className="h-full rounded-[1px] bg-acento"
              style={{ width: `${(tramo.unidades / total) * 100}%`, opacity: tramos.length === 1 ? 1 : 0.28 + 0.72 * (tramo.pulgadas / maximo) }}
            />
          ))}
        </motion.div>
      </div>
      {variante === "resumen" ? (
        <>
          <div aria-hidden="true" className="mt-1.5 hidden justify-between gap-x-3 text-xs text-texto-suave @lg:flex">
            {tramos.map((tramo, indice) => (
              <span key={tramo.pulgadas} className="whitespace-nowrap">{indice === 0 ? `Globos de ${tramo.pulgadas} pulgadas` : `${tramo.pulgadas} pulgadas`}</span>
            ))}
          </div>
          {/* Narrow cards: one sentence instead of labels that would wrap under the bar. */}
          <p aria-hidden="true" className="mt-1.5 text-xs text-texto-suave @lg:hidden">
            Globos de {tramos.length === 1 ? tramos[0]!.pulgadas : `${tramos.slice(0, -1).map((tramo) => tramo.pulgadas).join(", ")} y ${tramos.at(-1)!.pulgadas}`} pulgadas
          </p>
        </>
      ) : (
        <ul aria-hidden="true" className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-texto-suave">
          {tramos.map((tramo) => (
            <li key={tramo.pulgadas} className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-acento" style={{ opacity: tramos.length === 1 ? 1 : 0.28 + 0.72 * (tramo.pulgadas / maximo) }} />
              {tramo.pulgadas} pulgadas · <span className="font-medium tabular-nums text-texto">{tramo.unidades}</span>
            </li>
          ))}
        </ul>
      )}
      {variante === "detalle" && <p className="sr-only">{tramos.map((tramo) => `${contar(tramo.unidades, "globo", "globos")} de ${tramo.pulgadas} pulgadas`).join(", ")}</p>}
    </div>
  );
}
