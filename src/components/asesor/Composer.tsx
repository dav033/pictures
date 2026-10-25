"use client";

import { ArrowUp, Camera, ImagePlus, Paperclip } from "lucide-react";
import { useRef, useState, type RefObject } from "react";
import { BotonVoz } from "@/components/voz/BotonVoz";
import { VoiceNoteButton } from "./VoiceNoteButton";

export type ComposerCapabilities = { photo: boolean; voice: boolean };
type Props = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (content: string, photos?: File[]) => void;
  busy: boolean;
  capabilities?: ComposerCapabilities;
  photoKind?: "inspiration" | "venue";
  onPhotoKindChange?: (kind: "inspiration" | "venue") => void;
  onVoiceText?: (text: string) => void;
  /** Voice notes are sent as their own turn while the draft is empty; with a draft the microphone dictates into it. */
  voiceNote?: { conversationId: string | null; onNote: (turnId: string, text: string) => void };
  onRetry?: () => void;
  error?: string | null;
  placeholder?: string;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
};

const iconButton = "grid size-11 shrink-0 place-items-center rounded-full text-texto-suave transition hover:bg-superficie-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento disabled:opacity-40";

export function Composer({ value, onChange, onSubmit, busy, capabilities = { photo: false, voice: false }, photoKind = "inspiration", onPhotoKindChange, onVoiceText, voiceNote, onRetry, error, placeholder = "Escribe tu respuesta…", textareaRef }: Props) {
  const [photos, setPhotos] = useState<File[]>([]);
  const [trayOpen, setTrayOpen] = useState(false);
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const canPhoto = capabilities.photo;
  const canVoice = capabilities.voice && onVoiceText !== undefined;
  const addPhotos = (files: FileList | null) => { if (files?.length) { setPhotos((current) => [...current, ...Array.from(files)].slice(0, 4)); setTrayOpen(false); } };
  return (
    <div className="mx-auto w-full max-w-2xl">
      {error && (
        <div role="alert" className="asesor-sube mb-2 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-error/30 bg-error-suave px-4 py-3 text-sm text-texto">
          <span>{error}</span>
          {onRetry && <button type="button" onClick={onRetry} disabled={busy} className="rounded-lg px-3 py-2 font-semibold text-acento underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento disabled:opacity-50">Reintentar</button>}
        </div>
      )}
      {trayOpen && canPhoto && (
        <div className="asesor-sube mb-2 flex flex-wrap items-center gap-2 rounded-2xl border border-borde bg-superficie p-2 shadow-sm">
          <label className="sr-only" htmlFor="advisor-photo-kind">Tipo de foto</label>
          <select id="advisor-photo-kind" aria-label="Tipo de foto" value={photoKind} onChange={(event) => onPhotoKindChange?.(event.target.value === "venue" ? "venue" : "inspiration")} disabled={busy} className="min-h-11 rounded-xl border border-borde bg-fondo px-2 text-sm text-texto">
            <option value="inspiration">Inspiración</option><option value="venue">Foto del lugar</option>
          </select>
          <button type="button" aria-label="Tomar foto" disabled={busy} onClick={() => cameraInput.current?.click()} className="flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-medium text-texto hover:bg-superficie-2"><Camera aria-hidden="true" className="size-5" />Cámara</button>
          <button type="button" aria-label="Elegir foto de la galería" disabled={busy} onClick={() => galleryInput.current?.click()} className="flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-medium text-texto hover:bg-superficie-2"><ImagePlus aria-hidden="true" className="size-5" />Galería</button>
        </div>
      )}
      <input ref={cameraInput} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" aria-label="Tomar foto" tabIndex={-1} onChange={(event) => { addPhotos(event.target.files); event.currentTarget.value = ""; }} />
      <input ref={galleryInput} type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" aria-label="Elegir foto de la galería" tabIndex={-1} onChange={(event) => { addPhotos(event.target.files); event.currentTarget.value = ""; }} />
      {photos.length > 0 && <p key={photos.length} className="asesor-fade mb-2 px-3 text-sm text-texto-suave" aria-live="polite">{photos.length} {photos.length === 1 ? "foto lista" : "fotos listas"} · {photoKind === "venue" ? "Lugar del evento" : "Inspiración"}</p>}
      <form onSubmit={(event) => { event.preventDefault(); onSubmit(value, photos); setPhotos([]); onChange(""); }} className="flex items-end gap-1.5 rounded-[28px] border border-borde bg-superficie py-1.5 pl-2 pr-1.5 shadow-[0_6px_20px_var(--sombra)] focus-within:border-acento">
        <button type="button" aria-label={canPhoto ? "Adjuntar foto" : "Fotos no disponibles todavía"} aria-expanded={trayOpen} disabled={!canPhoto || busy} onClick={() => setTrayOpen((open) => !open)} className={iconButton}><Paperclip aria-hidden="true" className="size-5" /></button>
        <label htmlFor="advisor-message" className="sr-only">Tu mensaje</label>
        <textarea ref={textareaRef} id="advisor-message" name="message" rows={1} value={value} onChange={(event) => onChange(event.target.value)} disabled={busy} placeholder={placeholder}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }}
          className="max-h-32 min-h-11 min-w-0 flex-1 resize-none bg-transparent py-2.5 text-base text-texto outline-none [field-sizing:content] placeholder:text-texto-suave disabled:opacity-60" />
        {canVoice && (voiceNote && !value.trim()
          ? <VoiceNoteButton conversationId={voiceNote.conversationId} onNote={voiceNote.onNote} disabled={busy} className={iconButton} />
          : <BotonVoz campoId="advisor-message" alTexto={onVoiceText} deshabilitado={busy} variante="cliente" clase={iconButton} />)}
        <button type="submit" aria-label="Enviar" disabled={busy || (!value.trim() && photos.length === 0)} className="grid size-11 shrink-0 place-items-center rounded-full bg-acento text-sobre-acento transition hover:bg-acento-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45">
          <ArrowUp aria-hidden="true" className="size-5" />
        </button>
      </form>
    </div>
  );
}
