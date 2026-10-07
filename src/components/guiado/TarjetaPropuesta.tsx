"use client";

import { AnimatePresence, motion } from "motion/react";
import { IconoEstructura } from "@/components/plan/IconoEstructura";
import { ESTRUCTURAS_OFICIALES, type EstructuraOficialId } from "@/lib/plan/estructuras-oficiales";
import { nombresIndividuales } from "@/lib/plan/piezas-individuales";
import { EsqueletoPlan, type EtapaPlan } from "./Esqueletos";
import { colorSempertex } from "./color-sempertex";
import { DUR, EASE_SALIDA, grupoConRitmo, hijoEscalonado } from "./animacion/movimiento";

type Props = {
  frase: string;
  piezas: ReadonlyArray<{ estructura: EstructuraOficialId; cantidad: number; nombre?: string }>;
  colores: readonly string[];
  /** «resolviendo»: el plan se está preparando (esqueleto con etapas). «fallo»: no se pudo; el reintento lo pone la vista. */
  estado: "resolviendo" | "fallo";
  etapa?: EtapaPlan;
};

/** La idea que el asistente propone (piezas y colores) mientras se convierte en un plan con cantidades. */
export function TarjetaPropuesta({ frase, piezas, colores, estado, etapa = "preparando" }: Props) {
  return (
    <div className="mt-3 w-full">
      <motion.article
        variants={grupoConRitmo(0.06)}
        initial="oculto"
        animate="visible"
        className="rounded-3xl border border-borde-suave bg-superficie p-4 shadow-[0_1px_2px_var(--sombra)] sm:p-5"
        aria-label="Una idea para tu celebración"
      >
        <motion.p variants={hijoEscalonado} className="text-xs font-semibold uppercase tracking-wide text-acento">Una idea para tu celebración</motion.p>
        <motion.p variants={hijoEscalonado} className="mt-1.5 text-sm text-texto">{frase}</motion.p>
        <motion.ul variants={hijoEscalonado} className="mt-3 flex flex-wrap gap-2">
          {/* Piezas SIEMPRE individuales, como saldrán en «Tu plan»: «Columna izquierda» y «Columna derecha», no «2 × Columna». */}
          {piezas.flatMap((pieza) => (pieza.cantidad > 1
            ? nombresIndividuales(pieza.estructura, pieza.cantidad)
            : [pieza.nombre ?? ESTRUCTURAS_OFICIALES[pieza.estructura].nombre]).map((nombre) => ({ estructura: pieza.estructura, nombre }))).map((pieza, indice) => (
            <li key={`${pieza.estructura}-${indice}`} className="inline-flex items-center gap-2 rounded-full bg-superficie-suave py-1 pl-1.5 pr-3 text-sm text-texto ring-1 ring-borde-suave">
              <span className="grid size-7 place-items-center rounded-full bg-acento-suave text-acento" aria-hidden><IconoEstructura id={pieza.estructura} className="h-4 w-5" /></span>
              {pieza.nombre}
            </li>
          ))}
        </motion.ul>
        {colores.length > 0 && (
          <motion.div variants={hijoEscalonado} className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5" aria-label={`Colores: ${colores.map((color) => colorSempertex(color).nombre).join(", ")}`}>
            {/* Nombre y tono de la fuente única (color-sempertex): los mismos que verá en «Tu plan». */}
            {colores.map((color) => {
              const sempertex = colorSempertex(color);
              return (
                <span key={color} className="inline-flex items-center gap-1.5 text-xs text-texto-suave">
                  <span className="size-4 rounded-full ring-1 ring-borde" style={{ backgroundColor: sempertex.hex }} aria-hidden />
                  {sempertex.nombre}
                </span>
              );
            })}
          </motion.div>
        )}
        <AnimatePresence initial={false}>
          {estado === "fallo" && (
            <motion.p key="fallo" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: DUR.media, ease: EASE_SALIDA }} className="mt-3 overflow-hidden text-sm font-medium text-error">
              No pude terminar este plan.
            </motion.p>
          )}
        </AnimatePresence>
      </motion.article>
      <AnimatePresence initial={false}>
        {estado === "resolviendo" && (
          <motion.div key="esqueleto" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: DUR.corta } }} transition={{ duration: DUR.media, ease: EASE_SALIDA }}>
            <EsqueletoPlan etapa={etapa} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
