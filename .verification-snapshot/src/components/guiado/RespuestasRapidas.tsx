"use client";

import { AnimatePresence, motion } from "motion/react";
import { Check, Sparkles } from "lucide-react";
import { claveTexto } from "./formato";
import { DUR, RESORTE, grupoConRitmo, hijoEscalonado } from "./animacion/movimiento";

type Props = {
  opciones: readonly string[];
  onElegir: (texto: string) => void;
  deshabilitado?: boolean;
  /** Opciones que invitan a seguir («Propónme algo»): van al final, en color de acento y con un destello. */
  destacadas?: readonly string[];
  /** La que el cliente pulsó: queda marcada y las demás se retiran. */
  elegida?: string | null;
};

/**
 * Botones de respuesta rápida para la pregunta que el asistente acaba de hacer. Pulsar uno envía su texto tal
 * cual, como si el cliente lo hubiera escrito; escribir otra cosa sigue siendo posible.
 */
export function RespuestasRapidas({ opciones, onElegir, deshabilitado, destacadas = [], elegida = null }: Props) {
  const unicas = dedupeOpciones(opciones);
  if (!unicas.length) return null;
  const claveDestacadas = new Set(destacadas.map(claveTexto));
  const ordenadas = [...unicas.filter((opcion) => !claveDestacadas.has(claveTexto(opcion))), ...unicas.filter((opcion) => claveDestacadas.has(claveTexto(opcion)))];
  const visibles = elegida ? ordenadas.filter((opcion) => claveTexto(opcion) === claveTexto(elegida)) : ordenadas;
  const carril = visibles.length > 4;
  return (
    <motion.div
      variants={grupoConRitmo(0.04, 0.04)}
      initial="oculto"
      animate="visible"
      role="group"
      aria-label="Respuestas rápidas"
      className={`mt-3 flex gap-2 ${carril ? "flex-nowrap snap-x overflow-x-auto pb-1 [mask-image:linear-gradient(to_right,black_calc(100%-24px),transparent)] [scrollbar-width:none] sm:flex-wrap sm:overflow-visible sm:pb-0 sm:[mask-image:none]" : "flex-wrap"}`}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {visibles.map((opcion) => {
          const destacada = claveDestacadas.has(claveTexto(opcion));
          const esElegida = elegida !== null && claveTexto(opcion) === claveTexto(elegida);
          return (
            <motion.button
              key={opcion}
              layout
              type="button"
              variants={hijoEscalonado}
              exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.18 } }}
              whileHover={deshabilitado || esElegida ? undefined : { y: -1 }}
              whileTap={deshabilitado || esElegida ? undefined : { scale: 0.95 }}
              transition={RESORTE}
              disabled={deshabilitado || esElegida}
              aria-pressed={esElegida || undefined}
              onClick={() => onElegir(opcion)}
              className={`inline-flex min-h-11 shrink-0 snap-start items-center gap-1.5 rounded-full border px-4 text-[0.9rem] font-medium shadow-[0_1px_2px_var(--sombra)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/40 disabled:opacity-50 ${esElegida
                ? "border-acento bg-acento text-sobre-acento disabled:opacity-100"
                : destacada
                  ? "border-acento/40 bg-superficie text-acento hover:border-acento hover:bg-acento-suave"
                  : "border-borde bg-superficie text-texto hover:border-acento hover:bg-acento-suave hover:text-acento"}`}
            >
              {esElegida
                ? <motion.span initial={{ width: 0, opacity: 0 }} animate={{ width: "auto", opacity: 1 }} transition={{ duration: DUR.corta }} className="inline-flex overflow-hidden"><Check className="size-4" aria-hidden /></motion.span>
                : destacada && <Sparkles className="size-4" aria-hidden />}
              <span className="whitespace-nowrap">{opcion}</span>
            </motion.button>
          );
        })}
      </AnimatePresence>
    </motion.div>
  );
}

/** Quita repetidas comparando sin mayúsculas ni tildes («Propónme algo» y «proponme algo» son la misma). */
export function dedupeOpciones(opciones: readonly string[]): string[] {
  const vistas = new Set<string>();
  const unicas: string[] = [];
  for (const opcion of opciones) {
    const limpia = opcion.trim();
    const clave = claveTexto(limpia);
    if (!clave || vistas.has(clave)) continue;
    vistas.add(clave);
    unicas.push(limpia);
  }
  return unicas;
}

/**
 * El asistente cierra cada pregunta con una línea `Opciones: a | b | c` (regla del prompt guiado). Se separa del
 * texto visible y se devuelve como botones; un mensaje sin esa línea no trae botones.
 */
export function separarOpciones(texto: string): { texto: string; opciones: string[] } {
  const lineas = texto.trimEnd().split("\n");
  const ultima = lineas.at(-1)?.trim() ?? "";
  const coincide = /^\**\s*opciones\s*:\**\s*(.+)$/i.exec(ultima);
  if (!coincide) return { texto, opciones: [] };
  const opciones = dedupeOpciones(coincide[1]!.split("|").map((opcion) => opcion.replace(/\*+/g, "").trim()).filter((opcion) => opcion.length > 0 && opcion.length <= 60)).slice(0, 6);
  return { texto: lineas.slice(0, -1).join("\n").trimEnd(), opciones };
}
