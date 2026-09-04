"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";

/** Visor de imagen a pantalla casi completa -- para revisar de cerca (acabado, si es escena
 * real o de estudio, etc). Sin panel de datos al lado, solo la imagen lo más grande posible. */
export function VisorImagenCompleta({
  src,
  alt,
  abierto,
  onCerrar,
}: {
  src: string | null;
  alt: string;
  abierto: boolean;
  onCerrar: () => void;
}) {
  return (
    <Dialog.Root open={abierto} onOpenChange={(o) => { if (!o) onCerrar(); }}>
      <AnimatePresence>
        {abierto && src && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="fixed inset-0 z-[60] bg-black/85"
              />
            </Dialog.Overlay>
            <Dialog.Content
              forceMount
              className="fixed inset-0 z-[60] flex items-center justify-center p-3 outline-none"
              onClick={onCerrar}
            >
              <Dialog.Title className="sr-only">{alt}</Dialog.Title>
              <Dialog.Description className="sr-only">Imagen a pantalla completa.</Dialog.Description>
              <motion.div
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ duration: 0.15 }}
                className="relative flex max-h-full max-w-full items-center justify-center"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- foto vive fuera de /public */}
                <img
                  src={src}
                  alt={alt}
                  onClick={(e) => e.stopPropagation()}
                  className="max-h-[96vh] max-w-[96vw] cursor-default rounded-lg object-contain shadow-2xl"
                />
                <Dialog.Close asChild>
                  <button
                    type="button"
                    aria-label="Cerrar"
                    className="absolute -right-2 -top-2 rounded-full bg-black/70 p-1.5 text-white hover:bg-black"
                  >
                    <X className="size-4" aria-hidden="true" />
                  </button>
                </Dialog.Close>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
