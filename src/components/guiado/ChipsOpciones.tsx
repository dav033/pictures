import { Calculator, GraduationCap, ShoppingBag, UserRound } from "lucide-react";

export const OPCIONES_GUIADAS = [
  { id: "costear", titulo: "Costear materiales", detalle: "Cuánto cuestan los globos", Icono: Calculator },
  { id: "comprar", titulo: "Comprar", detalle: "En línea o en un distribuidor", Icono: ShoppingBag },
  { id: "aprender", titulo: "Aprender a hacerla", detalle: "Paso a paso", Icono: GraduationCap },
  { id: "contratar", titulo: "Contratar un decorador", detalle: "Expertos cerca de ti", Icono: UserRound },
] as const;

export type OpcionGuiada = (typeof OPCIONES_GUIADAS)[number]["id"];

export function ChipsOpciones({ onElegir, deshabilitado }: { onElegir: (opcion: OpcionGuiada) => void; deshabilitado?: boolean }) {
  return <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Qué quieres hacer">
    {OPCIONES_GUIADAS.map(({ id, titulo, detalle, Icono }) => <button key={id} type="button" disabled={deshabilitado} onClick={() => onElegir(id)} className="group flex flex-col items-start gap-2 rounded-2xl border border-borde-suave bg-superficie p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-acento disabled:pointer-events-none disabled:opacity-50">
      <span className="grid size-9 place-items-center rounded-xl bg-acento-suave text-acento"><Icono className="size-5" aria-hidden /></span>
      <span className="text-sm font-semibold leading-tight">{titulo}</span>
      <span className="text-xs text-texto-secundario">{detalle}</span>
    </button>)}
  </div>;
}
