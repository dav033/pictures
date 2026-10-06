import type { DecoracionSempertex } from "@/lib/biblioteca-sempertex/esquemas";

export function PasoAPaso({ decoracion, alTerminar }: { decoracion: DecoracionSempertex; alTerminar: () => void }) {
  return <section className="mt-4 rounded-2xl bg-superficie p-4" aria-label="Guía paso a paso">
    <h3 className="font-semibold">Aprende a hacerla</h3>
    <ol className="mt-3 list-decimal space-y-3 pl-5 text-sm leading-6">{decoracion.pasos.map((paso) => <li key={paso.orden}>{paso.texto}</li>)}</ol>
    <p className="mt-3 text-xs text-texto-secundario">Guía ilustrativa de ejemplo. Confirma materiales y seguridad de montaje antes de construir.</p>
    <button type="button" onClick={alTerminar} className="mt-4 rounded-xl border border-borde-suave px-4 py-2.5 text-sm font-semibold">Ver otras opciones</button>
  </section>;
}
