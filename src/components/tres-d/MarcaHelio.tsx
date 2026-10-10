"use client";

import { useId } from "react";
import { muestraMarcaHelio, puedeFlotar } from "@/lib/globos3d/helio-cinta";
import type { Pieza } from "@/lib/globos3d/piezas";

/**
 * «Flota con helio» de una pieza: la marca (o desmarca) para que la lista de compra cuente sus litros de helio y su cinta,
 * y no su tiempo de bomba. Una pieza de una escena guardada antes de que existiera la marca no la trae: se marca aquí. En el
 * globo dentro de globo cuenta solo el de fuera. Sale también en una pieza ya marcada que dejó de poder flotar (cambió de tipo
 * o de tamaño), para poder desmarcarla.
 */
export function MarcaHelio({ pieza, onPieza }: { pieza: Pieza; onPieza: (siguiente: Pieza) => void }) {
  const id = useId();
  if (!muestraMarcaHelio(pieza)) return null;
  return (
    <section className="flex flex-col gap-2.5" aria-label="Helio">
      <h3 className="taller-rotulo">Helio</h3>
      <label className="flex min-h-8 items-center gap-2 text-sm" htmlFor={id}>
        <input id={id} type="checkbox" checked={pieza.helio === true} onChange={(e) => onPieza({ ...pieza, helio: e.target.checked ? true : undefined })} />
        Flota con helio
      </label>
      <p className="text-xs text-taller-suave">Si flota, la lista de compra cuenta sus litros de helio y su cinta; si no, se infla con la bomba.</p>
      {!puedeFlotar(pieza) && <p className="text-xs text-taller-suave" role="note">Esta pieza ya no parece poder flotar entera (por su tipo o su tamaño): si no flota, desmárcala.</p>}
    </section>
  );
}
