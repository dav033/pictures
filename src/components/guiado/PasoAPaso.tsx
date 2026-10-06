import type { DecoracionSempertex } from "@/lib/biblioteca-sempertex/esquemas";

export function PasoAPaso({ decoracion, alTerminar }: { decoracion: DecoracionSempertex; alTerminar?: () => void }) {
  return <section className="mt-4 rounded-2xl border border-borde-suave bg-superficie p-5 shadow-sm" aria-label="Guía paso a paso">
    <h3 className="font-semibold">Cómo armar «{decoracion.titulo}»</h3>
    <ol className="mt-4 space-y-4">
      {decoracion.pasos.map((paso) => <li key={paso.orden} className="flex gap-3 text-sm leading-6">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-acento text-xs font-bold text-white">{paso.orden}</span>
        <span className="pt-0.5">{paso.texto}</span>
      </li>)}
    </ol>
    {decoracion.origen === "ejemplo" && <p className="mt-4 text-xs text-texto-secundario">Guía de ejemplo. Revisa los materiales y la seguridad del montaje antes de armarla.</p>}
    {alTerminar && <button type="button" onClick={alTerminar} className="mt-4 rounded-xl border border-borde-suave px-4 py-2.5 text-sm font-semibold transition-colors hover:border-acento">Ver otras opciones</button>}
  </section>;
}
