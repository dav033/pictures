import { BriefcaseBusiness, House } from "lucide-react";

const OPCIONES = [
  { uso: "negocio", titulo: "Para mi negocio", detalle: "Precio editable con tus gastos y tu ganancia", Icono: BriefcaseBusiness },
  { uso: "personal", titulo: "Para uso personal", detalle: "Solo el costo de los materiales", Icono: House },
] as const;

export function PreguntaUso({ onElegir, deshabilitado }: { onElegir: (uso: "negocio" | "personal") => void; deshabilitado?: boolean }) {
  return <div className="mt-4 grid gap-3 sm:grid-cols-2" role="group" aria-label="Para qué es la decoración">
    {OPCIONES.map(({ uso, titulo, detalle, Icono }) => <button key={uso} type="button" disabled={deshabilitado} onClick={() => onElegir(uso)} className="flex items-center gap-3 rounded-2xl border border-borde-suave bg-superficie p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-acento disabled:pointer-events-none disabled:opacity-50">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-acento-suave text-acento"><Icono className="size-5" aria-hidden /></span>
      <span><span className="block font-semibold">{titulo}</span><span className="block text-sm text-texto-secundario">{detalle}</span></span>
    </button>)}
  </div>;
}
