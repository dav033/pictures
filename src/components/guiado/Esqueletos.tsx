"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { RotateCcw, Sparkles } from "lucide-react";
import { DUR, EASE_SALIDA } from "./animacion/movimiento";

/** En qué va la preparación del plan; «reintentando» cuando el primer intento falló y se repite solo. */
export type EtapaPlan = "preparando" | "buscando" | "calculando" | "precio" | "reintentando";

const PASOS: ReadonlyArray<{ etapa: Exclude<EtapaPlan, "reintentando">; texto: string }> = [
  { etapa: "preparando", texto: "Leyendo tu idea" },
  { etapa: "buscando", texto: "Eligiendo los globos de cada color" },
  { etapa: "calculando", texto: "Calculando cuántos globos lleva cada pieza" },
  { etapa: "precio", texto: "Sacando el precio" },
];

/**
 * Lo que ve el cliente mientras se prepara su plan: en qué paso va (con los anteriores marcados) y la silueta
 * de «Tu plan» que está por llegar. Sustituye al texto plano «Estoy preparando tu plan…».
 */
export function EsqueletoPlan({ etapa }: { etapa: EtapaPlan }) {
  const reducido = useReducedMotion();
  const actual = etapa === "reintentando" ? 0 : PASOS.findIndex((paso) => paso.etapa === etapa);
  return (
    <div role="status" aria-live="polite" className="mt-3 w-full rounded-3xl border border-borde-suave bg-superficie p-4 shadow-[0_1px_2px_var(--sombra)] sm:p-5">
      <AnimatePresence initial={false}>
        {etapa === "reintentando" && (
          <motion.p
            key="reintentando"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: DUR.media, ease: EASE_SALIDA }}
            className="mb-3 flex items-center gap-2 overflow-hidden rounded-xl bg-aviso-suave px-3 py-2 text-sm text-texto"
          >
            <RotateCcw className="size-4 shrink-0 text-aviso" aria-hidden />
            Lo estoy intentando otra vez, un momento…
          </motion.p>
        )}
      </AnimatePresence>
      <ol className="space-y-2.5" aria-label="Preparando tu plan">
        {PASOS.map((paso, indice) => {
          const hecho = indice < actual;
          const enCurso = indice === actual;
          return (
            <li key={paso.etapa} className={`flex items-center gap-2.5 text-sm ${hecho ? "text-texto-suave" : enCurso ? "font-medium text-texto" : "text-texto-tenue"}`}>
              <span className={`grid size-5 shrink-0 place-items-center rounded-full ${hecho ? "bg-exito text-fondo" : enCurso ? "bg-acento-suave ring-1 ring-acento/40" : "ring-1 ring-borde"}`} aria-hidden>
                {hecho && (
                  <svg viewBox="0 0 16 16" className="size-3.5" fill="none">
                    <motion.path
                      d="M3.5 8.5l3 3 6-7"
                      stroke="currentColor"
                      strokeWidth={2.2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      initial={reducido ? false : { pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ duration: 0.3, ease: EASE_SALIDA }}
                    />
                  </svg>
                )}
                {enCurso && (
                  <motion.span
                    className="size-2 rounded-full bg-acento"
                    animate={reducido ? undefined : { scale: [1, 1.5, 1], opacity: [1, 0.5, 1] }}
                    transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
                  />
                )}
              </span>
              <span>{paso.texto}{enCurso ? "…" : ""}</span>
              <span className="sr-only">{hecho ? "(hecho)" : enCurso ? "(en curso)" : "(pendiente)"}</span>
            </li>
          );
        })}
      </ol>
      <div className="mt-5 space-y-3" aria-hidden>
        <div className="brillo-carga h-4 w-[40%] rounded-md" />
        {[0, 1].map((fila) => (
          <div key={fila} className="grid grid-cols-[5rem_1fr] gap-3 rounded-2xl bg-superficie-suave p-3">
            <div className="brillo-carga size-20 rounded-xl" />
            <div className="space-y-2 pt-1">
              <div className="brillo-carga h-3.5 w-[60%] rounded" />
              <div className="brillo-carga h-3 w-[40%] rounded" />
              <div className="brillo-carga h-2 w-[80%] rounded-full" />
            </div>
          </div>
        ))}
        <div className="brillo-carga h-6 w-32 rounded-md" />
      </div>
      <p className="mt-4 text-xs text-texto-suave">Esto suele tardar unos 20 segundos.</p>
    </div>
  );
}

/** Mientras se dibuja «Ver cómo quedaría»: el hueco de la imagen, con lo que está pasando dicho en palabras. */
export function EsqueletoImagen() {
  const reducido = useReducedMotion();
  return (
    <div role="status" aria-live="polite" className="brillo-carga relative grid aspect-[4/3] w-full place-items-center overflow-hidden rounded-xl">
      <div className="flex flex-col items-center gap-2 px-4 text-center">
        <motion.span
          className="grid size-11 place-items-center rounded-full bg-superficie/80 text-acento"
          animate={reducido ? undefined : { scale: [1, 1.12, 1], opacity: [0.8, 1, 0.8] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        >
          <Sparkles className="size-5" aria-hidden />
        </motion.span>
        <p className="text-sm font-medium text-texto">Dibujando tu decoración… unos segundos</p>
      </div>
      <div className="absolute inset-x-0 bottom-0 h-1 overflow-hidden bg-superficie-2" aria-hidden>
        <motion.div
          className="h-full w-1/2 bg-acento"
          initial={{ x: "-100%" }}
          animate={reducido ? { x: "50%" } : { x: ["-100%", "200%"] }}
          transition={reducido ? { duration: 0 } : { duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>
    </div>
  );
}
