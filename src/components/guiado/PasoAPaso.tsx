import type { DecoracionSempertex } from "@/lib/biblioteca-sempertex/esquemas";
import { guiaParaEstructura } from "@/lib/ia/guiado/guias-armado";

export function PasoAPaso({ decoracion, alTerminar }: { decoracion: DecoracionSempertex; alTerminar?: () => void }) {
  return <section className="mt-4 rounded-2xl border border-borde-suave bg-superficie p-5 shadow-sm" aria-label="Guía paso a paso">
    <h3 className="font-semibold">Cómo armar «{decoracion.titulo}»</h3>
    <ol className="mt-4 space-y-4">
      {decoracion.pasos.map((paso) => <li key={paso.orden} className="flex gap-3 text-sm leading-6">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-acento text-xs font-bold text-white">{paso.orden}</span>
        <span className="pt-0.5">{paso.texto}</span>
      </li>)}
    </ol>
    {decoracion.piezas.length > 0 && <div className="mt-5 space-y-3"><h4 className="font-semibold">Guía aproximada por estructura</h4>{decoracion.piezas.map((pieza, indice) => {
      const guia = guiaParaEstructura(pieza.estructura);
      if (!guia) return null;
      return <article key={`${pieza.estructura}-${indice}`} className="rounded-xl border border-borde-suave p-3"><h5 className="font-medium">{pieza.cantidad > 1 ? `${pieza.cantidad} ` : ""}{guia.nombre}</h5><p className="mt-1 text-xs text-texto-secundario">{guia.dificultad} · {guia.tiempo_aprox}</p><p className="mt-3 text-sm font-medium">Herramientas y materiales</p><ul className="ml-5 mt-1 list-disc space-y-1 text-sm">{[...guia.herramientas, ...guia.materiales_base].map((item, i) => <li key={i}>{item}</li>)}</ul><ol className="mt-3 space-y-2">{guia.pasos.map((paso, i) => <li key={i} className="text-sm"><strong>{i + 1}. {paso.titulo}.</strong> {paso.detalle}</li>)}</ol><details className="mt-3 text-sm"><summary className="cursor-pointer font-medium">Reglas, consejos y fuentes</summary><ul className="ml-5 mt-2 list-disc space-y-1">{[...guia.reglas_aproximadas, ...guia.consejos].map((item, i) => <li key={i}>{item}</li>)}</ul><ul className="ml-5 mt-2 list-disc">{guia.fuentes.map((fuente) => <li key={fuente.url}><a className="text-acento underline" href={fuente.url} target="_blank" rel="noreferrer">{fuente.titulo}</a></li>)}</ul></details></article>;
    })}</div>}
    {decoracion.origen === "ejemplo" && <p className="mt-4 text-xs text-texto-secundario">Guía de ejemplo. Revisa los materiales y la seguridad del montaje antes de armarla.</p>}
    {alTerminar && <button type="button" onClick={alTerminar} className="mt-4 rounded-xl border border-borde-suave px-4 py-2.5 text-sm font-semibold transition-colors hover:border-acento">Ver otras opciones</button>}
  </section>;
}
