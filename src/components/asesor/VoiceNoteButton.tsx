"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Loader2, Mic, Square, X } from "lucide-react";
import { LiveWaveform } from "./LiveWaveform";
import { formatearTiempo } from "@/components/voz/estado-dictado";
import { MENSAJES_ERROR_DICTADO } from "@/components/voz/mensajes-voz";
import { useDictado } from "@/components/voz/useDictado";
import { useEstadoVoz } from "@/components/voz/useVozDisponible";
import { MAX_SEGUNDOS_AUDIO } from "@/lib/voz/limites";

/** A finished recording, reported the moment it ends so the chat can show it before the transcript exists. */
export type RecordedNote = { turnId: string; url: string; seconds: number; levels: number[] };

type Props = {
  conversationId: string | null;
  /** The recording just ended: show it now (audio + waveform) with a transcribing placeholder. */
  onRecorded: (note: RecordedNote) => void;
  /** The server saved the voice note as the customer's turn: here is its transcript. */
  onNote: (turnId: string, text: string) => void;
  /** The transcript could not be produced; `message` is what the customer should read. */
  onFailed: (turnId: string, message: string) => void;
  disabled?: boolean;
  className: string;
};

const ERROR_SECONDS = 7;
const MIC_KEY = "asesor.micId";
/** Below this peak the microphone delivered (almost) nothing: wrong or muted device, not a quiet voice. */
const SILENCE_PEAK = 0.03;

const readMic = (): string | null => { try { return window.localStorage.getItem(MIC_KEY); } catch { return null; } };
const saveMic = (id: string | null) => { try { if (id) window.localStorage.setItem(MIC_KEY, id); else window.localStorage.removeItem(MIC_KEY); } catch { /* the choice just is not remembered */ } };
const UNAVAILABLE: Record<"sin_navegador" | "apagada", string> = {
  sin_navegador: "Este navegador no puede grabar aquí. Abre la página con HTTPS (o desde localhost) y permite el micrófono.",
  apagada: "Las notas de voz no están disponibles ahora. Escribe tu mensaje, por favor.",
};

/**
 * Records a voice note and sends it to `/api/asesor/voice-notes`; the server stores the transcript as the customer's turn
 * and `onNote` then runs the advisor turn with it. When voice is unavailable the button stays visible and says why.
 */
export function VoiceNoteButton({ conversationId, onRecorded, onNote, onFailed, disabled = false, className }: Props) {
  const voice = useEstadoVoz();
  const [hint, setHint] = useState(false);
  const turnId = useRef("");
  const wrapper = useRef<HTMLSpanElement>(null);

  const levels = useRef<number[]>([]);
  const deviceName = useRef<string | null>(null);
  const [history, setHistory] = useState<number[]>([]);
  const [micId, setMicId] = useState<string | null>(null);
  const [mics, setMics] = useState<Array<{ id: string; label: string }> | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  useEffect(() => { const timer = window.setTimeout(() => setMicId(readMic()), 0); return () => window.clearTimeout(timer); }, []);
  const onLevel = useCallback((level: number) => { levels.current.push(level); setHistory((current) => [...current.slice(-79), level]); }, []);
  const send = useCallback(async (audio: Blob, signal: AbortSignal, seconds: number) => {
    const id = crypto.randomUUID();
    turnId.current = id;
    const heard = levels.current;
    onRecorded({ turnId: id, url: URL.createObjectURL(audio), seconds, levels: heard });
    const query = new URLSearchParams({ conversationId: conversationId ?? "", turnId: id });
    try {
      const response = await fetch(`/api/asesor/voice-notes?${query}`, { method: "POST", headers: { "Content-Type": audio.type || "audio/webm" }, body: audio, signal });
      if (!response.ok) {
        const body = (await response.clone().json().catch(() => ({}))) as { error?: unknown };
        const silent = Math.max(0, ...levels.current) < SILENCE_PEAK;
        onFailed(id, silent && response.status === 422
          ? `No detectamos sonido en tu micrófono${deviceName.current ? ` («${deviceName.current}»)` : ""}. Toca el micrófono, elige otro dispositivo e inténtalo de nuevo.`
          : typeof body.error === "string" ? body.error : "No se pudo transcribir la nota de voz.");
      }
      return response;
    } catch (error) {
      if (!signal.aborted) onFailed(id, navigator.onLine ? "No se pudo transcribir la nota de voz." : "Sin conexión: la nota de voz no se pudo enviar.");
      throw error;
    }
  }, [conversationId, onRecorded, onFailed]);
  const accept = useCallback((text: string) => onNote(turnId.current, text), [onNote]);
  const acceptsEsc = useCallback((e: KeyboardEvent) => e.target === document.body || (e.target instanceof Node && !!wrapper.current?.contains(e.target)), []);
  const { estado, segundos, dispositivo, alternar, cancelar, descartarError } = useDictado(accept, acceptsEsc, send, { dispositivoId: micId, alNivel: onLevel });
  useEffect(() => { deviceName.current = dispositivo; }, [dispositivo]);

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
  const quiet = recording && segundos > 1.5 && Math.max(0, ...history) < SILENCE_PEAK;
  const panel = recording || Boolean(error);

  const start = () => {
    if (estado.fase === "reposo") { levels.current = []; setHistory([]); setPickerOpen(false); }
    alternar();
  };
  const loadMics = async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setMics(all.filter((device) => device.kind === "audioinput" && device.deviceId !== "").map((device, index) => ({ id: device.deviceId, label: device.label || `Micrófono ${index + 1}` })));
    } catch { setMics([]); }
  };
  const togglePicker = () => { if (!pickerOpen) void loadMics(); setPickerOpen((open) => !open); };
  const chooseMic = (id: string) => { saveMic(id); setMicId(id); setPickerOpen(false); if (recording) cancelar(); descartarError(); };

  return (
    <span ref={wrapper} className="relative inline-flex shrink-0">
      <button type="button" onClick={start} aria-label={recording ? "Enviar nota de voz" : "Grabar nota de voz"} aria-pressed={recording} aria-busy={working}
        title={recording ? "Enviar la nota de voz (Esc cancela)" : "Grabar una nota de voz"} disabled={disabled || !conversationId || working}
        className={`${className} ${recording ? "border-red-500! bg-red-600! text-white! hover:bg-red-700!" : ""}`}>
        {working ? <Loader2 className="size-5 animate-spin motion-reduce:animate-none" aria-hidden /> : recording ? <Square className="size-4 fill-current" aria-hidden /> : <Mic className="size-5" aria-hidden />}
      </button>
      <span className="sr-only" role="status" aria-live="polite">{status}{quiet ? " No se detecta sonido en el micrófono." : ""}</span>
      {panel && (
        <div className="asesor-sube absolute bottom-full right-0 z-30 mb-2 flex w-[min(21rem,86vw)] flex-col gap-2 rounded-2xl border border-borde bg-superficie p-3 text-xs text-texto shadow-lg">
          {recording && (
            <div className="flex items-center gap-2.5">
              <span className="size-2 shrink-0 animate-pulse rounded-full bg-red-500 motion-reduce:animate-none" aria-hidden />
              <span className="shrink-0 whitespace-nowrap font-mono tabular-nums">{formatearTiempo(segundos)} / {formatearTiempo(MAX_SEGUNDOS_AUDIO)}</span>
              <LiveWaveform levels={history} quiet={quiet} />
              <button type="button" onClick={cancelar} aria-label="Cancelar nota de voz" title="Cancelar (Esc)" className="grid size-7 shrink-0 place-items-center rounded-full opacity-80 hover:bg-superficie-suave hover:opacity-100"><X className="size-4" aria-hidden /></button>
            </div>
          )}
          {quiet && <p role="alert" className="rounded-lg bg-aviso-suave px-2.5 py-1.5 text-[13px] leading-snug">No se detecta sonido en tu micrófono. Habla más cerca o elige otro micrófono abajo.</p>}
          {error && <p role="alert" className="rounded-lg bg-aviso-suave px-2.5 py-1.5 text-[13px] leading-snug">{MENSAJES_ERROR_DICTADO[error]}</p>}
          <button type="button" onClick={togglePicker} aria-expanded={pickerOpen} className="flex min-h-8 items-center justify-between gap-2 rounded-lg px-1 text-left text-texto-suave hover:bg-superficie-suave">
            <span className="flex min-w-0 items-center gap-1.5"><Mic className="size-3.5 shrink-0" aria-hidden /><span className="truncate">{dispositivo ?? "Micrófono predeterminado"}</span></span>
            <span className="flex shrink-0 items-center gap-0.5 font-medium text-acento">Cambiar<ChevronDown className="size-3.5" aria-hidden /></span>
          </button>
          {pickerOpen && <ul aria-label="Micrófonos disponibles" className="flex flex-col gap-0.5 border-t border-borde-suave pt-2">
            {mics === null ? <li className="px-1 text-texto-suave">Buscando micrófonos…</li>
              : mics.length === 0 ? <li className="px-1 text-texto-suave">No se encontraron micrófonos.</li>
                : mics.map((mic) => <li key={mic.id}><button type="button" onClick={() => chooseMic(mic.id)} aria-pressed={mic.id === micId || (dispositivo !== null && mic.label === dispositivo)} className="flex min-h-9 w-full items-center gap-2 rounded-lg px-1 text-left hover:bg-superficie-suave"><span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${mic.id === micId || (dispositivo !== null && mic.label === dispositivo) ? "bg-acento" : "bg-borde"}`} /><span className="truncate">{mic.label}</span></button></li>)}
          </ul>}
        </div>
      )}
    </span>
  );
}
