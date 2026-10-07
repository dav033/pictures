"use client";

import { motion } from "motion/react";
import type { ReferenciaGuiada } from "@/lib/ia/guiado/adaptar-analisis-referencia";
import { EASE_REBOTE, EASE_SALIDA, RESORTE } from "./animacion/movimiento";

type Props = {
  miniatura: string;
  /** Lo que se leyó en la foto; null mientras se lee o si no se pudo leer. */
  referencia: ReferenciaGuiada | null;
  /** Mientras se lee la foto: franja de escaneo sobre la miniatura. */
  analizando?: boolean;
  /** Sin pasar (o true): con botones. false (historial): solo la lectura. */
  activo?: boolean;
  deshabilitado?: boolean;
  onArmar: () => void;
  /** «Prefiero ver ideas parecidas». */
  onVerIdeas?: () => void;
};

/** La foto de inspiración con las piezas que se ven en ella, sus colores y qué hacer con eso. */
export function ReferenciaInspiracion({ miniatura, referencia, analizando = false, activo = true, deshabilitado, onArmar, onVerIdeas }: Props) {
  return (
    <section aria-label="Lo que veo en tu foto" className="mt-2 w-full max-w-72 overflow-hidden rounded-2xl border border-borde-suave bg-superficie text-left shadow-[0_1px_2px_var(--sombra)]">
      <div className="relative w-full overflow-hidden bg-superficie-2" style={referencia?.aspecto ? { aspectRatio: referencia.aspecto } : undefined}>
        {/* eslint-disable-next-line @next/next/no-img-element -- miniatura local optimizada en el navegador */}
        <img src={miniatura} alt="Tu foto de inspiración" className="block h-full max-h-48 w-full object-contain" />
        {analizando && (
          <div className="pointer-events-none absolute inset-0 bg-acento/5" aria-hidden>
            <span className="escaner-guiado" />
          </div>
        )}
        {referencia && (
          <motion.div className="pointer-events-none absolute inset-0" aria-hidden initial="oculto" animate="visible" variants={{ oculto: {}, visible: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } } }}>
            {referencia.piezas.map((pieza, indice) => (
              <motion.span
                key={indice}
                variants={{ oculto: { opacity: 0, scale: 1.15 }, visible: { opacity: 1, scale: 1, transition: { duration: 0.35, ease: EASE_SALIDA } } }}
                className="absolute rounded-xl border-2 border-acento shadow-[0_0_0_1px_rgb(0_0_0/0.15)]"
                style={{ left: `${pieza.x * 100}%`, top: `${pieza.y * 100}%`, width: `${pieza.ancho * 100}%`, height: `${pieza.alto * 100}%` }}
              />
            ))}
          </motion.div>
        )}
      </div>
      <div className="space-y-3 p-3">
        {analizando && !referencia && <p className="text-sm text-texto-suave" role="status">Mirando tu foto…</p>}
        {referencia && <p className="text-sm text-texto">{referencia.frase}</p>}
        {referencia && referencia.colores.length > 0 && (
          <motion.ul aria-label="Colores que veo" className="flex flex-wrap gap-2" initial="oculto" animate="visible" variants={{ oculto: {}, visible: { transition: { staggerChildren: 0.05, delayChildren: 0.2 } } }}>
            {referencia.colores.map((color) => (
              <motion.li key={color.nombre} variants={{ oculto: { scale: 0 }, visible: { scale: 1, transition: { duration: 0.3, ease: EASE_REBOTE } } }}>
                <span role="img" aria-label={color.nombre} title={color.nombre} className="block size-5 rounded-full ring-1 ring-borde" style={{ backgroundColor: color.hex }} />
              </motion.li>
            ))}
          </motion.ul>
        )}
        {activo && referencia && (
          <div className="space-y-2">
            <motion.button
              type="button"
              disabled={deshabilitado}
              onClick={onArmar}
              whileTap={{ scale: 0.97 }}
              transition={RESORTE}
              className="min-h-11 w-full rounded-xl bg-acento px-3 text-sm font-semibold text-sobre-acento transition-colors hover:bg-acento-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50 focus-visible:ring-offset-2 focus-visible:ring-offset-superficie disabled:opacity-50"
            >
              Sí, armémoslo
            </motion.button>
            {onVerIdeas && (
              <button type="button" disabled={deshabilitado} onClick={onVerIdeas} className="min-h-11 w-full rounded-xl px-3 text-sm font-medium text-acento transition-colors hover:bg-acento-suave focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50 disabled:opacity-50">
                Prefiero ver ideas parecidas
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
