"use client";

import { useCallback, type ReactNode, type RefObject } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, ImagePlus, Square, X } from "lucide-react";
import { RESORTE } from "./animacion/movimiento";
import { BotonVoz } from "../voz/BotonVoz";

type Props = {
  valor: string;
  onCambiar: (valor: string) => void;
  onEnviar: () => void;
  /** Dice qué escribir ahora («Cuéntame qué quieres cambiar…»): lo decide la vista según el paso. */
  placeholder: string;
  /** El asistente está respondiendo: el botón pasa a «Detener», pero se puede seguir escribiendo. */
  cargando: boolean;
  onDetener: () => void;
  /** Solo antes de hidratar o en un estado sin salida por escrito; NUNCA por «cargando». */
  deshabilitado: boolean;
  foto: File | null;
  onFoto: (archivo: File | null) => void;
  textoRef: RefObject<HTMLInputElement | null>;
  archivoRef: RefObject<HTMLInputElement | null>;
  /** Lo que va debajo de la caja (avisos breves). */
  pie?: ReactNode;
};

/** Caja de escritura fija abajo, con adjuntar foto y enviar/detener. */
export function Compositor({ valor, onCambiar, onEnviar, placeholder, cargando, onDetener, deshabilitado, foto, onFoto, textoRef, archivoRef, pie }: Props) {
  // Con una foto adjunta se puede enviar sin texto: la foto ya dice lo que el cliente quiere.
  const puedeEnviar = !cargando && !deshabilitado && (valor.trim().length > 0 || foto !== null);
  return (
    <div className="relative shrink-0 bg-fondo px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] before:pointer-events-none before:absolute before:inset-x-0 before:-top-6 before:h-6 before:bg-gradient-to-t before:from-fondo before:to-transparent sm:px-6">
      <form
        className="mx-auto w-full max-w-3xl"
        onSubmit={(evento) => { evento.preventDefault(); if (puedeEnviar) onEnviar(); }}
      >
        <div className="rounded-[1.25rem] border border-borde bg-superficie p-1.5 shadow-[0_8px_28px_var(--sombra)] transition-[border-color,box-shadow] duration-200 focus-within:border-acento focus-within:shadow-[0_0_0_4px_var(--sombra-acento)]">
          <AnimatePresence initial={false}>
            {foto && (
              <motion.div
                key="foto"
                initial={{ opacity: 0, scale: 0.8, height: 0 }}
                animate={{ opacity: 1, scale: 1, height: "auto" }}
                exit={{ opacity: 0, scale: 0.8, height: 0 }}
                transition={RESORTE}
                style={{ transformOrigin: "0% 100%" }}
                className="overflow-hidden px-1 pt-1"
              >
                <span className="inline-flex max-w-full items-center gap-2 rounded-xl bg-superficie-2 py-1 pl-1 text-xs text-texto">
                  <MiniaturaArchivo archivo={foto} />
                  <span className="min-w-0 truncate">{foto.name}</span>
                  <button type="button" aria-label="Quitar foto" onClick={() => onFoto(null)} className="-my-2 grid size-11 shrink-0 place-items-center rounded-full text-texto-suave hover:text-texto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50">
                    <X className="size-4" aria-hidden />
                  </button>
                </span>
              </motion.div>
            )}
          </AnimatePresence>
          <div className="flex items-center gap-1">
            <input
              ref={archivoRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(evento) => { onFoto(evento.target.files?.[0] ?? null); evento.target.value = ""; }}
            />
            <button
              type="button"
              aria-label="Adjuntar foto de inspiración"
              title="Adjuntar foto de inspiración"
              disabled={deshabilitado}
              onClick={() => archivoRef.current?.click()}
              className="grid size-11 shrink-0 place-items-center rounded-full text-texto-suave transition-colors hover:bg-superficie-2 hover:text-texto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50 disabled:opacity-50"
            >
              <ImagePlus className="size-5" aria-hidden />
            </button>
            <input
              ref={textoRef}
              id="compositor-guiado-mensaje"
              aria-label="Escribe tu mensaje"
              value={valor}
              maxLength={6000}
              enterKeyHint="send"
              autoComplete="off"
              onChange={(evento) => onCambiar(evento.target.value)}
              placeholder={placeholder}
              disabled={deshabilitado}
              // compositor-input: la excepción de foco fuera de capa (globals.css) le gana a la regla global de :focus-visible,
              // que con `outline-none` no se iba y pintaba un rectángulo dentro de la caja; el anillo lo da su focus-within.
              className="compositor-input min-w-0 flex-1 bg-transparent px-1.5 py-2 text-base text-texto placeholder:text-texto-tenue disabled:opacity-60"
            />
            <BotonVoz campoId="compositor-guiado-mensaje" alTexto={onCambiar} deshabilitado={deshabilitado} variante="cliente" clase="grid size-11 shrink-0 place-items-center rounded-full text-texto-suave transition-colors hover:bg-superficie-2 hover:text-texto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50 disabled:opacity-50" />
            <AnimatePresence mode="popLayout" initial={false}>
              {cargando ? (
                <motion.button
                  key="detener"
                  type="button"
                  aria-label="Detener respuesta"
                  title="Detener respuesta"
                  onClick={onDetener}
                  initial={{ opacity: 0, rotate: -90, scale: 0.8 }}
                  animate={{ opacity: 1, rotate: 0, scale: 1 }}
                  exit={{ opacity: 0, rotate: 90, scale: 0.8 }}
                  transition={{ duration: 0.15 }}
                  whileTap={{ scale: 0.9 }}
                  className="grid size-11 shrink-0 place-items-center rounded-full bg-texto text-fondo focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50 focus-visible:ring-offset-2 focus-visible:ring-offset-superficie"
                >
                  <Square className="size-3.5 fill-current" aria-hidden />
                </motion.button>
              ) : (
                <motion.button
                  key="enviar"
                  type="submit"
                  aria-label="Enviar mensaje"
                  disabled={!puedeEnviar}
                  initial={{ opacity: 0, rotate: 90, scale: 0.8 }}
                  animate={{ opacity: puedeEnviar ? 1 : 0.4, rotate: 0, scale: puedeEnviar ? [0.9, 1] : 1 }}
                  exit={{ opacity: 0, rotate: -90, scale: 0.8 }}
                  transition={{ duration: 0.15 }}
                  whileTap={puedeEnviar ? { scale: 0.9 } : undefined}
                  className="grid size-11 shrink-0 place-items-center rounded-full bg-acento text-sobre-acento transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50 focus-visible:ring-offset-2 focus-visible:ring-offset-superficie disabled:opacity-40"
                >
                  <ArrowUp className="size-5" aria-hidden />
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </div>
        {pie && <div className="mt-2 text-center text-xs text-texto-suave">{pie}</div>}
      </form>
    </div>
  );
}

/** Miniatura de 28 px del archivo elegido; la URL temporal se libera al quitar la foto (cleanup de ref de React 19). */
function MiniaturaArchivo({ archivo }: { archivo: File }) {
  const conectar = useCallback((imagen: HTMLImageElement | null) => {
    if (!imagen) return;
    const url = URL.createObjectURL(archivo);
    imagen.src = url;
    return () => URL.revokeObjectURL(url);
  }, [archivo]);
  // eslint-disable-next-line @next/next/no-img-element -- URL local temporal (blob:), no pasa por el optimizador
  return <img ref={conectar} alt="" className="size-7 shrink-0 rounded-lg object-cover" />;
}
