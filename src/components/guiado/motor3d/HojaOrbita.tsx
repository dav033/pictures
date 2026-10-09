"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { RotateCw, X } from "lucide-react";
import type { EscenaGlobos } from "@/components/tres-d/escena-globos";
import { escenaDesdeArmada } from "./desde-armada-compacta";
import { gestorDeLaPagina, type FirmaPlan } from "./gestor-vista";
import { perderContexto } from "./visor-compartido";

/**
 * **La hoja que gira** (REQ-007, fase 3): al tocar la vista del plan se abre una hoja con el visor en vivo, el ÚNICO
 * contexto WebGL vivo de la página (el visor sin pantalla se suelta antes de abrirlo). El cliente solo la gira; sin
 * cuadrícula, sin ayudas, sin elegir ni arrastrar piezas (D-020): es el visor del Taller con la sala neutra y nada más.
 *
 * Si el navegador pierde el contexto (`webglcontextlost`: memoria, otra pestaña, la GPU reiniciada) la hoja lo dice y deja
 * reintentar con un lienzo nuevo —uno que perdió el contexto no se puede reutilizar—, o seguir con la imagen fija.
 */
type Fase = "cargando" | "viva" | "perdida" | "error";

const TEXTO_FASE: Readonly<Record<Exclude<Fase, "cargando" | "viva">, string>> = {
  perdida: "El visor se detuvo (el navegador necesitó la memoria). Puedes volver a abrirlo o seguir con la imagen.",
  error: "No pude abrir el visor en este dispositivo. Sigue con la imagen de tu decoración.",
};

export function HojaOrbita({ firma, titulo, respaldo, onCerrar }: { firma: FirmaPlan; titulo: string; respaldo?: string; onCerrar: () => void }) {
  const [lienzo, setLienzo] = useState<HTMLCanvasElement | null>(null);
  const [fase, setFase] = useState<Fase>("cargando");
  const [intento, setIntento] = useState(0);
  // La hoja se abre para UN plan: aunque la tarjeta rehaga el objeto de su firma, el visor no se rehace por eso.
  const [firmaDeLaHoja] = useState(firma);

  useEffect(() => {
    if (!lienzo) return;
    let vivo = true;
    let visor: EscenaGlobos | null = null;
    let observador: ResizeObserver | null = null;
    const gestor = gestorDeLaPagina();
    // Un solo contexto vivo: el visor sin pantalla de las imágenes fijas se suelta (cuando termine lo que dibuja) y sus pedidos
    // esperan mientras la hoja está abierta.
    const ficha = gestor.suspenderVisor();
    const alPerderContexto = (evento: Event) => { evento.preventDefault(); if (vivo) setFase("perdida"); };
    lienzo.addEventListener("webglcontextlost", alPerderContexto);
    void (async () => {
      try {
        const [armada, { crearEscena }, { mostrarArmada }] = await Promise.all([gestor.armada(firmaDeLaHoja), import("@/components/tres-d/escena-globos"), import("@/components/tres-d/armada-visor"), ficha.listo]);
        if (!vivo) return;
        visor = crearEscena(lienzo);
        observador = new ResizeObserver(() => visor?.redimensionar());
        observador.observe(lienzo);
        const escena = escenaDesdeArmada(armada);
        mostrarArmada(visor, escena, escena.sala);
        setFase("viva");
      } catch {
        if (vivo) setFase("error");
      }
    })();
    return () => {
      vivo = false;
      observador?.disconnect();
      lienzo.removeEventListener("webglcontextlost", alPerderContexto);
      ficha.soltar();
      // Solo si hubo visor: perder el contexto de un lienzo que nunca lo tuvo crearía uno para perderlo.
      if (visor) {
        try { visor.destruir(); } catch { /* el visor ya estaba a medias */ }
        perderContexto(lienzo);
      }
    };
  }, [lienzo, firmaDeLaHoja, intento]);

  const sinVisor = fase === "perdida" || fase === "error";
  return (
    <Dialog.Root open onOpenChange={(abierta) => { if (!abierta) onCerrar(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content
          data-testid="hoja-orbita"
          aria-describedby="hoja-orbita-ayuda"
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col gap-2 rounded-t-3xl bg-superficie p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-2xl outline-none sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[min(40rem,92vw)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl"
        >
          <div className="flex items-center justify-between gap-2">
            <Dialog.Title className="text-base font-semibold text-texto">{titulo}</Dialog.Title>
            <Dialog.Close className="inline-flex size-11 items-center justify-center rounded-full text-texto-suave transition-colors hover:bg-superficie-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50" aria-label="Cerrar la vista">
              <X className="size-5" aria-hidden />
            </Dialog.Close>
          </div>
          <div className="relative aspect-square max-h-[68dvh] w-full overflow-hidden rounded-2xl bg-[#e6e6e9]">
            {/* `key`: un lienzo que perdió su contexto no sirve para otro; cada intento estrena el suyo. */}
            <canvas key={intento} ref={setLienzo} role="img" aria-label={`${titulo}: arrastra para girarla`} className={`size-full touch-none ${sinVisor ? "invisible" : ""}`} />
            {fase === "cargando" && <div className="brillo-carga absolute inset-0" role="status" aria-label="Abriendo la vista" />}
            {sinVisor && (
              <div className="absolute inset-0">
                {respaldo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={respaldo} alt={titulo} className="size-full object-contain" />
                )}
                <p role="status" className="absolute inset-x-2 bottom-2 rounded-xl bg-superficie/95 px-3 py-2 text-sm text-texto">{TEXTO_FASE[fase as "perdida" | "error"]}</p>
              </div>
            )}
          </div>
          <div className="flex items-center justify-between gap-2">
            <p id="hoja-orbita-ayuda" className="text-xs text-texto-suave">Arrastra para girarla y pellizca para acercar. Es solo para mirar.</p>
            {sinVisor && (
              <button type="button" onClick={() => { setFase("cargando"); setIntento((n) => n + 1); }} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-acento/40 px-3 text-sm font-semibold text-acento hover:bg-acento-suave focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50">
                <RotateCw className="size-4" aria-hidden />
                Volver a abrir
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
