"use client";

import { useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { Camera, X } from "lucide-react";
import type { EstadoFoto } from "./useBusquedaFoto";

/**
 * «Buscar por foto» en el panel Añadir: botón para elegir una foto (en el teléfono abre la cámara o la galería), aviso
 * de lo que pasa (buscando, parecidos, o el mensaje del servidor si la biblioteca no está indexada) y la foto
 * en miniatura con su «quitar». `useSoltarFoto` agrega arrastrar-y-soltar y pegar una imagen en todo el panel.
 */

const ACEPTA = "image/jpeg,image/png,image/webp";

/** Arrastrar una imagen sobre el panel o pegarla (Ctrl+V): llama a `onFoto` con el archivo. No toca el texto que se pega en un campo. */
export function useSoltarFoto(onFoto: (f: File) => void) {
  const [arrastrando, setArrastrando] = useState(false);
  const llevaImagen = (e: DragEvent) => [...e.dataTransfer.items].some((i) => i.kind === "file" && i.type.startsWith("image/"));
  return {
    arrastrando,
    propiedades: {
      onDragOver: (e: DragEvent) => { if (llevaImagen(e)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setArrastrando(true); } },
      onDragLeave: (e: DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setArrastrando(false); },
      onDrop: (e: DragEvent) => {
        setArrastrando(false);
        const foto = [...e.dataTransfer.files].find((f) => f.type.startsWith("image/"));
        if (!foto) return;
        e.preventDefault();
        onFoto(foto);
      },
      onPaste: (e: ClipboardEvent) => {
        const foto = [...e.clipboardData.files].find((f) => f.type.startsWith("image/"));
        if (!foto) return;
        e.preventDefault();
        onFoto(foto);
      },
    },
  };
}

export function BuscarPorFoto({ estado, cuantos, onFoto, onQuitar }: {
  estado: EstadoFoto; cuantos: number; onFoto: (f: File) => void; onQuitar: () => void;
}) {
  const entrada = useRef<HTMLInputElement>(null);
  const previa = estado.fase === "inactivo" ? null : estado.previa;
  const ocupado = estado.fase === "buscando";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <input ref={entrada} type="file" accept={ACEPTA} className="sr-only" tabIndex={-1} aria-label="Elegir una foto para buscar parecidos"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onFoto(f); }} />
        <button type="button" disabled={ocupado} onClick={() => entrada.current?.click()}
          className="inline-flex h-[30px] items-center gap-1.5 rounded-lg border border-taller-borde bg-taller-panel px-2.5 text-xs font-medium text-taller-medio hover:text-taller-texto disabled:cursor-wait disabled:opacity-60">
          <Camera className="size-3.5" aria-hidden />Buscar por foto
        </button>
        <span className="min-w-0 truncate text-[11px] text-taller-suave">{estado.fase === "inactivo" ? "o arrastra / pega una imagen aquí" : ""}</span>
      </div>
      {estado.fase !== "inactivo" && (
        <div className="flex items-center gap-2 rounded-xl border border-taller-borde bg-taller-tarjeta p-1.5" role={estado.fase === "error" ? "alert" : "status"}>
          {previa && (
            // eslint-disable-next-line @next/next/no-img-element -- vista previa local (blob:) de la foto elegida
            <img src={previa} alt="Tu foto" className="size-9 shrink-0 rounded-lg bg-taller-encima object-cover" />
          )}
          <p className="min-w-0 flex-1 text-xs leading-snug text-taller-texto-2">
            {estado.fase === "buscando" && "Buscando parecidos a tu foto…"}
            {estado.fase === "listo" && (estado.cargando ? "Buscando en esta pestaña…" : cuantos > 0 ? `Parecidos a tu foto: ${cuantos} en esta pestaña, del más al menos parecido.` : "Nada parecido a tu foto en esta pestaña; prueba otra pestaña o quita filtros.")}
            {estado.fase === "error" && estado.mensaje}
          </p>
          <button type="button" onClick={onQuitar} aria-label="Quitar la búsqueda por foto" className="grid size-7 shrink-0 place-items-center rounded-md text-taller-suave hover:text-taller-texto"><X className="size-3.5" aria-hidden /></button>
        </div>
      )}
    </div>
  );
}
