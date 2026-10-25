"use client";

import { useState } from "react";
import { Clock } from "lucide-react";

const QUICK_TIMES = ["10:00", "15:00", "17:00", "19:00"];

type StartTimePickerProps = { busy: boolean; onConfirm: (message: string) => void };

export function StartTimePicker({ busy, onConfirm }: StartTimePickerProps) {
  const [time, setTime] = useState("17:00");
  return (
    <section aria-label="Hora de inicio del evento" className="entra mx-auto mb-3 w-full max-w-3xl rounded-3xl border border-acento/40 bg-superficie p-4 shadow-sm">
      <p className="flex items-center gap-2 text-sm font-semibold text-texto">
        <Clock aria-hidden="true" className="size-4 text-acento motion-safe:animate-pulse" />
        Último paso: ¿a qué hora empieza el evento?
      </p>
      <form className="mt-3 flex flex-wrap items-center gap-3" onSubmit={(event) => { event.preventDefault(); if (time) onConfirm(`La hora de inicio del evento es ${time}.`); }}>
        <label className="sr-only" htmlFor="advisor-start-time">Hora de inicio</label>
        <input id="advisor-start-time" type="time" step={900} required value={time} onChange={(event) => setTime(event.target.value)} disabled={busy}
          className="min-h-11 rounded-xl border border-borde bg-fondo px-3 text-2xl font-semibold tabular-nums text-texto transition-shadow focus:outline-none focus:ring-2 focus:ring-acento" />
        <div className="flex flex-wrap gap-2" role="group" aria-label="Horas frecuentes">
          {QUICK_TIMES.map((quick) => (
            <button key={quick} type="button" disabled={busy} onClick={() => setTime(quick)} aria-pressed={time === quick}
              className={`min-h-11 rounded-full border px-3 text-sm font-semibold tabular-nums transition-colors ${time === quick ? "border-acento bg-acento text-sobre-acento" : "border-borde text-texto hover:border-acento"}`}>
              {quick}
            </button>
          ))}
        </div>
        <button type="submit" disabled={busy || !time} className="ml-auto min-h-11 rounded-xl bg-acento px-4 font-semibold text-sobre-acento disabled:opacity-60">
          Confirmar hora
        </button>
      </form>
    </section>
  );
}
