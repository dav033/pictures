"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useRef, useState } from "react";
import { Check, Images, X } from "lucide-react";
import { useFocoDeRetorno } from "@/components/ui/foco-retorno";
import { DialogoEjemplos } from "@/components/ui/shell/GaleriaEjemplos";
import { SOLO_GUIADA } from "@/lib/solo-guiada";
import { FOTOS_BIBLIOTECA, type FotoBiblioteca } from "./fotos-biblioteca";
import { archivoDeFotoEjemplo, type FotoEjemplo } from "@/lib/referencias-ejemplo/manifiesto";

export const TEXTO_FOTOS_EJEMPLO = "o prueba con una de nuestras fotos";

/**
 * Espera a que el diálogo termine de cerrarse: Radix devuelve el foco al botón que lo abrió (`useFocoDeRetorno`) en
 * un momento propio, y si la foto llega antes, ese retorno le quita el foco a la caja de texto que `elegirFoto` enfocó
 * (navegador, 2026-10-07: tras elegir con Enter, el foco quedaba en el enlace y otro Enter volvía a abrir la galería).
 */
function focoDevuelto(boton: HTMLElement | null, limiteMs = 400): Promise<void> {
  return new Promise((resolver) => {
    const inicio = Date.now();
    // Con temporizador y no con requestAnimationFrame: en una pestaña oculta los cuadros no corren y la foto no entraba.
    const mirar = () => {
      const cerrado = !document.querySelector("[role='dialog']") && document.activeElement === boton;
      if (cerrado || Date.now() - inicio > limiteMs) resolver();
      else window.setTimeout(mirar, 20);
    };
    window.setTimeout(mirar, 0);
  });
}

type Props = {
  deshabilitado: boolean;
  /** La foto adjunta ahora en el compositor: la de ejemplo se marca como elegida solo mientras siga adjunta. */
  fotoActual: File | null;
  /**
   * El MISMO manejador que el adjunto del compositor (`elegirFoto` de VistaGuiada): la foto de ejemplo entra como un
   * archivo subido —mismo `File` (bytes, nombre y tipo del JPEG de `public/referencias-ejemplo/`), misma validación,
   * misma preparación (`prepararFotoReferencia`), misma lectura (`lecturas-ejemplos`, por huella) y mismo registro.
   */
  onFoto: (archivo: File) => void;
  onRegistrar: (evento: string, datos?: Record<string, unknown>) => void;
  onFallo: (foto: { id: string; titulo: string }, causa: unknown) => void;
};

/**
 * «o prueba con una de nuestras fotos» junto al chip de subir una foto de la guiada: abre la galería de la clásica
 * (`DialogoEjemplos` → `GaleriaEjemplos`, las 10 fotos del manifiesto), sin copiarla. Discreto: un enlace bajo los chips.
 */
export function FotosEjemploGuiada({ deshabilitado, fotoActual, onFoto, onRegistrar, onFallo }: Props) {
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [elegida, setElegida] = useState<{ id: string; archivo: File } | null>(null);
  const botonRef = useRef<HTMLButtonElement>(null);

  async function elegir(foto: FotoEjemplo): Promise<void> {
    if (cargando) return;
    onRegistrar("foto.ejemplo.elegir", { id: foto.id, titulo: foto.titulo, archivo: foto.archivo });
    // Se cierra antes de cargar y la foto entra cuando el foco ya volvió aquí: así `elegirFoto` lo lleva a la caja de
    // texto, como al subir una foto.
    setAbierto(false);
    setCargando(true);
    try {
      const [archivo] = await Promise.all([archivoDeFotoEjemplo(foto), focoDevuelto(botonRef.current)]);
      setElegida({ id: foto.id, archivo });
      onFoto(archivo);
    } catch (causa) {
      onFallo(foto, causa);
    } finally {
      setCargando(false);
    }
  }

  /** Producción: una foto real de la biblioteca entra igual que una subida (mismo `File`, misma validación y lectura). */
  async function elegirBiblioteca(foto: FotoBiblioteca): Promise<void> {
    if (cargando) return;
    onRegistrar("foto.biblioteca.elegir", { id: foto.id, titulo: foto.titulo });
    setAbierto(false);
    setCargando(true);
    try {
      const [archivo] = await Promise.all([archivoDeFotoBiblioteca(foto), focoDevuelto(botonRef.current)]);
      setElegida({ id: foto.id, archivo });
      onFoto(archivo);
    } catch (causa) {
      onFallo(foto, causa);
    } finally {
      setCargando(false);
    }
  }

  return (
    <>
      <button
        ref={botonRef}
        type="button"
        aria-haspopup="dialog"
        aria-busy={cargando || undefined}
        // Sin `disabled` mientras carga: el foco que devuelve el diálogo no se pierde en un botón deshabilitado.
        disabled={deshabilitado}
        onClick={() => { if (cargando) return; onRegistrar("foto.ejemplos.abrir"); setAbierto(true); }}
        className="-ml-1 inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full px-1 text-sm text-texto-suave underline decoration-borde underline-offset-4 transition-colors hover:text-acento hover:decoration-acento focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/40 disabled:opacity-50"
        data-testid="guiada-fotos-ejemplo"
      >
        <Images className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0">{cargando ? "Cargando la foto…" : TEXTO_FOTOS_EJEMPLO}</span>
      </button>
      {SOLO_GUIADA ? (
        <DialogoBiblioteca
          abierto={abierto}
          onCerrar={() => { onRegistrar("foto.ejemplos.cerrar"); setAbierto(false); }}
          onElegir={(foto) => void elegirBiblioteca(foto)}
          elegidaId={elegida && elegida.archivo === fotoActual ? elegida.id : null}
          deshabilitado={deshabilitado || cargando}
        />
      ) : (
      <DialogoEjemplos
        abierto={abierto}
        onCerrar={() => { onRegistrar("foto.ejemplos.cerrar"); setAbierto(false); }}
        onElegir={(foto) => void elegir(foto)}
        elegidaId={elegida && elegida.archivo === fotoActual ? elegida.id : null}
        deshabilitado={deshabilitado || cargando}
      />
      )}
    </>
  );
}

async function archivoDeFotoBiblioteca(foto: FotoBiblioteca): Promise<File> {
  const respuesta = await fetch(foto.url);
  if (!respuesta.ok) throw new Error(`No se pudo cargar la foto «${foto.titulo}».`);
  const blob = await respuesta.blob();
  const nombre = foto.url.slice(foto.url.lastIndexOf("/") + 1) || `${foto.id}.jpg`;
  return new File([blob], nombre, { type: blob.type || "image/jpeg" });
}

/**
 * Producción (`SOLO_GUIADA`): las fotos reales de la biblioteca Sempertex en lugar de las 10 de ejemplo de la clásica
 * (pedido del dueño, 2026-10-07). Mismo aspecto que `DialogoEjemplos`.
 */
function DialogoBiblioteca({ abierto, onCerrar, onElegir, elegidaId, deshabilitado }: { abierto: boolean; onCerrar: () => void; onElegir: (foto: FotoBiblioteca) => void; elegidaId: string | null; deshabilitado: boolean }) {
  const focoRetorno = useFocoDeRetorno();
  return (
    <Dialog.Root open={abierto} onOpenChange={(valor) => { if (!valor) onCerrar(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="hoja-fondo" />
        <Dialog.Content
          aria-describedby={undefined}
          {...focoRetorno}
          className="fixed left-1/2 top-1/2 z-[41] max-h-[calc(100dvh-2rem)] w-[min(52rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[1.25rem] border border-borde-suave bg-superficie p-5 shadow-[0_24px_60px_var(--sombra)] outline-none"
          data-testid="galeria-biblioteca"
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <Dialog.Title className="text-base font-semibold">Elige una de nuestras decoraciones</Dialog.Title>
            <Dialog.Close className="ui-icon-button" aria-label="Cerrar">
              <X className="size-4" aria-hidden="true" />
            </Dialog.Close>
          </div>
          <ul className="galeria mt-3.5" role="list">
            {FOTOS_BIBLIOTECA.map((foto, indice) => {
              const marcada = foto.id === elegidaId;
              return (
                <li key={foto.id} className="min-w-0">
                  <button
                    type="button"
                    aria-pressed={marcada}
                    disabled={deshabilitado}
                    onClick={() => onElegir(foto)}
                    className="galeria-item w-full disabled:cursor-not-allowed disabled:opacity-60"
                    style={{ animationDelay: `${0.2 + indice * 0.04}s` }}
                    data-testid={`biblioteca-${foto.id}`}
                  >
                    <span className="galeria-foto block">
                      {/* eslint-disable-next-line @next/next/no-img-element -- fotos estáticas de la biblioteca en public/ */}
                      <img src={foto.url} alt="" width={360} height={360} loading="lazy" decoding="async" />
                      {marcada && (
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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
