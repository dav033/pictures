"use client";

import { AnimatePresence, motion } from "motion/react";
import { Calculator, GraduationCap, ShoppingBag, UserRound } from "lucide-react";
import { DUR, grupoConRitmo } from "./animacion/movimiento";
import { PastillaEleccion, TarjetaAccion } from "./PreguntaPropuesta";

export const OPCIONES_GUIADAS = [
  { id: "costear", titulo: "Cuánto cuesta", detalle: "El precio de los globos", Icono: Calculator },
  { id: "comprar", titulo: "Comprar", detalle: "En línea o en un distribuidor", Icono: ShoppingBag },
  { id: "aprender", titulo: "Aprender a hacerlo", detalle: "Paso a paso", Icono: GraduationCap },
  { id: "contratar", titulo: "Contratar un decorador", detalle: "Expertos cerca de ti", Icono: UserRound },
] as const;

export type OpcionGuiada = (typeof OPCIONES_GUIADAS)[number]["id"];

type Props = {
  onElegir: (opcion: OpcionGuiada) => void;
  deshabilitado?: boolean;
  /** Sin pasar (o true): se puede elegir. false: queda en el historial como pastilla con lo elegido. */
  activo?: boolean;
  elegida?: OpcionGuiada | null;
  /** Opciones que el cliente ya usó: llevan un check pequeño. */
  hechas?: readonly OpcionGuiada[];
};

/** «¿Qué te gustaría hacer ahora?» tras elegir una idea. */
export function ChipsOpciones({ onElegir, deshabilitado, activo = true, elegida = null, hechas = [] }: Props) {
  const titulo = elegida ? OPCIONES_GUIADAS.find((opcion) => opcion.id === elegida)?.titulo ?? null : null;
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
          className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4"
          role="group"
          aria-label="Qué quieres hacer"
        >
          {OPCIONES_GUIADAS.map(({ id, titulo: nombre, detalle, Icono }) => (
            <TarjetaAccion key={id} icono={<Icono className="size-5" />} titulo={nombre} detalle={detalle} deshabilitado={deshabilitado} hecha={hechas.includes(id)} onClick={() => onElegir(id)} />
          ))}
        </motion.div>
      ) : titulo ? (
        <PastillaEleccion key="elegida" texto={titulo} />
      ) : null}
    </AnimatePresence>
  );
}
