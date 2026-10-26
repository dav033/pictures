import { Check, Eye, Pin } from "lucide-react";
import { readingLines } from "@/lib/asesor/photo-evidence";
import type { AdvisorPhoto } from "./conversation-contract";

/** What the advisor read in a photo (to confirm) and what the customer wants to keep from it, under the picture. */
export function PhotoNotes({ photo }: { photo: AdvisorPhoto }) {
  const keep = photo.keep ?? [];
  if (!photo.reading && keep.length === 0) return null;
  const status = photo.confirmed === null ? "Por confirmar" : photo.confirmed ? "Confirmado" : "Corregida";
  return (
    <div className="asesor-sube mt-2 flex flex-col gap-2 rounded-xl bg-superficie-suave p-2.5 text-[13px] leading-snug">
      {photo.reading && <div className="flex flex-col gap-1">
        <span className="flex items-center justify-between gap-2 text-xs font-semibold text-texto-suave">
          <span className="flex items-center gap-1"><Eye aria-hidden="true" className="size-3.5" />Lo que veo</span>
          <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 ${photo.confirmed ? "bg-exito-suave text-exito" : "bg-aviso-suave text-texto"}`}>{photo.confirmed && <Check aria-hidden="true" className="size-3" />}{status}</span>
        </span>
        {readingLines(photo.reading).map((line) => <span key={line.label}><span className="font-semibold">{line.label}:</span> {line.value}</span>)}
      </div>}
      {keep.length > 0 && <div className="flex flex-col gap-1">
        <span className="flex items-center gap-1 text-xs font-semibold text-texto-suave"><Pin aria-hidden="true" className="size-3.5" />Quieres conservar</span>
        <ul className="flex flex-wrap gap-1.5">{keep.map((item) => <li key={item} className="rounded-full bg-superficie px-2.5 py-1 text-xs">{item}</li>)}</ul>
      </div>}
    </div>
  );
}
