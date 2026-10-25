"use client";

import { useState } from "react";

const QUICK_HOURS = [10, 15, 17, 19];
const MIN_MINUTES = 6 * 60;
const MAX_MINUTES = 23 * 60 + 30;

export function timeLabel(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function period(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  return hour < 12 ? "Inicio de la mañana" : hour < 19 ? "Inicio de la tarde" : "Inicio de la noche";
}

type StartTimePickerProps = { busy: boolean; onConfirm: (message: string) => void; onDismiss: () => void };

/** Bottom sheet for the start time, the last event fact: half-hour steps, frequent hours, then confirm. */
export function StartTimePicker({ busy, onConfirm, onDismiss }: StartTimePickerProps) {
  const [minutes, setMinutes] = useState(17 * 60);
  const label = timeLabel(minutes);
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center">
      <button type="button" aria-label="Cerrar selector de hora" onClick={onDismiss} className="absolute inset-0 bg-[var(--overlay)]" />
      <section role="dialog" aria-modal="true" aria-label="Hora de inicio del evento" className="asesor-hoja relative flex w-full max-w-2xl flex-col gap-4 rounded-t-[28px] bg-superficie px-5 pb-[max(1.6rem,env(safe-area-inset-bottom))] pt-3.5 shadow-[0_-18px_50px_rgb(34_27_46/0.22)]">
        <div aria-hidden="true" className="h-[5px] w-11 self-center rounded-full bg-borde" />
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-acento">Último dato del evento</span>
          <h2 className="asesor-display text-2xl font-bold">¿A qué hora empieza la fiesta?</h2>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-[20px] bg-fondo p-3.5">
          <button type="button" aria-label="Media hora antes" disabled={busy} onClick={() => setMinutes((value) => Math.max(MIN_MINUTES, value - 30))} className="size-[52px] rounded-full border border-borde bg-superficie text-2xl text-texto disabled:opacity-50">−</button>
          <div className="flex flex-col items-center">
            <output key={label} aria-live="polite" className="asesor-display asesor-hora text-[56px] font-bold leading-none tabular-nums">{label}</output>
            <span className="mt-1.5 text-[13px] text-texto-suave">{period(minutes)}</span>
          </div>
          <button type="button" aria-label="Media hora después" disabled={busy} onClick={() => setMinutes((value) => Math.min(MAX_MINUTES, value + 30))} className="size-[52px] rounded-full border border-borde bg-superficie text-2xl text-texto disabled:opacity-50">+</button>
        </div>
        <div role="group" aria-label="Horas frecuentes" className="grid grid-cols-4 gap-2">
          {QUICK_HOURS.map((hour) => {
            const on = minutes === hour * 60;
            return <button key={hour} type="button" aria-pressed={on} disabled={busy} onClick={() => setMinutes(hour * 60)}
              className={`min-h-11 rounded-xl text-sm font-semibold tabular-nums ${on ? "bg-texto text-superficie" : "border border-borde bg-superficie text-texto"}`}>{timeLabel(hour * 60)}</button>;
          })}
        </div>
        <button type="button" disabled={busy} onClick={() => onConfirm(`La hora de inicio del evento es ${label}.`)} className="min-h-[54px] rounded-2xl bg-acento text-base font-semibold text-sobre-acento disabled:opacity-60">Confirmar {label}</button>
      </section>
    </div>
  );
}
