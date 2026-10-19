'use client';

export type StatusMarkState = 'pending' | 'ok' | 'error';

const GLYPH: Readonly<Record<StatusMarkState, string>> = { pending: '◌', ok: '✓', error: '✗' };
const TONE: Readonly<Record<StatusMarkState, string>> = {
  pending: 'text-acento',
  ok: 'text-taller-valido',
  error: 'text-taller-peligro',
};

/** Tiny state glyph (pending / ok / error). Decorative: the text next to it carries the meaning. */
export function StatusMark({ state, className = '' }: { state: StatusMarkState; className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-status={state}
      className={`inline-grid size-4 shrink-0 place-items-center text-[0.8125rem] leading-none ${TONE[state]} ${state === 'pending' ? 'animate-pulse motion-reduce:animate-none' : ''} ${className}`}
    >
      {GLYPH[state]}
    </span>
  );
}
