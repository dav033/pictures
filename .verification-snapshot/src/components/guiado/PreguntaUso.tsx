"use client";

import { AnimatePresence, motion } from "motion/react";
import { BriefcaseBusiness, House } from "lucide-react";
import { DUR, grupoConRitmo } from "./animacion/movimiento";
import { PastillaEleccion, TarjetaAccion } from "./PreguntaPropuesta";

const OPCIONES = [
  { uso: "negocio", titulo: "Para mi negocio", detalle: "Precio editable con tus gastos y tu ganancia", Icono: BriefcaseBusiness },
  { uso: "personal", titulo: "Para uso personal", detalle: "Solo el costo de los materiales", Icono: House },
] as const;

type Props = {
  onElegir: (uso: "negocio" | "personal") => void;
  deshabilitado?: boolean;
  /** Sin pasar (o true): se puede elegir. false: queda en el historial como pastilla con lo elegido. */
  activo?: boolean;
  elegido?: "negocio" | "personal" | null;
};

export function PreguntaUso({ onElegir, deshabilitado, activo = true, elegido = null }: Props) {
  const titulo = elegido ? OPCIONES.find((opcion) => opcion.uso === elegido)?.titulo ?? null : null;
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      {activo ? (
        <motion.div
          key="opciones"
          layout
          variants={grupoConRitmo(0.05)}
          initial="oculto"
          animate="visible"
          exit={{ opacity: 0, transition: { duration: DUR.corta } }}
          className="mt-4 grid gap-3 sm:grid-cols-2"
          role="group"
          aria-label="Para qué es la decoración"
        >
          {OPCIONES.map(({ uso, titulo: nombre, detalle, Icono }) => (
            <TarjetaAccion key={uso} icono={<Icono className="size-5" />} titulo={nombre} detalle={detalle} deshabilitado={deshabilitado} onClick={() => onElegir(uso)} />
          ))}
        </motion.div>
      ) : titulo ? (
        <PastillaEleccion key="elegido" texto={titulo} />
      ) : null}
    </AnimatePresence>
  );
}
