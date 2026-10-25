import type { CSSProperties } from "react";
import { BUDGET_REPLIES, BUDGET_UNDISCLOSED_REPLY, PRIORITY_REPLIES } from "@/lib/asesor/quick-replies";

type Props = { ask: "priority" | "budget"; busy: boolean; onPick: (message: string) => void };

const chip = "asesor-pop asesor-eleva min-h-11 rounded-xl border border-borde bg-superficie px-3.5 text-sm font-medium text-texto transition-colors hover:border-acento focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento disabled:opacity-50";

/** Quick-pick answers for the preferences step; each sends a fixed message the server applies to the brief. */
export function QuickReplies({ ask, busy, onPick }: Props) {
  if (ask === "priority") {
    return (
      <div role="group" aria-label="Lo más importante" className="ml-10 grid grid-cols-2 gap-2">
        {Object.values(PRIORITY_REPLIES).map((reply, index) => <button key={reply.label} style={{ "--i": index } as CSSProperties} type="button" disabled={busy} onClick={() => onPick(reply.message)} className={chip}>{reply.label}</button>)}
      </div>
    );
  }
  return (
    <div className="ml-10 flex flex-col gap-2">
      <div role="group" aria-label="Presupuesto aproximado" className="flex flex-wrap gap-2">
        {BUDGET_REPLIES.map((reply, index) => <button key={reply.label} style={{ "--i": index } as CSSProperties} type="button" disabled={busy} onClick={() => onPick(reply.message)} className={chip}>{reply.label}</button>)}
        <button type="button" style={{ "--i": BUDGET_REPLIES.length } as CSSProperties} disabled={busy} onClick={() => onPick(BUDGET_UNDISCLOSED_REPLY.message)} className="asesor-fade min-h-11 px-3.5 text-sm font-medium text-texto-suave underline underline-offset-[3px] disabled:opacity-50">{BUDGET_UNDISCLOSED_REPLY.label}</button>
      </div>
      <p style={{ "--i": BUDGET_REPLIES.length + 1 } as CSSProperties} className="asesor-fade text-xs text-texto-suave">Tu presupuesto no se comparte con los decoradores.</p>
    </div>
  );
}
