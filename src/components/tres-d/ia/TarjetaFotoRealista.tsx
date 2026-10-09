"use client";

import { Camera } from "lucide-react";
import { resumenFotoRealista } from "@/lib/globos3d/foto-realista";

/** La foto realista (FLUX) de lo que se ve: abre el diálogo de siempre; dice lo que el código sabe de su tiempo, coste y tope. Va debajo del pedido y sin competir con «Enviar». */
export function TarjetaFotoRealista({ alAbrir }: { alAbrir: () => void }) {
  return (
    <section aria-label="Foto realista" className="flex items-center gap-2.5 px-3 py-2 text-xs text-taller-texto">
      <Camera className="size-5 shrink-0 text-taller-suave" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium">Foto realista de lo que ves</p>
        <p className="text-[11px] text-taller-suave">{resumenFotoRealista()}</p>
      </div>
      <button type="button" onClick={alAbrir}
        className="inline-flex min-h-9 shrink-0 items-center rounded-lg border border-taller-borde bg-taller-boton px-3 text-xs font-medium text-taller-texto hover:bg-taller-encima">
        Generar
      </button>
    </section>
  );
}
