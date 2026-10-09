"use client";

import { Eye } from "lucide-react";
import { FLOTANTE } from "../ui-taller";

/** Aviso sobre el visor mientras se ve la escena de antes de un turno de la IA (no se edita hasta volver). */
export function BannerVerAntes({ numero, alVolver }: { numero: number; alVolver: () => void }) {
  return (
    <div role="status" className={`absolute left-1/2 top-16 z-30 flex w-[min(30rem,calc(100%-24px))] -translate-x-1/2 items-center gap-2 rounded-xl px-3 py-2 text-sm ${FLOTANTE}`}>
      <Eye className="size-4 shrink-0 text-taller-acento" aria-hidden />
      <span className="min-w-0 flex-1">Ves la escena antes del turno {numero}. No se puede editar mientras tanto.</span>
      <button type="button" onClick={alVolver} className="min-h-9 rounded-lg px-2 font-medium text-taller-acento hover:bg-taller-encima">Volver</button>
    </div>
  );
}
