"use client";

import { Camera, ImagePlus, Send } from "lucide-react";
import { useRef, useState } from "react";
import type { AdvisorComposerCard } from "./conversation-contract";
import { BotonVoz } from "@/components/voz/BotonVoz";

export type ComposerCapabilities = { photo: boolean; voice: boolean };
type Props = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (content: string, photos?: File[]) => void;
  busy: boolean;
  cards?: readonly AdvisorComposerCard[];
  capabilities?: ComposerCapabilities;
  photoKind?: "inspiration" | "venue";
  onPhotoKindChange?: (kind: "inspiration" | "venue") => void;
  onVoiceText?: (text: string) => void;
  onRetry?: () => void;
  error?: string | null;
};

export function Composer({ value, onChange, onSubmit, busy, cards = [], capabilities = { photo: false, voice: false }, photoKind = "inspiration", onPhotoKindChange, onVoiceText, onRetry, error }: Props) {
  const [photos, setPhotos] = useState<File[]>([]);
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const canPhoto = capabilities.photo;
  const canVoice = capabilities.voice && onVoiceText !== undefined;
  return (
    <div className="mx-auto w-full max-w-3xl">
      {cards.length > 0 && (
        <section aria-label="Opciones para continuar" className="mb-3 grid gap-2 sm:grid-cols-2">
          {cards.map((card) => (
            <button key={`${card.kind}:${card.id}`} type="button" disabled={busy} onClick={() => onSubmit(card.content)} className="rounded-2xl border border-borde bg-superficie p-3 text-left shadow-sm transition hover:border-acento focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento disabled:opacity-50">
              <span className="text-xs font-semibold uppercase tracking-wide text-acento">{card.kind === "direction" ? "Dirección" : "Paquete"}</span>
              <span className="mt-1 block font-medium text-texto">{card.title}</span>
              <span className="mt-1 block text-sm text-texto-suave">{card.description}</span>
            {card.imageUrl && <img src={card.imageUrl} alt={`Referencia visual: ${card.title}`} loading="lazy" className="mt-2 h-32 w-full rounded-xl object-cover" />}
            {card.source && <span className="mt-2 block text-xs text-texto-tenue">Fuente: {card.source}</span>}
            {card.price && <span className="mt-1 block text-sm font-semibold text-texto">{card.price}</span>}
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
      {photos.length > 0 && <p className="mb-2 px-3 text-sm text-texto-suave" aria-live="polite">{photos.length} {photos.length === 1 ? "foto lista" : "fotos listas"} · {photoKind === "venue" ? "Lugar del evento" : "Inspiración"}</p>}
      <form onSubmit={(event) => { event.preventDefault(); onSubmit(value, photos); setPhotos([]); onChange(""); }} className="rounded-3xl border border-borde bg-superficie p-2 shadow-[0_8px_30px_var(--sombra)] focus-within:border-acento">
        <label htmlFor="advisor-message" className="sr-only">Tu mensaje</label>
        <textarea id="advisor-message" name="message" rows={2} value={value} onChange={(event) => onChange(event.target.value)} disabled={busy} placeholder="Cuéntame qué celebración estás planeando…" className="max-h-40 min-h-14 w-full resize-y bg-transparent px-3 py-2 text-base text-texto outline-none placeholder:text-texto-tenue disabled:opacity-60" />
        <div className="flex items-center justify-between gap-2 px-1 pb-1">
          <div className="flex items-center gap-1">
            <label className="sr-only" htmlFor="advisor-photo-kind">Tipo de foto</label>
            <select id="advisor-photo-kind" aria-label="Tipo de foto" value={photoKind} onChange={(event) => onPhotoKindChange?.(event.target.value === "venue" ? "venue" : "inspiration")} disabled={busy || !canPhoto} className="max-w-32 rounded-xl border border-borde bg-superficie px-2 py-2 text-xs text-texto">
              <option value="inspiration">Inspiración</option><option value="venue">Lugar</option>
            </select>
            <button type="button" aria-label={canPhoto ? "Tomar foto" : "Fotos no disponibles todavía"} title="Tomar foto" disabled={!canPhoto || busy} onClick={() => cameraInput.current?.click()} className="flex size-11 items-center justify-center rounded-full text-texto-suave transition hover:bg-superficie-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento disabled:opacity-40"><Camera aria-hidden="true" className="size-5" /></button>
            <button type="button" aria-label="Elegir foto de la galería" title="Elegir foto de la galería" disabled={!canPhoto || busy} onClick={() => galleryInput.current?.click()} className="flex size-11 items-center justify-center rounded-full text-texto-suave transition hover:bg-superficie-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento disabled:opacity-40"><ImagePlus aria-hidden="true" className="size-5" /></button>
            <input ref={cameraInput} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" aria-label="Tomar foto" onChange={(event) => { if (event.target.files?.length) setPhotos((current) => [...current, ...Array.from(event.target.files ?? [])].slice(0, 4)); event.currentTarget.value = ""; }} />
            <input ref={galleryInput} type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" aria-label="Elegir foto de la galería" onChange={(event) => { if (event.target.files?.length) setPhotos((current) => [...current, ...Array.from(event.target.files ?? [])].slice(0, 4)); event.currentTarget.value = ""; }} />
            {canVoice && <BotonVoz campoId="advisor-message" alTexto={onVoiceText} deshabilitado={busy} variante="cliente" clase="grid size-11 place-items-center rounded-full text-texto-suave transition hover:bg-superficie-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento disabled:opacity-40" />}
          </div>
          <button type="submit" disabled={busy || !value.trim()} className="flex min-h-11 items-center gap-2 rounded-full bg-acento px-5 font-semibold text-sobre-acento transition hover:bg-acento-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45">
            <span>{busy ? "Enviando" : "Enviar"}</span><Send aria-hidden="true" className="size-4" />
          </button>
        </div>
      </form>
      <p className="px-3 pt-2 text-center text-xs text-texto-tenue">Puedes escribir, adjuntar hasta cuatro fotos o elegir una opción sugerida.</p>
    </div>
  );
}
