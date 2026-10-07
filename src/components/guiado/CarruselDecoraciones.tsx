"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, ChevronLeft, ChevronRight, ImagePlus, Sparkles } from "lucide-react";
import type { DecoracionSempertex } from "@/lib/biblioteca-sempertex/esquemas";
import { FotoDecoracion } from "./FotoDecoracion";
import { EASE_REBOTE, RESORTE, RESORTE_SUAVE, grupoConRitmo } from "./animacion/movimiento";
import { BotonAgregarCarrusel, type EstadoAgregarIdea } from "./AgregarIdea";

type Props = {
  decoraciones: DecoracionSempertex[];
  /** Solo el carrusel del último mensaje se puede elegir; los anteriores quedan como historia. */
  activo: boolean;
  elegidaId: string | null;
  onElegir: (decoracion: DecoracionSempertex) => void;
  onNinguna: () => void;
  /** «Propónme algo»: si se pasa, sale como salida destacada bajo el carrusel. */
  onProponer?: () => void;
  /** «Subir una foto»: abre el selector de archivo del compositor. */
  onSubirFoto?: () => void;
  /**
   * «Agregar a mi plan» (pedido 3), solo con un plan vigente: por id, si cada idea se puede agregar, se está agregando o
   * ya está en el plan (null o ausente: no se ofrece). Se agrega sin elegirla.
   */
  estadosAgregar?: Readonly<Record<string, EstadoAgregarIdea | null>> | undefined;
  agregarDeshabilitado?: boolean | undefined;
  onAgregar?: ((decoracion: DecoracionSempertex) => void) | undefined;
};

const entradaTarjeta = {
  oculto: { opacity: 0, x: 24, scale: 0.96 },
  visible: { opacity: 1, x: 0, scale: 1, transition: RESORTE_SUAVE },
};

/** Ideas de decoración en un carril deslizable, con flechas en escritorio, puntos de posición y salidas debajo. */
export function CarruselDecoraciones({ decoraciones, activo, elegidaId, onElegir, onNinguna, onProponer, onSubirFoto, estadosAgregar, agregarDeshabilitado = true, onAgregar }: Props) {
  const reducido = useReducedMotion();
  const carrilRef = useRef<HTMLDivElement>(null);
  const [indiceVisible, setIndiceVisible] = useState(0);
  const [bordes, setBordes] = useState<{ inicio: boolean; fin: boolean }>({ inicio: true, fin: decoraciones.length <= 1 });
  const unica = decoraciones.length === 1;
  const elegidaPreviaRef = useRef(elegidaId);

  // Qué tarjeta se ve (puntos de posición).
  useEffect(() => {
    const carril = carrilRef.current;
    if (!carril || unica || typeof IntersectionObserver === "undefined") return;
    const observador = new IntersectionObserver((entradas) => {
      for (const entrada of entradas) {
        if (!entrada.isIntersecting) continue;
        const indice = Number((entrada.target as HTMLElement).dataset.indice);
        if (Number.isFinite(indice)) setIndiceVisible(indice);
      }
    }, { root: carril, threshold: 0.6 });
    for (const tarjeta of carril.querySelectorAll<HTMLElement>("[data-indice]")) observador.observe(tarjeta);
    return () => observador.disconnect();
  }, [decoraciones, unica]);

  // Si hay más a los lados (flechas y fundido de los bordes).
  useEffect(() => {
    const carril = carrilRef.current;
    if (!carril) return;
    const medir = () => setBordes({ inicio: carril.scrollLeft <= 4, fin: carril.scrollLeft + carril.clientWidth >= carril.scrollWidth - 4 });
    const cuadro = requestAnimationFrame(medir);
    carril.addEventListener("scroll", medir, { passive: true });
    window.addEventListener("resize", medir);
    return () => { cancelAnimationFrame(cuadro); carril.removeEventListener("scroll", medir); window.removeEventListener("resize", medir); };
  }, [decoraciones]);

  // Sin elegida, el carril arranca en la primera tarjeta: con ideas nuevas llegaba desplazado y la cortaba por la izquierda.
  useLayoutEffect(() => {
    const carril = carrilRef.current;
    if (!carril || elegidaPreviaRef.current) return;
    carril.scrollTo({ left: 0, behavior: "instant" });
  }, [decoraciones]);

  // Al elegir, el carril centra la elegida (sin mover la conversación en vertical).
  useEffect(() => {
    if (elegidaPreviaRef.current === elegidaId) return;
    elegidaPreviaRef.current = elegidaId;
    const carril = carrilRef.current;
    const tarjeta = elegidaId ? carril?.querySelector<HTMLElement>(`[data-decoracion-id="${CSS.escape(elegidaId)}"]`) : null;
    if (!carril || !tarjeta) return;
    carril.scrollTo({ left: tarjeta.offsetLeft - (carril.clientWidth - tarjeta.clientWidth) / 2, behavior: reducido ? "auto" : "smooth" });
  }, [elegidaId, reducido]);

  const desplazar = (direccion: 1 | -1) => {
    const carril = carrilRef.current;
    const tarjeta = carril?.querySelector<HTMLElement>("[data-indice]");
    if (!carril || !tarjeta) return;
    carril.scrollBy({ left: direccion * (tarjeta.offsetWidth + 12), behavior: reducido ? "auto" : "smooth" });
  };

  const mascara = unica || (bordes.inicio && bordes.fin)
    ? undefined
    : `linear-gradient(to right, ${bordes.inicio ? "black" : "transparent"}, black 16px, black calc(100% - 24px), ${bordes.fin ? "black" : "transparent"})`;

  return (
    <section aria-label="Ideas de decoración" className="mt-4 min-w-0">
      <div className="relative">
        <motion.div
          ref={carrilRef}
          variants={grupoConRitmo(0.07)}
          initial="oculto"
          animate="visible"
          className="flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain scroll-smooth pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={mascara ? { maskImage: mascara, WebkitMaskImage: mascara } : undefined}
          data-testid="carrusel-decoraciones"
        >
          {decoraciones.map((decoracion, indice) => {
            const elegida = decoracion.id === elegidaId;
            const atenuada = (elegidaId !== null && !elegida) || (!activo && !elegida);
            // Ya en el plan se dice siempre; el botón, solo en el carrusel activo y no en la elegida (su tarjeta ya lo tiene).
            const estadoAgregar = onAgregar ? estadosAgregar?.[decoracion.id] ?? null : null;
            const conAgregar = estadoAgregar === "agregada" || (estadoAgregar !== null && activo && !elegida);
            return (
              <motion.article
                key={decoracion.id}
                data-indice={indice}
                data-decoracion-id={decoracion.id}
                variants={entradaTarjeta}
                whileHover={activo ? { y: -3 } : undefined}
                className={`group shrink-0 snap-start ${unica ? "w-full max-w-sm" : "w-[78vw] max-w-[17rem]"} transition-[opacity,filter] duration-300 ${atenuada ? "opacity-40 saturate-50" : ""}`}
              >
                <motion.div
                  animate={elegida && !reducido ? { scale: [1, 1.03, 1] } : { scale: 1 }}
                  transition={{ duration: 0.35 }}
                  className={`flex h-full flex-col overflow-hidden rounded-2xl border bg-superficie shadow-[0_1px_2px_var(--sombra)] transition-shadow hover:shadow-[0_12px_32px_var(--sombra)] ${elegida ? "border-acento ring-2 ring-acento" : "border-borde-suave"}`}
                >
                  <div className="relative aspect-[4/3] overflow-hidden">
                    <FotoDecoracion decoracion={decoracion} sizes="(max-width: 640px) 78vw, 272px" />
                    <span className="absolute left-2.5 top-2.5 flex gap-1.5">
                      {decoracion.origen === "referencia_real" && <Insignia>Referencia</Insignia>}
                      {decoracion.coincidencia === "cercana" && <Insignia>Parecida</Insignia>}
                    </span>
                    <AnimatePresence>
                      {elegida && (
                        <motion.span
                          key="check"
                          initial={{ scale: 0, rotate: -45 }}
                          animate={{ scale: 1, rotate: 0 }}
                          exit={{ scale: 0 }}
                          transition={{ duration: 0.4, ease: EASE_REBOTE }}
                          className="absolute right-2.5 top-2.5 grid size-8 place-items-center rounded-full bg-acento text-sobre-acento shadow"
                        >
                          <Check className="size-4" aria-label="Elegida" />
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </div>
                  <div className="flex flex-1 flex-col p-4">
                    <h3 className="font-semibold leading-snug text-texto">{decoracion.titulo}</h3>
                    <p className="mt-1 line-clamp-2 text-sm text-texto-suave">{decoracion.tematica}</p>
                    <div className="mt-auto pt-4">
                      {elegida ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-acento-suave px-3 py-1 text-xs font-medium text-acento"><Check className="size-3.5" aria-hidden />Elegiste esta</span>
                      ) : activo ? (
                        <motion.button
                          type="button"
                          whileTap={{ scale: 0.97 }}
                          transition={RESORTE}
                          onClick={() => onElegir(decoracion)}
                          className="min-h-11 w-full rounded-xl bg-acento px-3 text-sm font-semibold text-sobre-acento transition-colors hover:bg-acento-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50 focus-visible:ring-offset-2 focus-visible:ring-offset-superficie"
                        >
                          Me gusta esta
                        </motion.button>
                      ) : null}
                      {conAgregar && estadoAgregar && <BotonAgregarCarrusel estado={estadoAgregar} deshabilitado={agregarDeshabilitado} onAgregar={() => onAgregar?.(decoracion)} />}
                    </div>
                  </div>
                </motion.div>
              </motion.article>
            );
          })}
        </motion.div>
        {!unica && (
          <>
            <Flecha direccion={-1} visible={!bordes.inicio} onClick={() => desplazar(-1)} />
            <Flecha direccion={1} visible={!bordes.fin} onClick={() => desplazar(1)} />
          </>
        )}
      </div>

      {!unica && (
        <div className="mt-1 flex justify-center gap-1.5" aria-hidden>
          {decoraciones.map((decoracion, indice) => (
            <motion.span key={decoracion.id} layout transition={RESORTE} className={`h-1.5 rounded-full ${indice === indiceVisible ? "w-4 bg-acento" : "w-1.5 bg-borde"}`} />
          ))}
        </div>
      )}

      {activo && (
        <motion.div variants={grupoConRitmo(0.04, 0.2)} initial="oculto" animate="visible" className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Otras salidas">
          {onProponer && <ChipSalida destacada icono={<Sparkles className="size-4" aria-hidden />} onClick={onProponer}>Propónme algo</ChipSalida>}
          <ChipSalida onClick={onNinguna}>Ninguna me convence</ChipSalida>
          {onSubirFoto && <ChipSalida icono={<ImagePlus className="size-4" aria-hidden />} onClick={onSubirFoto}>Subir una foto</ChipSalida>}
        </motion.div>
      )}
    </section>
  );
}

function Insignia({ children }: { children: string }) {
  return <span className="rounded-full bg-superficie/90 px-2 py-0.5 text-[0.7rem] font-semibold text-texto ring-1 ring-borde-suave backdrop-blur-sm">{children}</span>;
}

function Flecha({ direccion, visible, onClick }: { direccion: 1 | -1; visible: boolean; onClick: () => void }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          type="button"
          aria-label={direccion === 1 ? "Ver más ideas" : "Ver ideas anteriores"}
          onClick={onClick}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className={`absolute top-[38%] hidden size-11 -translate-y-1/2 place-items-center rounded-full bg-superficie/90 text-texto shadow ring-1 ring-borde backdrop-blur transition-colors hover:text-acento focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50 sm:grid ${direccion === 1 ? "right-1" : "left-1"}`}
        >
          {direccion === 1 ? <ChevronRight className="size-5" aria-hidden /> : <ChevronLeft className="size-5" aria-hidden />}
        </motion.button>
      )}
    </AnimatePresence>
  );
}

function ChipSalida({ children, onClick, icono, destacada = false }: { children: string; onClick: () => void; icono?: ReactNode; destacada?: boolean }) {
  return (
    <motion.button
      type="button"
      variants={{ oculto: { opacity: 0, y: 6 }, visible: { opacity: 1, y: 0 } }}
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.95 }}
      transition={RESORTE}
      onClick={onClick}
      className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border bg-superficie px-4 text-[0.9rem] font-medium shadow-[0_1px_2px_var(--sombra)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/40 ${destacada ? "border-acento/40 text-acento hover:border-acento hover:bg-acento-suave" : "border-borde text-texto hover:border-acento hover:bg-acento-suave hover:text-acento"}`}
    >
      {icono}
      {children}
    </motion.button>
  );
}
