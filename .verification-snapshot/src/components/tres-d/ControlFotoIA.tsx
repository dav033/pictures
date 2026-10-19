"use client";

import { useRef } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import type { FotoAdjuntaEstado } from "./useFotoAdjunta";

/** El botón de adjuntar foto (con su selector de archivo) de la barra «Pídele a la IA». */
export function BotonFotoIA({ estado, deshabilitado, clase }: { estado: FotoAdjuntaEstado; deshabilitado: boolean; clase: string }) {
  const entrada = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={entrada} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-hidden
        onChange={(e) => { const archivo = e.target.files?.[0]; e.target.value = ""; if (archivo) void estado.adjuntar(archivo); }} />
      <button type="button" disabled={deshabilitado || estado.preparando} onClick={() => entrada.current?.click()}
        aria-label="Adjuntar una foto de la decoración" title="Adjuntar una foto (también puedes pegarla o soltarla aquí)" className={clase}>
        {estado.preparando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ImagePlus className="size-4" aria-hidden />}
      </button>
    </>
  );
}

/** La foto adjunta como miniatura con su botón de quitar, y el error si no se pudo preparar. */
export function MiniaturaFotoIA({ estado, clase }: { estado: FotoAdjuntaEstado; clase: string }) {
  if (!estado.foto && !estado.error) return null;
  return (
    <div className={clase}>
      {estado.foto && (
        <span className="relative inline-flex shrink-0">
          {/* Vista previa local (blob:) de la foto que se enviará: next/image no aplica. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={estado.foto.vista} alt="Foto adjunta" className="size-9 rounded-md object-cover" />
          <button type="button" onClick={estado.quitar} aria-label="Quitar la foto" className="absolute -right-1.5 -top-1.5 grid size-4 place-items-center rounded-full bg-taller-barra text-taller-texto ring-1 ring-taller-borde">
            <X className="size-3" aria-hidden />
          </button>
        </span>
      )}
      {estado.error && <span role="alert" className="text-[0.75rem] text-taller-texto-2">{estado.error}</span>}
    </div>
  );
}
