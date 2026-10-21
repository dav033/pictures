"use client";

import { Camera, Images, Mic, Send, X } from "lucide-react";
import { useRef, useState } from "react";
import Image from "next/image";
import type { AdvisorComposerCard } from "./conversation-contract";
import type { PhotoKind } from "@/lib/asesor/repository";
import { prepararFotoReferencia } from "@/lib/imagen-cliente/preparar-foto";

export type ComposerCapabilities = { photo: boolean; voice: boolean };
type Props = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (content: string, files?: File[], kind?: PhotoKind) => void;
  busy: boolean;
  cards?: readonly AdvisorComposerCard[];
  capabilities?: ComposerCapabilities;
  onVoice?: () => void;
  onRetry?: () => void;
  error?: string | null;
};

export function Composer({ value, onChange, onSubmit, busy, cards = [], capabilities = { photo: false, voice: false }, onVoice, onRetry, error }: Props) {
  const [photos, setPhotos] = useState<Array<{ file: File; preview: string }>>([]);
  const [photoKind, setPhotoKind] = useState<PhotoKind>("inspiration");
  const [photoError, setPhotoError] = useState<string | null>(null);
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const canPhoto = capabilities.photo;
  const canVoice = capabilities.voice && onVoice !== undefined;
  const addPhotos = async (incoming: File[]) => {
    if (photos.length + incoming.length > 4) { setPhotoError("Puedes compartir hasta 4 fotos por mensaje."); return; }
    try {
      const prepared: Array<{ file: File; preview: string }> = [];
      for (const file of incoming) {
        if (file.size > 6 * 1024 * 1024) throw new Error(`La foto “${file.name}” supera el máximo permitido de 6 MB.`);
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error(`La foto “${file.name}” debe ser JPEG, PNG o WebP.`);
        const derivative = await prepararFotoReferencia(file);
        prepared.push({ file, preview: `data:${derivative.mime};base64,${derivative.base64}` });
      }
      setPhotos((current) => [...current, ...prepared]);
      setPhotoError(null);
    } catch (cause) {
      setPhotoError(cause instanceof Error ? cause.message : "No se pudo leer la foto. Prueba con otra imagen.");
    }
  };
  return (
    <div className="mx-auto w-full max-w-3xl">
      {cards.length > 0 && (
        <section aria-label="Opciones para continuar" className="mb-3 grid gap-2 sm:grid-cols-2">
          {cards.map((card) => (
            <button key={`${card.kind}:${card.id}`} type="button" disabled={busy} onClick={() => onSubmit(card.content)} className="rounded-2xl border border-borde bg-superficie p-3 text-left shadow-sm transition hover:border-acento focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento disabled:opacity-50">
              <span className="text-xs font-semibold uppercase tracking-wide text-acento">{card.kind === "direction" ? "Dirección" : "Paquete"}</span>
              <span className="mt-1 block font-medium text-texto">{card.title}</span>
              <span className="mt-1 block text-sm text-texto-suave">{card.description}</span>
            </button>
          ))}
        </section>
      )}
      {error && (
        <div role="alert" className="mb-2 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-error/30 bg-error-suave px-4 py-3 text-sm text-texto">
          <span>{error}</span>
          {onRetry && <button type="button" onClick={onRetry} disabled={busy} className="rounded-lg px-3 py-2 font-semibold text-acento underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento disabled:opacity-50">Reintentar</button>}
        </div>
      )}
      {photos.length > 0 && <div className="mb-2 flex flex-wrap items-center gap-2 px-2">{photos.map((photo, index) => <span key={`${photo.file.name}:${index}`} className="flex items-center gap-2 rounded-xl bg-superficie-2 p-1.5 text-xs"><Image src={photo.preview} alt={`Vista previa: ${photo.file.name}`} width={40} height={40} unoptimized className="size-10 rounded-lg object-cover" /><span className="max-w-32 truncate">{photo.file.name}</span><button type="button" aria-label={`Quitar ${photo.file.name}`} onClick={() => setPhotos((current) => current.filter((_, i) => i !== index))}><X aria-hidden="true" className="size-3.5" /></button></span>)}<label className="ml-auto flex items-center gap-2 text-xs text-texto-suave">Tipo de foto<select aria-label="Tipo de foto" value={photoKind} onChange={(event) => setPhotoKind(event.target.value as PhotoKind)} className="rounded-lg border border-borde bg-superficie px-2 py-1"><option value="inspiration">Inspiración</option><option value="venue">Lugar</option></select></label></div>}
      {photoError && <p role="alert" className="px-3 pb-2 text-sm text-error">{photoError}</p>}
      <form onSubmit={(event) => { event.preventDefault(); if (!value.trim() && photos.length === 0) return; onSubmit(value, photos.map(({ file }) => file), photoKind); onChange(""); setPhotos([]); setPhotoError(null); }} className="rounded-3xl border border-borde bg-superficie p-2 shadow-[0_8px_30px_var(--sombra)] focus-within:border-acento">
        <label htmlFor="advisor-message" className="sr-only">Tu mensaje</label>
        <input ref={camera} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" multiple className="sr-only" aria-label="Tomar una foto" onChange={(event) => { void addPhotos(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
        <input ref={gallery} type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" aria-label="Elegir fotos de la galería" onChange={(event) => { void addPhotos(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
        <textarea id="advisor-message" name="message" rows={2} value={value} onChange={(event) => onChange(event.target.value)} disabled={busy} placeholder="Cuéntame qué celebración estás planeando…" className="max-h-40 min-h-14 w-full resize-y bg-transparent px-3 py-2 text-base text-texto outline-none placeholder:text-texto-tenue disabled:opacity-60" />
        <div className="flex items-center justify-between gap-2 px-1 pb-1">
          <div className="flex items-center gap-1">
            <button type="button" aria-label="Tomar una foto" title="Tomar una foto" disabled={!canPhoto || busy} onClick={() => camera.current?.click()} className="flex size-11 items-center justify-center rounded-full text-texto-suave transition hover:bg-superficie-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento disabled:opacity-40"><Camera aria-hidden="true" className="size-5" /></button>
            <button type="button" aria-label="Elegir fotos de la galería" title="Elegir fotos de la galería" disabled={!canPhoto || busy} onClick={() => gallery.current?.click()} className="flex size-11 items-center justify-center rounded-full text-texto-suave transition hover:bg-superficie-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento disabled:opacity-40"><Images aria-hidden="true" className="size-5" /></button>
            <button type="button" aria-label={canVoice ? "Dictar mensaje" : "Dictado no disponible todavía"} title={canVoice ? "Dictar mensaje" : "Dictado no disponible todavía"} disabled={!canVoice || busy} onClick={onVoice} className="flex size-11 items-center justify-center rounded-full text-texto-suave transition hover:bg-superficie-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento disabled:opacity-40"><Mic aria-hidden="true" className="size-5" /></button>
          </div>
          <button type="submit" disabled={busy || (!value.trim() && photos.length === 0)} className="flex min-h-11 items-center gap-2 rounded-full bg-acento px-5 font-semibold text-sobre-acento transition hover:bg-acento-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45">
            <span>{busy ? "Enviando" : "Enviar"}</span><Send aria-hidden="true" className="size-4" />
          </button>
        </div>
      </form>
      <p className="px-3 pt-2 text-center text-xs text-texto-tenue">Puedes escribir con el teclado o elegir una opción sugerida.</p>
    </div>
  );
}
