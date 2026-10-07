"use client";

import { useRef, useState } from "react";
import { Images } from "lucide-react";
import { DialogoEjemplos } from "@/components/ui/shell/GaleriaEjemplos";
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
  onFallo: (foto: FotoEjemplo, causa: unknown) => void;
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
      <DialogoEjemplos
        abierto={abierto}
        onCerrar={() => { onRegistrar("foto.ejemplos.cerrar"); setAbierto(false); }}
        onElegir={(foto) => void elegir(foto)}
        elegidaId={elegida && elegida.archivo === fotoActual ? elegida.id : null}
        deshabilitado={deshabilitado || cargando}
      />
    </>
  );
}
