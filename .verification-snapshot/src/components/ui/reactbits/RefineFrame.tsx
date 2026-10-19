'use client';

import { StatusMark } from './StatusMark';

export type RefineFrameStage = { id: string; name: string };

/** Ordered stages of a long generation: finished ones are checked, the current one pulses. `current: null` = nothing started. */
export function RefineFrame({ stages, current, label }: { stages: readonly RefineFrameStage[]; current: string | null; label: string }) {
  const at = current === null ? -1 : stages.findIndex((s) => s.id === current);
  return (
    <ol aria-label={label} data-testid="refine-frame" data-current={current ?? ''} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-dashed border-borde px-3 py-2 text-xs text-texto-suave">
      {stages.map((s, i) => (
        <li key={s.id} data-stage={s.id} aria-current={i === at ? 'step' : undefined} className={`flex items-center gap-1.5 ${i === at ? 'font-medium text-texto' : ''}`}>
          <StatusMark state={i < at ? 'ok' : 'pending'} className={i > at ? 'opacity-40 animate-none' : ''} />
          {s.name}
        </li>
      ))}
    </ol>
  );
}
