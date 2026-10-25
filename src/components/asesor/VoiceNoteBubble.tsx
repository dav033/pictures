"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Mic, Pause, Play, TriangleAlert, X } from "lucide-react";
import type { AdvisorMessage } from "./conversation-contract";
import { clock, placeholderWaveform } from "./waveform";

type Props = { message: AdvisorMessage; onDiscard?: (id: string) => void };

/**
 * The customer's voice note, WhatsApp style: play button, the recording's own waveform and its length, and the transcript
 * right below it. It appears the moment recording ends; the transcript fills in as soon as the server has it. Only this
 * browser keeps the audio (the server stores the transcript alone), so a restored conversation shows the transcript only.
 */
export function VoiceNoteBubble({ message, onDiscard }: Props) {
  const voice = message.voice;
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const bars = useMemo(() => voice?.waveform ?? placeholderWaveform(message.id), [voice?.waveform, message.id]);
  const seconds = voice?.seconds ?? null;
  const playable = Boolean(voice?.url);
  useEffect(() => { const element = audio.current; return () => element?.pause(); }, []);
  const toggle = () => {
    const element = audio.current;
    if (!element) return;
    if (element.paused) void element.play().catch(() => setPlaying(false)); else element.pause();
  };
  const state = voice?.state ?? "ready";
  return (
    <div className="flex min-w-[15rem] flex-col gap-2.5">
      <div className="flex items-center gap-3">
        {playable
          ? <button type="button" onClick={toggle} aria-label={playing ? "Pausar nota de voz" : "Escuchar nota de voz"} className="grid size-10 shrink-0 place-items-center rounded-full bg-acento text-sobre-acento focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento focus-visible:ring-offset-2">
            {playing ? <Pause className="size-4 fill-current" aria-hidden /> : <Play className="ml-0.5 size-4 fill-current" aria-hidden />}
          </button>
          : <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-superficie-suave text-acento"><Mic className="size-4" /></span>}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div role="img" aria-label={seconds !== null ? `Nota de voz de ${clock(seconds)}` : "Nota de voz"} className="flex h-8 items-center gap-[3px]">
            {bars.map((height, index) => <span key={index} style={{ height: `${Math.round(height * 100)}%`, "--i": Math.min(index, 20) } as React.CSSProperties}
              className={`asesor-barra w-[3px] shrink-0 rounded-full transition-colors duration-150 ${index / bars.length < progress ? "bg-acento" : "bg-borde"}`} />)}
          </div>
          <span className="flex items-center gap-1 text-[11px] tabular-nums text-texto-suave">
            {state === "transcribing" && <Loader2 aria-hidden="true" className="size-3 animate-spin motion-reduce:animate-none" />}
            {seconds !== null ? clock(playing ? elapsed : seconds) : "Nota de voz"}
          </span>
        </div>
      </div>
      {playable && <audio ref={audio} src={voice?.url ?? undefined} preload="metadata"
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setProgress(0); setElapsed(0); }}
        onTimeUpdate={(event) => { const element = event.currentTarget; setElapsed(element.currentTime); const total = seconds ?? element.duration; if (total > 0 && Number.isFinite(total)) setProgress(Math.min(1, element.currentTime / total)); }} />}
      <div className="border-t border-borde-suave pt-2 text-[15px] leading-relaxed">
        {state === "transcribing" && <p role="status" aria-label="Transcribiendo la nota de voz" className="flex flex-col gap-1.5" >
          <span className="asesor-brillo h-3 w-full rounded-full" /><span className="asesor-brillo h-3 w-2/3 rounded-full" />
          <span className="text-xs text-texto-suave">Transcribiendo…</span>
        </p>}
        {state === "ready" && <p className="asesor-fade whitespace-pre-wrap"><span className="sr-only">Transcripción: </span>{message.content}</p>}
        {state === "failed" && <div role="alert" className="flex items-start justify-between gap-2 text-sm text-error">
          <span className="flex items-start gap-1.5"><TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />{voice?.error ?? "No se pudo transcribir la nota de voz."}</span>
          {onDiscard && <button type="button" onClick={() => onDiscard(message.id)} aria-label="Descartar nota de voz" className="grid size-7 shrink-0 place-items-center rounded-full text-texto-suave hover:bg-superficie-suave"><X className="size-4" aria-hidden /></button>}
        </div>}
      </div>
    </div>
  );
}
