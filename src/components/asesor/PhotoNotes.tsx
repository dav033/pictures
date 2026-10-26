"use client";

import { useState, type CSSProperties } from "react";
import { Check, Eye, Pin } from "lucide-react";
import { readingLines } from "@/lib/asesor/photo-evidence";
import { KEEP_OPTIONS, keepReplyMessage, noKeepReplyMessage } from "@/lib/asesor/photo-keep";
import type { AdvisorPhoto } from "./conversation-contract";

type Props = {
  photo: AdvisorPhoto;
  /** 1-based position of this photo among the conversation's photos: how a chip message names it. */
  photoNumber: number;
  busy: boolean;
  onReply: (message: string) => void;
};

const SKIPPED_KEY = "asesor.keepSkipped";
const skippedPhotos = (): string[] => { try { return JSON.parse(window.localStorage.getItem(SKIPPED_KEY) ?? "[]") as string[]; } catch { return []; } };  // prerender-seguro: PhotoNotes solo se monta con fotos, que llegan del navegador (subida o conversación cargada), nunca en el prerender; la lectura falla a [] si no hay almacenamiento
const rememberSkipped = (id: string) => { try { window.localStorage.setItem(SKIPPED_KEY, JSON.stringify([...new Set([...skippedPhotos(), id])].slice(-50))); } catch { /* it will be offered again */ } };

const label = (option: string) => option.charAt(0).toUpperCase() + option.slice(1);

/** What the advisor read in a photo (to confirm), what the customer wants to keep from it, and the chips to say so. */
export function PhotoNotes({ photo, photoNumber, busy, onReply }: Props) {
  const [picked, setPicked] = useState<string[]>([]);
  const [skipped, setSkippedState] = useState(() => skippedPhotos().includes(photo.id));
  const setSkipped = (value: boolean) => { setSkippedState(value); if (value) rememberSkipped(photo.id); };
  const keep = photo.keep ?? [];
  if (!photo.reading && keep.length === 0) return null;
  const status = photo.confirmed === null ? "Por confirmar" : photo.confirmed ? "Confirmado" : "Corregida";
  const asking = photo.kind === "inspiration" && Boolean(photo.reading) && keep.length === 0 && !skipped;
  const toggle = (option: string) => setPicked((current) => current.includes(option) ? current.filter((item) => item !== option) : [...current, option]);
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
        <ul className="flex flex-wrap gap-1.5">{keep.map((item) => <li key={item} className="rounded-full bg-superficie px-2.5 py-1 text-xs">{label(item)}</li>)}</ul>
      </div>}
      {asking && <div role="group" aria-label="Qué conservar de la foto" className="flex flex-col gap-2 border-t border-borde-suave pt-2">
        <span className="text-xs font-semibold text-texto-suave">¿Qué es lo más importante de conservar de esta referencia?</span>
        <div className="flex flex-wrap gap-1.5">
          {KEEP_OPTIONS.map((option, index) => <button key={option} type="button" aria-pressed={picked.includes(option)} disabled={busy} onClick={() => toggle(option)} style={{ "--i": index } as CSSProperties}
            className={`asesor-pop min-h-9 rounded-full border px-3 text-xs font-medium disabled:opacity-50 ${picked.includes(option) ? "border-acento bg-acento text-sobre-acento" : "border-borde bg-superficie text-texto"}`}>{label(option)}</button>)}
        </div>
        <div className="flex items-center justify-between gap-2">
          <button type="button" disabled={busy} onClick={() => setSkipped(true)} className="min-h-9 px-1 text-xs text-texto-suave underline underline-offset-[3px]">Nada en particular</button>
          <button type="button" disabled={busy || picked.length === 0} onClick={() => onReply(keepReplyMessage(photoNumber, picked))} className="asesor-eleva min-h-9 rounded-full bg-acento px-4 text-xs font-semibold text-sobre-acento disabled:opacity-50">Listo</button>
        </div>
      </div>}
    </div>
  );
}
