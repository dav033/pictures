export function PreguntaUso({ onElegir }: { onElegir: (uso: "negocio" | "personal") => void }) {
  return <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Uso de la decoración">
    <button type="button" className="rounded-xl bg-acento px-4 py-3 text-sm font-semibold text-white" onClick={() => onElegir("negocio")}>Para mi negocio</button>
    <button type="button" className="rounded-xl border border-borde-suave px-4 py-3 text-sm font-semibold" onClick={() => onElegir("personal")}>Para uso personal</button>
  </div>;
}
