"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mic, Square, X } from "lucide-react";
import { Nivel } from "@/components/voz/BotonVoz";
import { formatearTiempo } from "@/components/voz/estado-dictado";
import { MENSAJES_ERROR_DICTADO } from "@/components/voz/mensajes-voz";
import { useDictado } from "@/components/voz/useDictado";
import { useEstadoVoz } from "@/components/voz/useVozDisponible";
import { MAX_SEGUNDOS_AUDIO } from "@/lib/voz/limites";

type Props = {
  conversationId: string | null;
  /** Called with the stored turn id and its transcript once the server has saved the voice note as the customer's turn. */
  onNote: (turnId: string, text: string) => void;
  disabled?: boolean;
  className: string;
};

const ERROR_SECONDS = 7;
const UNAVAILABLE: Record<"sin_navegador" | "apagada", string> = {
  sin_navegador: "Este navegador no puede grabar aquí. Abre la página con HTTPS (o desde localhost) y permite el micrófono.",
  apagada: "Las notas de voz no están disponibles ahora. Escribe tu mensaje, por favor.",
};

/**
 * Records a voice note and sends it to `/api/asesor/voice-notes`; the server stores the transcript as the customer's turn
 * and `onNote` then runs the advisor turn with it. When voice is unavailable the button stays visible and says why.
 */
export function VoiceNoteButton({ conversationId, onNote, disabled = false, className }: Props) {
  const voice = useEstadoVoz();
  const [hint, setHint] = useState(false);
  const turnId = useRef("");
  const wrapper = useRef<HTMLSpanElement>(null);

  const send = useCallback((audio: Blob, signal: AbortSignal) => {
    turnId.current = crypto.randomUUID();
    const query = new URLSearchParams({ conversationId: conversationId ?? "", turnId: turnId.current });
    return fetch(`/api/asesor/voice-notes?${query}`, { method: "POST", headers: { "Content-Type": audio.type || "audio/webm" }, body: audio, signal });
  }, [conversationId]);
  const accept = useCallback((text: string) => onNote(turnId.current, text), [onNote]);
  const acceptsEsc = useCallback((e: KeyboardEvent) => e.target === document.body || (e.target instanceof Node && !!wrapper.current?.contains(e.target)), []);
  const { estado, segundos, nivel, alternar, cancelar, descartarError } = useDictado(accept, acceptsEsc, send);

  const error = estado.fase === "reposo" ? estado.error : null;
  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(descartarError, ERROR_SECONDS * 1000);
    return () => window.clearTimeout(timer);
  }, [error, descartarError]);

  useEffect(() => {
    if (!hint) return;
    const timer = window.setTimeout(() => setHint(false), ERROR_SECONDS * 1000);
    return () => window.clearTimeout(timer);
  }, [hint]);

  if (voice === "comprobando") return null;
  if (voice !== "lista") {
    return (
      <span className="relative inline-flex shrink-0">
        <button type="button" onClick={() => setHint((shown) => !shown)} aria-label="Nota de voz no disponible" aria-disabled="true" title={UNAVAILABLE[voice]} className={`${className} opacity-50`}><Mic className="size-5" aria-hidden /></button>
        {hint && <span role="alert" className="absolute bottom-full right-0 z-30 mb-1.5 w-64 max-w-[70vw] rounded-lg border border-borde bg-superficie px-2.5 py-1.5 text-left text-xs text-texto shadow-lg">{UNAVAILABLE[voice]}</span>}
      </span>
    );
  }
  const recording = estado.fase === "grabando";
  const working = estado.fase === "permiso" || estado.fase === "transcribiendo";
  const status = recording ? "Grabando la nota de voz. Toca de nuevo para enviarla." : estado.fase === "permiso" ? "Esperando el permiso del micrófono." : estado.fase === "transcribiendo" ? "Enviando la nota de voz." : "";

  return (
    <span ref={wrapper} className="relative inline-flex shrink-0">
      <button type="button" onClick={alternar} aria-label={recording ? "Enviar nota de voz" : "Grabar nota de voz"} aria-pressed={recording} aria-busy={working}
        title={recording ? "Enviar la nota de voz (Esc cancela)" : "Grabar una nota de voz"} disabled={disabled || !conversationId || working}
        className={`${className} ${recording ? "border-red-500! bg-red-600! text-white! hover:bg-red-700!" : ""}`}>
        {working ? <Loader2 className="size-5 animate-spin motion-reduce:animate-none" aria-hidden /> : recording ? <Square className="size-4 fill-current" aria-hidden /> : <Mic className="size-5" aria-hidden />}
      </button>
      <span className="sr-only" role="status" aria-live="polite">{status}</span>
      {(recording || estado.fase === "transcribiendo") && (
        <span className="absolute bottom-full right-0 z-30 mb-1.5 flex items-center gap-2 whitespace-nowrap rounded-lg border border-borde bg-superficie px-2.5 py-1.5 text-xs text-texto shadow-lg">
          {recording ? (
            <>
              <span className="size-2 shrink-0 animate-pulse rounded-full bg-red-500 motion-reduce:animate-none" aria-hidden />
              <span className="font-mono tabular-nums">{formatearTiempo(segundos)} / {formatearTiempo(MAX_SEGUNDOS_AUDIO)}</span>
              <Nivel nivel={nivel} />
              <button type="button" onClick={cancelar} aria-label="Cancelar nota de voz" title="Cancelar (Esc)" className="grid size-6 place-items-center rounded-full opacity-80 hover:opacity-100"><X className="size-3.5" aria-hidden /></button>
            </>
          ) : <span>Enviando…</span>}
        </span>
      )}
      {error && <span role="alert" className="absolute bottom-full right-0 z-30 mb-1.5 w-64 max-w-[70vw] rounded-lg border border-borde bg-superficie px-2.5 py-1.5 text-left text-xs text-texto shadow-lg">{MENSAJES_ERROR_DICTADO[error]}</span>}
    </span>
  );
}
