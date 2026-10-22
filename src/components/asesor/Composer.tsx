"use client";

import { Camera, Mic, Send } from "lucide-react";
import type { AdvisorComposerCard } from "./conversation-contract";

export type ComposerCapabilities = { photo: boolean; voice: boolean };
type Props = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (content: string) => void;
  busy: boolean;
  cards?: readonly AdvisorComposerCard[];
  capabilities?: ComposerCapabilities;
  onPhoto?: () => void;
  onVoice?: () => void;
  onRetry?: () => void;
  error?: string | null;
};

export function Composer({ value, onChange, onSubmit, busy, cards = [], capabilities = { photo: false, voice: false }, onPhoto, onVoice, onRetry, error }: Props) {
  const canPhoto = capabilities.photo && onPhoto !== undefined;
  const canVoice = capabilities.voice && onVoice !== undefined;
  return (
    <div className="mx-auto w-full max-w-3xl">
      {cards.length > 0 && (
        <section aria-label="Opciones para continuar" className="mb-3 grid gap-2 sm:grid-cols-2">
          {cards.map((card) => (
            <button key={`${card.kind}:${card.id}`} type="button" disabled={busy} onClick={() => onSubmit(card.content)} className="rounded-2xl border border-borde bg-superficie p-3 text-left shadow-sm transition hover:border-acento focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento disabled:opacity-50">
              <span className="text-xs font-semibold uppercase tracking-wide text-acento">{card.kind === "direction" ? "Dirección" : "Paquete"}</span>
              <span className="mt-1 block font-medium text-texto">{card.title}</span>
              <span className="mt-1 block text-sm text-texto-suave">{card.description}</span>
              {card.kind === "package" && card.estimate && <span className="mt-1 block text-xs text-texto-tenue">
                Fuente: {card.estimate.source === "postgres" ? "catálogo Happia" : "última copia validada"}
                {card.estimate.fetchedAt ? ` · consultado ${new Date(card.estimate.fetchedAt).toLocaleString("es-CO")}` : " · fecha de actualización no disponible"}
                {card.estimate.status === "available" && card.estimate.subtotalCop !== null
                  ? ` · subtotal ${new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(card.estimate.subtotalCop)}`
                  : " · precio no disponible"}
              </span>}
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
      <form onSubmit={(event) => { event.preventDefault(); onSubmit(value); onChange(""); }} className="rounded-3xl border border-borde bg-superficie p-2 shadow-[0_8px_30px_var(--sombra)] focus-within:border-acento">
        <label htmlFor="advisor-message" className="sr-only">Tu mensaje</label>
        <textarea id="advisor-message" name="message" rows={2} value={value} onChange={(event) => onChange(event.target.value)} disabled={busy} placeholder="Cuéntame qué celebración estás planeando…" className="max-h-40 min-h-14 w-full resize-y bg-transparent px-3 py-2 text-base text-texto outline-none placeholder:text-texto-tenue disabled:opacity-60" />
        <div className="flex items-center justify-between gap-2 px-1 pb-1">
          <div className="flex items-center gap-1">
            <button type="button" aria-label={canPhoto ? "Agregar una foto" : "Fotos no disponibles todavía"} title={canPhoto ? "Agregar una foto" : "Fotos no disponibles todavía"} disabled={!canPhoto || busy} onClick={onPhoto} className="flex size-11 items-center justify-center rounded-full text-texto-suave transition hover:bg-superficie-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento disabled:opacity-40"><Camera aria-hidden="true" className="size-5" /></button>
            <button type="button" aria-label={canVoice ? "Dictar mensaje" : "Dictado no disponible todavía"} title={canVoice ? "Dictar mensaje" : "Dictado no disponible todavía"} disabled={!canVoice || busy} onClick={onVoice} className="flex size-11 items-center justify-center rounded-full text-texto-suave transition hover:bg-superficie-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento disabled:opacity-40"><Mic aria-hidden="true" className="size-5" /></button>
          </div>
          <button type="submit" disabled={busy || !value.trim()} className="flex min-h-11 items-center gap-2 rounded-full bg-acento px-5 font-semibold text-sobre-acento transition hover:bg-acento-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45">
            <span>{busy ? "Enviando" : "Enviar"}</span><Send aria-hidden="true" className="size-4" />
          </button>
        </div>
      </form>
      <p className="px-3 pt-2 text-center text-xs text-texto-tenue">Puedes escribir con el teclado o elegir una opción sugerida.</p>
    </div>
  );
}
