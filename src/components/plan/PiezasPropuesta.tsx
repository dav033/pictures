"use client";

/* Catalog images come from runtime URLs and already carry explicit dimensions. */
/* eslint-disable @next/next/no-img-element */

import { motion, useReducedMotion, type Variants } from "motion/react";
import type { EstructuraOficialId } from "@/lib/plan/estructuras-oficiales";
import type { MuestraColor } from "@/lib/plan/presentacion-cliente";
import { IconoEstructura } from "./IconoEstructura";
import { RecortePieza } from "@/components/referencia/RecortePieza";
import type { CajaNormalizada } from "@/components/referencia/recorte";
import { NumeroAnimado } from "@/components/propuesta/NumeroAnimado";
import { MuestrasColor } from "@/components/propuesta/MuestrasColor";
import type { PatronColorResuelto } from "@/lib/plan/patron-color";
import { MiniPatron } from "./patron/MiniPatron";
import type { ColorLeyenda } from "./patron/leyenda";

export const ENTRADA_CASCADA: Variants = {
  oculto: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.23, 1, 0.32, 1] } },
};

export type PiezaPropuestaVista = {
  id: string;
  numero: number;
  oficialId?: EstructuraOficialId;
  espejo: boolean;
  /** "Semiarco", "2 columnas". */
  titulo: string;
  /** "Izquierda · 1,6 × 2,4 m". */
  subtitulo: string;
  globos: number;
  unidad: "globos" | "piezas";
  colores: MuestraColor[];
  recorte: { src: string; caja: CajaNormalizada; alt: string } | null;
  /** Applied color pattern: the card shows its strip instead of loose color dots. */
  patron?: { resuelto: PatronColorResuelto; leyenda: readonly ColorLeyenda[] };
};

/** The pattern strip with its name, or the piece's colors when it has no pattern. */
function ColoresPieza({ pieza, retraso, className = "" }: { pieza: PiezaPropuestaVista; retraso?: number; className?: string }) {
  if (!pieza.patron) return <MuestrasColor muestras={pieza.colores} retraso={retraso} className={className} etiqueta={`Colores de ${pieza.titulo}`} />;
  return (
    <span className={`flex min-w-0 items-center gap-2 ${className}`}>
      <MiniPatron resuelto={pieza.patron.resuelto} leyenda={pieza.patron.leyenda} className="h-7 w-auto max-w-[7.5rem] shrink-0" />
      <span className="truncate text-xs font-medium text-texto-suave">{pieza.patron.resuelto.nombre}</span>
    </span>
  );
}

type PropsTarjeta = {
  pieza: PiezaPropuestaVista;
  retraso: number;
  controles: string;
  onAbrir: () => void;
};

/**
 * A piece of the proposal next to the real crop of the customer's photo
 * (maqueta Main / PropuestaMovil). Without a crop it shows the structure icon
 * in the same frame. Opens the structure detail.
 */
export function TarjetaPiezaFoto({ pieza, retraso, controles, onAbrir }: PropsTarjeta) {
  const reducir = useReducedMotion();
  return (
    <motion.li variants={ENTRADA_CASCADA} className="min-w-0">
      <button
        type="button"
        onClick={onAbrir}
        aria-controls={controles}
        className="group flex h-full w-full flex-col gap-2.5 rounded-2xl border border-borde-suave bg-superficie-suave p-2 text-left transition-colors hover:border-borde focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento @xl:flex-row @xl:gap-3.5 @xl:p-2.5"
      >
        <span className="relative block aspect-[5/6] w-full shrink-0 overflow-hidden rounded-xl bg-superficie-2 @xl:aspect-auto @xl:h-41 @xl:w-28">
          {pieza.recorte ? (
            <RecortePieza src={pieza.recorte.src} caja={pieza.recorte.caja} alt={pieza.recorte.alt} retraso={retraso + 0.25} className="absolute inset-0 size-full" />
          ) : (
            <span className="absolute inset-0 grid place-items-center text-acento">
              {pieza.oficialId ? <IconoEstructura id={pieza.oficialId} espejo={pieza.espejo} className="w-3/5 max-w-20" /> : <span aria-hidden className="size-4 rounded-full bg-acento/60" />}
            </span>
          )}
          <span className="absolute left-2 top-2 grid size-5.5 place-items-center" aria-hidden="true">
            {!reducir && (
              <motion.span
                className="absolute inset-0 rounded-full bg-white"
                initial={{ scale: 1, opacity: 0.7 }}
                animate={{ scale: 2.6, opacity: 0 }}
                transition={{ duration: 2.4, delay: retraso + 0.8, repeat: 2, ease: [0, 0, 0.2, 1] }}
              />
            )}
            <span className="relative grid size-5.5 place-items-center rounded-full border-[1.5px] border-white bg-acento text-xs font-semibold text-sobre-acento">{pieza.numero}</span>
          </span>
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1.5 px-1 pb-1 @xl:gap-2.5 @xl:px-0 @xl:py-1">
          <span className="block min-w-0">
            <span className="block truncate text-[15px] font-semibold text-texto">{pieza.titulo}</span>
            <span className="mt-px block truncate text-[13px] text-texto-suave">{pieza.subtitulo}</span>
          </span>
          <span className="flex items-baseline gap-1.5">
            <span className="text-xs text-texto-suave">unos</span>
            <NumeroAnimado valor={pieza.globos} retraso={retraso + 0.3} className="text-xl leading-none font-semibold tracking-tight tabular-nums text-texto @xl:text-[28px]" />
            <span className="text-xs text-texto-suave">{pieza.unidad}</span>
          </span>
          <ColoresPieza pieza={pieza} retraso={retraso + 0.4} />
        </span>
      </button>
    </motion.li>
  );
}

/** Compact structure chip for proposals without a reference photo (maqueta ChatNormal). */
export function ChipEstructura({ pieza, controles, onAbrir }: Omit<PropsTarjeta, "retraso">) {
  return (
    <motion.li variants={ENTRADA_CASCADA} className="min-w-0">
      <button
        type="button"
        onClick={onAbrir}
        aria-controls={controles}
        className="flex h-full w-full items-center gap-3 rounded-2xl bg-superficie-suave p-3 text-left ring-1 ring-borde-suave ring-inset hover:ring-borde focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento"
      >
        <span className="grid size-9 shrink-0 place-items-center text-acento">
          {pieza.oficialId ? <IconoEstructura id={pieza.oficialId} espejo={pieza.espejo} className="size-9" /> : <span aria-hidden className="size-3 rounded-full bg-acento/60" />}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-texto">{pieza.titulo}</span>
          <span className="block truncate text-xs text-texto-suave">{pieza.subtitulo}</span>
          <ColoresPieza pieza={pieza} className="mt-1.5" />
        </span>
      </button>
    </motion.li>
  );
}

export type ProductoPropuestaVista = {
  clave: string;
  nombre: string;
  imagen?: string;
  unidades: number;
  tamanos: string;
  alt: string;
};

/** Real catalog product used by the proposal, with its photo and how many balloons go in. */
export function TarjetaProducto({ producto, indice }: { producto: ProductoPropuestaVista; indice: number }) {
  const reducir = useReducedMotion();
  return (
    <motion.li variants={ENTRADA_CASCADA} className="flex min-w-0 items-center gap-3 rounded-2xl border border-borde-suave p-2 pr-3">
      <motion.span
        className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-white"
        animate={reducir ? undefined : { y: [0, -3, 0] }}
        transition={{ duration: 3.2, repeat: 3, ease: "easeInOut", delay: indice * 0.4 }}
      >
        {producto.imagen ? <img src={producto.imagen} alt={producto.alt} width={56} height={56} loading="lazy" className="size-full object-contain" /> : <span aria-hidden className="size-full bg-superficie-2" />}
      </motion.span>
      <span className="min-w-0">
        <span className="line-clamp-2 text-[13px] leading-snug font-medium text-texto">{producto.nombre}</span>
        <span className="mt-0.5 block text-xs text-texto-suave">
          <NumeroAnimado valor={producto.unidades} retraso={0.6 + indice * 0.1} className="font-semibold tabular-nums text-texto" /> globos · {producto.tamanos}
        </span>
      </span>
    </motion.li>
  );
}
