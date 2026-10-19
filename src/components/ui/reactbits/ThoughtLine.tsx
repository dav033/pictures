'use client';

import type { ReactNode } from 'react';
import { StatusMark, type StatusMarkState } from './StatusMark';

export type ThoughtLineStep = { id: string | number; text: string; state: StatusMarkState };

/**
 * One live line that folds the steps taken so far: the summary shows the latest step (or `pending`
 * text while waiting for the next), and expanding it lists every step.
 */
export function ThoughtLine({ steps, pending, label, className = '' }: { steps: readonly ThoughtLineStep[]; pending?: ReactNode; label: string; className?: string }) {
  const last = steps[steps.length - 1];
  return (
    <details data-testid="thought-line" aria-label={label} className={`group text-[11.5px] text-taller-suave ${className}`}>
      <summary className="flex cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden">
        {pending ? <StatusMark state="pending" /> : last ? <StatusMark state={last.state} /> : null}
        <span role="status" className="min-w-0 flex-1 truncate">{pending ?? last?.text}</span>
        {steps.length > 1 && <span className="shrink-0 text-[10.5px]">{steps.length} pasos</span>}
      </summary>
      {steps.length > 0 && (
        <ol className="mt-1 grid gap-0.5 pl-0.5">
          {steps.map((s) => (
            <li key={s.id} className="flex items-start gap-1.5"><StatusMark state={s.state} /><span>{s.text}</span></li>
          ))}
        </ol>
      )}
    </details>
  );
}
