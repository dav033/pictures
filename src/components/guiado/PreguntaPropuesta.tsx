"use client";

import type { ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Circle, LayoutGrid, Sparkles } from "lucide-react";
import { IconoEstructura } from "@/components/plan/IconoEstructura";
import type { EstructuraOficialId } from "@/lib/plan/estructuras-oficiales";
import { DUR, EASE_SALIDA, RESORTE, grupoConRitmo, hijoEscalonado } from "./animacion/movimiento";

export type PiezaIndividual = { etiqueta: string; estructura: EstructuraOficialId | null };

/** Las piezas sueltas que se ofrecen; «La que tú quieras» deja que el asistente elija. */
export const PIEZAS_INDIVIDUALES: readonly PiezaIndividual[] = [
  { etiqueta: "Arco orgánico", estructura: "arco_asimetrico" },
  { etiqueta: "Columna", estructura: "columna" },
  { etiqueta: "Guirnalda", estructura: "guirnalda" },
  { etiqueta: "Semiarco", estructura: "semiarco" },
  { etiqueta: "Pared de globos", estructura: "pared_densa" },
  { etiqueta: "Bouquet", estructura: "bouquet" },
  { etiqueta: "La que tú quieras", estructura: null },
];

type Props = {
  alcance: "tipo" | "pieza";
  /** Solo la pregunta vigente se puede contestar; en el historial queda la respuesta como pastilla. */
  activo: boolean;
  deshabilitado: boolean;
  /** Lo que el cliente eligió («Decoración completa», «Columna»…), o null si siguió por otro camino. */
  elegida: string | null;
  onTipo: (tipo: "completa" | "individual") => void;
  onPieza: (pieza: PiezaIndividual) => void;
};

/** «¿Decoración completa o pieza individual?» y, después, «¿Qué pieza?». */
export function PreguntaPropuesta({ alcance, activo, deshabilitado, elegida, onTipo, onPieza }: Props) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      {activo ? (
        <motion.div key="opciones" layout exit={{ opacity: 0, scale: 0.98, transition: { duration: DUR.corta } }}>
          {alcance === "tipo" ? (
            <motion.div variants={grupoConRitmo(0.05)} initial="oculto" animate="visible" className="mt-3 grid gap-3 sm:grid-cols-2" role="group" aria-label="Qué tipo de decoración">
              <TarjetaAccion icono={<LayoutGrid className="size-5" />} titulo="Decoración completa" detalle="Varias piezas que combinan" deshabilitado={deshabilitado} onClick={() => onTipo("completa")} />
              <TarjetaAccion icono={<Circle className="size-5" />} titulo="Pieza individual" detalle="Un arco, una columna…" deshabilitado={deshabilitado} onClick={() => onTipo("individual")} />
            </motion.div>
          ) : (
            <motion.div variants={grupoConRitmo(0.04)} initial="oculto" animate="visible" className="mt-3 grid grid-cols-2 gap-2.5" role="group" aria-label="Qué pieza">
              {PIEZAS_INDIVIDUALES.map((pieza) => (
                <TarjetaAccion
                  key={pieza.etiqueta}
                  compacta
                  icono={pieza.estructura ? <IconoEstructura id={pieza.estructura} className="h-6 w-7" /> : <Sparkles className="size-5" />}
                  titulo={pieza.etiqueta}
                  deshabilitado={deshabilitado}
                  onClick={() => onPieza(pieza)}
                />
              ))}
            </motion.div>
          )}
        </motion.div>
      ) : elegida ? (
        <PastillaEleccion key="elegida" texto={elegida} />
      ) : null}
    </AnimatePresence>
  );
}

type PropsTarjetaAccion = {
  icono: ReactNode;
  titulo: string;
  detalle?: string;
  deshabilitado?: boolean;
  /** Ya la usó el cliente: lleva un check pequeño. */
  hecha?: boolean;
  /** Versión baja, para rejillas de 2 columnas a 390 px. */
  compacta?: boolean;
  onClick: () => void;
};

/** Tarjeta-botón común a las preguntas con opciones (tipo de decoración, qué hacer, para qué es). */
export function TarjetaAccion({ icono, titulo, detalle, deshabilitado, hecha, compacta, onClick }: PropsTarjetaAccion) {
  return (
    <motion.button
      type="button"
      variants={hijoEscalonado}
      whileHover={deshabilitado ? undefined : { y: -2 }}
      whileTap={deshabilitado ? undefined : { scale: 0.98 }}
      transition={RESORTE}
      disabled={deshabilitado}
      onClick={onClick}
      className={`group relative flex min-h-11 text-left ${compacta ? "flex-row items-center gap-2.5 p-3" : "flex-col items-start gap-2 p-4"} rounded-2xl border border-borde-suave bg-superficie text-texto shadow-[0_1px_2px_var(--sombra)] transition-[border-color,box-shadow] hover:border-acento/60 hover:shadow-[0_8px_24px_var(--sombra)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50 focus-visible:ring-offset-2 focus-visible:ring-offset-fondo disabled:pointer-events-none disabled:opacity-50`}
    >
      <span className={`grid shrink-0 place-items-center rounded-xl bg-acento-suave text-acento transition-transform group-hover:-rotate-3 group-hover:scale-110 ${compacta ? "size-9" : "size-10"}`} aria-hidden>{icono}</span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold leading-tight">{titulo}</span>
        {detalle && <span className="mt-0.5 block text-xs text-texto-suave">{detalle}</span>}
      </span>
      {hecha && (
        <span className="absolute right-2 top-2 grid size-5 place-items-center rounded-full bg-exito-suave text-exito" aria-label="Ya lo viste">
          <Check className="size-3" aria-hidden />
        </span>
      )}
    </motion.button>
  );
}

/** Lo que el cliente eligió en una pregunta ya contestada, en una pastilla. */
export function PastillaEleccion({ texto }: { texto: string }) {
  return (
    <motion.span
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: DUR.media, ease: EASE_SALIDA }}
      className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-acento-suave px-3 py-1 text-xs font-medium text-acento"
    >
      <Check className="size-3.5" aria-hidden />
      {texto}
    </motion.span>
  );
}
