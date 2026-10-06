export const OPCIONES_GUIADAS = [
  { id: "contratar", titulo: "Contratar un decorador" },
  { id: "costear", titulo: "Costear materiales" },
  { id: "comprar", titulo: "Comprar" },
  { id: "aprender", titulo: "Aprender a hacerla" },
] as const;

export type OpcionGuiada = (typeof OPCIONES_GUIADAS)[number]["id"];

export function ChipsOpciones({ onElegir }: { onElegir: (opcion: OpcionGuiada) => void }) {
  return <div className="mt-3 flex flex-wrap gap-2" aria-label="Qué quieres hacer">
    {OPCIONES_GUIADAS.map((opcion) => <button key={opcion.id} type="button" onClick={() => onElegir(opcion.id)} className="rounded-full border border-borde-suave bg-superficie px-4 py-2.5 text-sm font-medium transition-colors hover:border-acento hover:text-acento">{opcion.titulo}</button>)}
  </div>;
}
