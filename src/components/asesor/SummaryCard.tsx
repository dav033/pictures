import type { CSSProperties } from "react";
import type { AdvisorSummary } from "./conversation-contract";

type Row = { label: string; value: string };
/** Package bookkeeping lines the customer approves too, kept behind "Ver condiciones" instead of the main rows. */
const CONDITION_LABELS = /^(Fuente del estimado|Actualidad del catálogo|Aviso del paquete)$/;

/** Splits the approved summary text ("Etiqueta: valor" per line) into rows, the change history and package conditions. */
export function summarySections(text: string): { rows: Row[]; changes: string[]; conditions: string[] } {
  const rows: Row[] = [];
  const changes: string[] = [];
  const conditions: string[] = [];
  for (const line of text.split("\n").map((entry) => entry.trim()).filter(Boolean)) {
    const colon = line.indexOf(": ");
    const label = colon > 0 ? line.slice(0, colon) : "";
    const value = colon > 0 ? line.slice(colon + 2) : line;
    if (label === "Cambio") changes.push(value);
    else if (CONDITION_LABELS.test(label)) conditions.push(value);
    else rows.push({ label, value });
  }
  return { rows, changes, conditions };
}

type Props = { summary: AdvisorSummary; approved: boolean; conversationId: string | null; busy: boolean; onApprove: () => void; onCorrect: () => void };

export function SummaryCard({ summary, approved, conversationId, busy, onApprove, onCorrect }: Props) {
  const { rows, changes, conditions } = summarySections(summary.text);
  return (
    <li aria-label="Resumen actual del evento" className="asesor-sube flex flex-col gap-3">
      <article className="flex flex-col gap-3 rounded-[22px] border border-borde-suave bg-superficie p-4 shadow-[0_10px_30px_var(--sombra)]">
        <h2 className="asesor-display text-lg font-bold">Resumen para revisar · versión {summary.version}</h2>
        <dl className="flex flex-col gap-2.5 text-sm leading-snug">
          {rows.map((row, index) => <div key={`${row.label}-${index}`} style={{ "--i": Math.min(index, 10) + 1 } as CSSProperties} className="asesor-sube flex flex-col gap-px">
            {row.label && <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-texto-suave">{row.label}</dt>}
            <dd className="flex items-center justify-between gap-2">{row.value}{row.label === "Presupuesto" && <span className="shrink-0 text-xs text-texto-suave">Solo para Happia</span>}</dd>
          </div>)}
        </dl>
        {changes.length > 0 && <section aria-label="Historial de cambios" className="flex flex-col gap-2 rounded-[14px] bg-superficie-suave p-3">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-acento">Historial de cambios</span>
          <ol className="flex flex-col gap-1.5 text-[13px] leading-snug">
            {changes.map((change, index) => <li key={index} className="flex gap-2"><span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-full bg-acento" />{change}</li>)}
          </ol>
        </section>}
        {conditions.length > 0 && <details className="text-[13px] text-texto-suave">
          <summary className="cursor-pointer font-medium text-acento">Ver condiciones del paquete</summary>
          <ul className="mt-1 flex flex-col gap-1">{conditions.map((condition) => <li key={condition}>{condition}</li>)}</ul>
        </details>}
      </article>
      {approved
        ? <a className="asesor-pop asesor-pulso inline-flex min-h-12 items-center justify-center rounded-[14px] bg-acento px-4 font-semibold text-sobre-acento focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento" href={`/asesor/brief/${encodeURIComponent(conversationId ?? "")}`}>Ver resumen aprobado</a>
        : <div className="grid grid-cols-2 gap-2">
          <button type="button" disabled={busy} onClick={onCorrect} className="asesor-eleva min-h-12 rounded-[14px] border border-borde bg-superficie font-medium text-texto disabled:opacity-50">Corregir algo</button>
          <button type="button" disabled={busy} onClick={onApprove} className="asesor-eleva min-h-12 rounded-[14px] bg-acento font-semibold text-sobre-acento disabled:opacity-50">Aprobar resumen</button>
        </div>}
    </li>
  );
}
