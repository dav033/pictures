'use client';

import type { ReactNode } from 'react';
import { ArrowUp, Square } from 'lucide-react';

export type PromptBarProps = {
  variant: 'grande' | 'normal';
  /** Left slot (attach menu). */
  leading: ReactNode;
  /** Text field and any inline tools (voice). */
  children: ReactNode;
  loading: boolean;
  canSend: boolean;
  onSend: () => void;
  onCancel: () => void;
};

/** Prompt bar: a glowing pill form with the send button, which turns into the cancel button while a reply is running. Hook-free on purpose. */
export function PromptBar({ variant, leading, children, loading, canSend, onSend, onCancel }: PromptBarProps) {
  return (
    <form
      onSubmit={(event) => { event.preventDefault(); onSend(); }}
      data-testid="prompt-bar"
      className={`compositor prompt-bar ${variant === 'grande' ? 'grande' : ''}`}
    >
      {leading}
      {children}
      {loading ? (
        <button type="button" onClick={onCancel} aria-label="Cancelar respuesta" title="Cancelar respuesta" className="compositor-enviar" data-testid="cancelar-respuesta">
          <Square className="size-3.5 fill-current" aria-hidden="true" />
        </button>
      ) : (
        <button type="submit" disabled={!canSend} aria-label="Enviar" title="Enviar" className="compositor-enviar">
          <ArrowUp className="size-[1.125rem]" aria-hidden="true" />
        </button>
      )}
    </form>
  );
}
