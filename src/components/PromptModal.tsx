"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "motion/react";
import { Check, Copy, X } from "lucide-react";
import { useState } from "react";

type PromptEntry = {
  label: string;
  prompt: string;
};

export function PromptModal({
  entries,
  open,
  onClose,
}: {
  entries: PromptEntry[];
  open: boolean;
  onClose: () => void;
}) {
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);

  async function copiar(label: string, prompt: string) {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopiedLabel(label);
      window.setTimeout(() => setCopiedLabel((actual) => actual === label ? null : actual), 1600);
    } catch {
      setCopiedLabel(null);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(abierto) => { if (!abierto) onClose(); }}>
      <AnimatePresence>
        {open && entries.length > 0 && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="fixed inset-0 z-[60] bg-black/55 backdrop-blur-[2px]"
              />
            </Dialog.Overlay>
            <Dialog.Content
              forceMount
              className="fixed left-1/2 top-1/2 z-[60] flex max-h-[calc(100dvh-2rem)] w-[min(92vw,54rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-borde bg-superficie shadow-2xl outline-none"
            >
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.98 }}
                transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
                className="flex min-h-0 flex-col"
              >
                <div className="flex items-start justify-between gap-4 border-b border-borde px-5 py-4">
                  <div>
                    <Dialog.Title className="text-base font-semibold text-texto">
                      Prompt enviado al modelo
                    </Dialog.Title>
                    <Dialog.Description className="mt-1 text-xs leading-5 text-texto-suave">
                      Texto exacto usado para generar esta visualización.
                    </Dialog.Description>
                  </div>
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      aria-label="Cerrar prompt"
                      className="ui-pressable rounded-lg p-1.5 text-texto-suave hover:bg-superficie-2 hover:text-texto"
                    >
                      <X className="size-4" aria-hidden="true" />
                    </button>
                  </Dialog.Close>
                </div>

                <div className="min-h-0 space-y-4 overflow-y-auto p-5">
                  {entries.map((entry) => (
                    <section key={entry.label} className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-acento">
                          {entry.label}
                        </h3>
                        <button
                          type="button"
                          onClick={() => copiar(entry.label, entry.prompt)}
                          className="ui-button-ghost inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs hover:bg-acento-suave"
                        >
                          {copiedLabel === entry.label ? (
                            <Check className="size-3.5" aria-hidden="true" />
                          ) : (
                            <Copy className="size-3.5" aria-hidden="true" />
                          )}
                          {copiedLabel === entry.label ? "Copiado" : "Copiar"}
                        </button>
                      </div>
                      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-borde bg-superficie-2 p-3 font-mono text-xs leading-5 text-texto">
                        {entry.prompt}
                      </pre>
                      <p className="text-right text-[11px] text-texto-suave">
                        {entry.prompt.length} caracteres
                      </p>
                    </section>
                  ))}
                </div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
