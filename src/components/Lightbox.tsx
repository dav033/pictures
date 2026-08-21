"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "motion/react";
import { Download, X } from "lucide-react";

/**
 * Sobre Dialog de Radix (antes era un <div> a mano): gana focus-trap real y
 * cierre con Escape sin un listener propio. `forceMount` en Portal/Overlay/
 * Content + AnimatePresence es lo que permite una transición real de SALIDA
 * — Radix por defecto desmonta de golpe al cerrar, sin eso no hay forma de
 * animar el cierre antes de que el contenido desaparezca del DOM.
 */
export function Lightbox({ src, open, onClose }: { src: string | null; open: boolean; onClose: () => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={(abierto) => { if (!abierto) onClose(); }}>
      <AnimatePresence>
        {open && src && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="fixed inset-0 z-50 bg-black/80"
              />
            </Dialog.Overlay>
            <Dialog.Content
              forceMount
              onClick={onClose}
              className="fixed inset-0 z-50 flex items-center justify-center p-4 outline-none"
            >
              <Dialog.Title className="sr-only">Visualización ampliada</Dialog.Title>
              <Dialog.Description className="sr-only">
                Imagen generada en tamaño completo, con opción de descargar.
              </Dialog.Description>
              <motion.div
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
                className="contents"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt="Visualización generada, ampliada"
                  onClick={(e) => e.stopPropagation()}
                  className="max-h-full max-w-full rounded-lg object-contain"
                />
              </motion.div>
              <div className="absolute right-4 top-4 flex gap-2" onClick={(e) => e.stopPropagation()}>
                <a
                  href={src}
                  download="visualizacion.jpg"
                  className="ui-pressable flex items-center gap-1.5 rounded-lg bg-white/90 px-3 py-1.5 text-sm font-medium text-texto hover:bg-white"
                >
                  <Download className="size-4" aria-hidden="true" />
                  Descargar
                </a>
                <Dialog.Close asChild>
                  <button
                    type="button"
                    aria-label="Cerrar"
                    className="ui-pressable flex items-center gap-1.5 rounded-lg bg-white/90 px-3 py-1.5 text-sm font-medium text-texto hover:bg-white"
                  >
                    <X className="size-4" aria-hidden="true" />
                    Cerrar
                  </button>
                </Dialog.Close>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
