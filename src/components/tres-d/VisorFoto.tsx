"use client";

import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, Download, X } from "lucide-react";

export type FotoVisor = { id: number; imagen: string; titulo: string };

/**
 * Una foto en grande, a toda la pantalla (`<dialog>` modal: queda encima del diálogo de «Imagen con IA»). Esc o
 * un clic fuera de la foto la cierran; las flechas (en pantalla y del teclado) pasan a la anterior o la siguiente.
 */
export function VisorFoto({ fotos, indice, onCambiar, onCerrar }: { fotos: readonly FotoVisor[]; indice: number; onCambiar: (indice: number) => void; onCerrar: () => void }) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const foto = fotos[indice];
  const hayAnterior = indice > 0, haySiguiente = indice < fotos.length - 1;

  useEffect(() => {
    const d = dialogo.current;
    if (d && !d.open) d.showModal();
  }, []);

  if (!foto) return null;
  return (
    // React propaga «cancel» y «close» por su árbol: sin cortarlos, Esc aquí cerraba también el diálogo de detrás.
    <dialog ref={dialogo} aria-label={foto.titulo}
      onCancel={(e) => e.stopPropagation()}
      onClose={(e) => { e.stopPropagation(); onCerrar(); }}
      onClick={(e) => { if (e.target === e.currentTarget) onCerrar(); }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" && hayAnterior) { e.preventDefault(); onCambiar(indice - 1); }
        if (e.key === "ArrowRight" && haySiguiente) { e.preventDefault(); onCambiar(indice + 1); }
      }}
      className="m-0 h-dvh max-h-none w-dvw max-w-none bg-transparent p-0 backdrop:bg-black/85">
      <div className="flex h-full w-full flex-col" onClick={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
        <div className="flex shrink-0 items-center gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-sm text-white">
          <span className="min-w-0 flex-1 truncate">{foto.titulo}{fotos.length > 1 ? ` · ${indice + 1} de ${fotos.length}` : ""}</span>
          <a href={foto.imagen} download={`globos-3d-${foto.id}.jpg`} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white/10 px-3 hover:bg-white/20">
            <Download className="size-4" aria-hidden />Descargar
          </a>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" autoFocus className="grid size-11 place-items-center rounded-xl bg-white/10 hover:bg-white/20">
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <div className="relative flex min-h-0 flex-1 items-center justify-center p-3" onClick={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- imagen generada en data URL, no pasa por next/image */}
          <img src={foto.imagen} alt={foto.titulo} className="max-h-full max-w-full rounded-lg object-contain shadow-2xl" />
          {hayAnterior && (
            <button type="button" onClick={() => onCambiar(indice - 1)} aria-label="Foto anterior" className="absolute left-3 top-1/2 grid size-12 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white hover:bg-black/70">
              <ChevronLeft className="size-6" aria-hidden />
            </button>
          )}
          {haySiguiente && (
            <button type="button" onClick={() => onCambiar(indice + 1)} aria-label="Foto siguiente" className="absolute right-3 top-1/2 grid size-12 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white hover:bg-black/70">
              <ChevronRight className="size-6" aria-hidden />
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
