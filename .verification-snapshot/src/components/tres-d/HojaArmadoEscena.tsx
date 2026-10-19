"use client";

import { useMemo } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Printer, X } from "lucide-react";
import type { Escena, EscenaArmada } from "@/lib/globos3d/escena";
import { textoTiempo, type CalibracionBomba } from "@/lib/globos3d/bomba-segundos";
import { hojaDeEscena, paginasDeHoja, type HojaArmado } from "@/lib/globos3d/hoja-armado";
import { useFocoDeRetorno } from "@/components/ui/foco-retorno";
import { HojaArmadoPagina } from "./HojaArmadoPagina";

/**
 * La hoja de armado de la escena: las estructuras (las iguales juntas), la tabla de piezas pequeñas y la lista de compra al
 * final. Exportada para `scripts/ops/medir-hoja-armado.ts`, que la mide y la imprime tal cual.
 */
export function HojaImprimible({ hoja }: { hoja: HojaArmado }) {
  const paginas = useMemo(() => paginasDeHoja(hoja), [hoja]);
  return (
    <div className="flex flex-col gap-8 text-neutral-900 [print-color-adjust:exact] [-webkit-print-color-adjust:exact]">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-widest text-neutral-500">Hoja de armado · Taller 3D</p>
        <h2 className="text-2xl font-bold">{hoja.nombre}</h2>
        <p className="font-mono text-sm">{hoja.piezas} {hoja.piezas === 1 ? "pieza" : "piezas"} · {hoja.globos} {hoja.globos === 1 ? "globo" : "globos"} · bomba {textoTiempo(hoja.segundosBomba)}</p>
        {hoja.avisos.length > 0 && <p className="text-sm text-red-700" role="note">{hoja.avisos.join(" ")}</p>}
      </header>
      {hoja.estructuras.length === 0 && hoja.compactas.length === 0 && <p className="text-sm">La escena no tiene globos todavía.</p>}
      {paginas.map((pagina) => <HojaArmadoPagina key={pagina.numero} pagina={pagina} total={paginas.length} segundosBomba={hoja.segundosBomba} />)}
    </div>
  );
}

type Props = { abierta: boolean; onCerrar: () => void; nombre: string; escena: Escena; armada: EscenaArmada; calibracion: CalibracionBomba };

/**
 * El diálogo de la hoja de armado, para imprimir. Va en un portal hijo directo de `<body>` y NUNCA dentro de un `<dialog>`
 * nativo abierto con `showModal()` (la lista de compra): la capa superior del navegador dejaría la hoja inerte y «Imprimir» no
 * respondería. Por eso lo abre `DialogoCompra`, que cierra la lista antes. La impresión deja solo la hoja (las reglas
 * `@media print` de `globals.css` sobre `hoja-armado-dialogo`); la hoja se calcula solo al abrirla.
 */
export function HojaArmadoEscena({ abierta, onCerrar, nombre, escena, armada, calibracion }: Props) {
  const focoRetorno = useFocoDeRetorno();
  const hoja = useMemo(() => (abierta ? hojaDeEscena(nombre, escena, armada, calibracion) : null), [abierta, nombre, escena, armada, calibracion]);
  return (
    <Dialog.Root open={abierta} onOpenChange={(abrir) => { if (!abrir) onCerrar(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="hoja-armado-fondo fixed inset-0 z-[60] bg-overlay backdrop-blur-[2px]" />
        <Dialog.Content
          {...focoRetorno}
          aria-describedby={undefined}
          className="hoja-armado-dialogo fixed inset-0 z-[60] flex flex-col overflow-hidden bg-superficie md:inset-x-4 md:inset-y-6 md:mx-auto md:max-w-4xl md:rounded-3xl md:border md:border-borde-suave md:shadow-[0_24px_64px_var(--sombra)]"
        >
          <div className="hoja-armado-no-imprimir flex items-center justify-between gap-3 border-b border-borde-suave px-4 py-3 md:px-6">
            <Dialog.Title className="text-base font-semibold text-texto">Hoja de armado</Dialog.Title>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => window.print()} className="ui-button-primary ui-pressable h-10">
                <Printer className="size-4" aria-hidden />Imprimir
              </button>
              <Dialog.Close aria-label="Cerrar hoja de armado" className="grid size-10 place-items-center rounded-xl bg-acento-suave text-texto hover:text-acento focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento">
                <X className="size-4" aria-hidden />
              </Dialog.Close>
            </div>
          </div>
          <div tabIndex={0} role="region" aria-label="Contenido de la hoja de armado" className="hoja-armado-scroll scroll-suave min-h-0 flex-1 overflow-y-auto bg-white px-4 py-5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-acento md:px-8 md:py-6">
            {hoja && <HojaImprimible hoja={hoja} />}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
