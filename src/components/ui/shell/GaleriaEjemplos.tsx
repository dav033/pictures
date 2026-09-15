"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useId } from "react";
import { Check, X } from "lucide-react";
import { MANIFIESTO_REFERENCIAS_EJEMPLO, urlMiniaturaEjemplo, type FotoEjemplo } from "@/lib/referencias-ejemplo/manifiesto";

type Props = {
  /** Recibe la miniatura clicada para animar su vuelo hasta el compositor. */
  onElegir: (foto: FotoEjemplo, miniatura: HTMLImageElement | null) => void;
  elegidaId?: string | null;
  deshabilitado?: boolean;
  /** Cuántas mostrar (la versión compacta del estado "foto sin globos" usa 3). */
  limite?: number;
  titulo?: string;
};

/**
 * Galería de fotos de ejemplo del estado inicial (maqueta EstadoInicial):
 * elegir una la adjunta como referencia, igual que subirla.
 */
export function GaleriaEjemplos({ onElegir, elegidaId = null, deshabilitado = false, limite, titulo = "¿No tienes foto? Prueba con una de estas" }: Props) {
  const tituloId = useId();
  const fotos = limite ? MANIFIESTO_REFERENCIAS_EJEMPLO.fotos.slice(0, limite) : MANIFIESTO_REFERENCIAS_EJEMPLO.fotos;
  return (
    <section aria-labelledby={tituloId} className="w-full" data-testid="galeria-ejemplos">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={tituloId} className="text-sm font-semibold">{titulo}</h2>
        <p className="text-xs text-texto-tenue">
          <a href="https://www.pexels.com/license/" target="_blank" rel="noopener noreferrer" className="hover:text-acento hover:underline">
            {MANIFIESTO_REFERENCIAS_EJEMPLO.credito}
          </a>
        </p>
      </div>
      <ul className="galeria mt-3.5" role="list">
        {fotos.map((foto, indice) => {
          const elegida = foto.id === elegidaId;
          return (
            <li key={foto.id} className="min-w-0">
              <button
                type="button"
                aria-pressed={elegida}
                disabled={deshabilitado}
                onClick={(evento) => onElegir(foto, evento.currentTarget.querySelector("img"))}
                className="galeria-item w-full disabled:cursor-not-allowed disabled:opacity-60"
                style={{ animationDelay: `${0.35 + indice * 0.07}s` }}
                data-testid={`ejemplo-${foto.id}`}
              >
                <span className="galeria-foto block">
                  {/* eslint-disable-next-line @next/next/no-img-element -- miniaturas estáticas ya optimizadas en public/ */}
                  <img src={urlMiniaturaEjemplo(foto)} alt="" width={360} height={360} loading="lazy" decoding="async" />
                  {elegida && (
                    <span className="galeria-check" aria-hidden="true">
                      <Check className="size-3" strokeWidth={3} />
                    </span>
                  )}
                </span>
                <span className="block min-w-0">
                  <span className="block text-[0.8125rem] font-medium leading-tight">{foto.titulo}</span>
                  <span className="mt-0.5 block text-xs text-texto-suave">{foto.evento}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * La misma galería en un diálogo: la abren los estados "foto sin globos" y
 * "no pude mirar tu foto" cuando la conversación ya empezó.
 */
export function DialogoEjemplos({ abierto, onCerrar, ...galeria }: Props & { abierto: boolean; onCerrar: () => void }) {
  return (
    <Dialog.Root open={abierto} onOpenChange={(valor) => { if (!valor) onCerrar(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="hoja-fondo" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-[41] max-h-[calc(100dvh-2rem)] w-[min(52rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[1.25rem] border border-borde-suave bg-superficie p-5 shadow-[0_24px_60px_var(--sombra)] outline-none"
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <Dialog.Title className="text-base font-semibold">Elige una foto de ejemplo</Dialog.Title>
            <Dialog.Close className="ui-icon-button" aria-label="Cerrar">
              <X className="size-4" aria-hidden="true" />
            </Dialog.Close>
          </div>
          <GaleriaEjemplos {...galeria} titulo="Fotos de decoraciones con globos" />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
