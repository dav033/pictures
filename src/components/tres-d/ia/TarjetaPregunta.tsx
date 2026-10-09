"use client";

import type { PreguntaTurno } from "@/lib/globos3d/turnos-ia";

const OPCION = "inline-flex min-h-10 items-center rounded-full border border-taller-borde bg-taller-boton px-3 text-xs text-taller-texto hover:bg-taller-encima disabled:opacity-45";

/** Lo que la IA pregunta cuando dos o más piezas encajan: cada opción, al tocarla, se manda como el próximo pedido. */
export function TarjetaPregunta({ pregunta, ocupado, alResponder, alOtraCosa }: { pregunta: PreguntaTurno; ocupado: boolean; alResponder: (opcion: string) => void; alOtraCosa: () => void }) {
  return (
    <section aria-label="Pregunta de la IA" className="rounded-xl border border-dashed border-taller-resalte p-3 text-[12.5px] text-taller-texto">
      <p><b>La IA pregunta:</b> {pregunta.texto}</p>
      <div role="group" aria-label={pregunta.texto} className="mt-2 flex flex-wrap gap-1.5">
        {pregunta.opciones.map((o) => <button key={o} type="button" disabled={ocupado} onClick={() => alResponder(o)} className={OPCION}>{o}</button>)}
        <button type="button" disabled={ocupado} onClick={alOtraCosa} className={OPCION}>Otra cosa…</button>
      </div>
    </section>
  );
}
