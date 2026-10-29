import { Fragment } from "react";
import Link from "next/link";
import type { AdvisorHeadline, AdvisorProgress } from "./conversation-contract";

const STEPS = [
  { key: "event", label: "Evento" },
  { key: "preferences", label: "Gustos" },
  { key: "start_time", label: "Hora" },
  { key: "proposal", label: "Propuesta" },
  { key: "contact", label: "Contacto" },
] as const;

/** Index of the current step in the tracker; the summary step marks every step done. */
export function stepIndex(progress: AdvisorProgress | null): number {
  if (!progress?.step) return 0;
  if (progress.step === "summary") return STEPS.length;
  return STEPS.findIndex(({ key }) => key === progress.step);
}

type Props = { headline: AdvisorHeadline; progress: AdvisorProgress | null; onNew?: () => void };

export function AdvisorHeader({ headline, progress, onNew }: Props) {
  const current = stepIndex(progress);
  return (
    <header className="sticky top-0 z-10 border-b border-borde-suave bg-fondo/95 px-5 pb-3.5 pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur">
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 key={headline.title ?? "sin-titulo"} className="asesor-fade asesor-display line-clamp-2 text-xl font-bold leading-tight">{headline.title ?? "Planeemos tu celebración"}</h1>
          <p key={headline.facts.join("|")} className="asesor-fade truncate text-[13px] text-texto-suave">{headline.facts.length ? headline.facts.join(" · ") : "Asesor Happia · versión de prueba"}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link href="/asesor/personalizado" className="inline-flex min-h-11 items-center rounded-full border border-borde bg-superficie px-3 text-sm font-medium text-texto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento">Personalizado</Link>
          {onNew && <button type="button" onClick={onNew} className="min-h-11 rounded-full border border-borde bg-superficie px-3.5 text-sm font-medium text-texto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento">Nueva</button>}
        </div>
      </div>
      {progress?.step && <nav aria-label="Pasos de la asesoría" className="mx-auto mt-3 flex max-w-2xl items-center gap-2 overflow-x-auto whitespace-nowrap text-xs [scrollbar-width:none]">
        {STEPS.map(({ key, label }, index) => <Fragment key={key}>
          {index > 0 && index > current && <span aria-hidden="true" className="text-[#b9aea2]">·</span>}
          {index < current
            ? <span key={`${key}:done`} title={label} className="asesor-pop grid size-6 shrink-0 place-items-center rounded-full bg-exito-suave font-bold text-exito"><span aria-hidden="true">✓</span><span className="sr-only">{label} listo</span></span>
            : index === current
              ? <span key={`${key}:current`} aria-current="step" className="asesor-pop rounded-full bg-acento px-2.5 py-1 font-semibold text-sobre-acento">{index + 1} {label}</span>
              : <span key={`${key}:todo`} className="text-texto-suave">{label}</span>}
        </Fragment>)}
        {current === STEPS.length && <span className="asesor-fade ml-1 font-semibold text-exito">Todo listo: revisa el resumen</span>}
      </nav>}
    </header>
  );
}
