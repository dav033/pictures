"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useIsPresent } from "motion/react";
import { Check, LoaderCircle, RotateCcw, Search, X } from "lucide-react";
import type { ColorCatalogo } from "@/components/plan/ajuste/ajuste-propuesta";
import { miniaturaDeCatalogo } from "@/components/plan/ajuste/ajuste-propuesta";
import { GloboMiniatura } from "../GloboMiniatura";
import { EASE_SALIDA, RESORTE } from "../animacion/movimiento";
import { tamanosEnTexto, type GloboCatalogo } from "./selector-globos";
import { useSelectorGlobos } from "./usarSelectorGlobos";

type Props = {
  abierto: boolean;
  /**
   * Cada apertura es una sesión nueva: con su propia clave, lo elegido antes no sobrevive (si la animación de cierre
   * no terminó —pestaña en segundo plano—, el selector volvía con el globo anterior marcado y «Añadir» lo usaba).
   */
  sesion: number;
  /** «Cambiar Plata cromado por…», «Añadir un color». */
  titulo: string;
  /** Qué pasa al elegir («Cambia en todas sus medidas; lo demás queda igual»). */
  detalle: string;
  /** Texto del botón final con el globo elegido («Cambiar por Reflex Dorado»). */
  accion: (globo: GloboCatalogo) => string;
  approvalToken: string;
  ventas: readonly ColorCatalogo[];
  conImpresos: boolean;
  /** Globos que no se ofrecen (el que ya está en ese lugar), por `clave`. */
  fuera: ReadonlySet<string>;
  /** Algo más junto al botón final (p. ej. «En las dos columnas»). */
  extra?: ReactNode;
  /** Los globos ya a la mano (el catálogo del motor 3D): no se busca en el catálogo de Python. */
  locales?: readonly GloboCatalogo[];
  onElegir: (globo: GloboCatalogo) => void;
  onCerrar: () => void;
};

const sinSuscripcion = () => () => {};

/**
 * El selector de globos del catálogo real de Sempertex: buscar, filtrar por familia de color (de la más vendida a la
 * menos) y elegir un globo con su foto, nombre, acabado y tamaños. Una hoja con UN solo desplazamiento (la grilla) y
 * la búsqueda y el botón final siempre a la vista; en un teléfono ocupa casi toda la pantalla.
 */
export function SelectorGlobos(props: Props) {
  const enNavegador = useSyncExternalStore(sinSuscripcion, () => true, () => false);
  if (!enNavegador) return null;
  return createPortal(<AnimatePresence>{props.abierto && <Hoja key={`selector-${props.sesion}`} {...props} />}</AnimatePresence>, document.body);  // prerender-seguro: tras `if (!enNavegador) return null`; en el servidor no se llega al portal
}

function Hoja({ titulo, detalle, accion, approvalToken, ventas, conImpresos, fuera, extra, locales, onElegir, onCerrar }: Props) {
  const idTitulo = useId();
  const buscarRef = useRef<HTMLInputElement>(null);
  const [elegido, setElegido] = useState<GloboCatalogo | null>(null);
  const selector = useSelectorGlobos({ approvalToken, ventas, conImpresos, fuera, ...(locales ? { locales } : {}) });
  const presente = useIsPresent();
  const desbordeRef = useRef<string | null>(null);
  // Mientras sale (animación de cierre) ya no bloquea el desplazamiento de la página, como «Modificar esta pieza».
  useEffect(() => {
    if (!presente && desbordeRef.current !== null) document.body.style.overflow = desbordeRef.current;
  }, [presente]);

  useEffect(() => {
    const anterior = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const desborde = document.body.style.overflow;
    desbordeRef.current = desborde;
    document.body.style.overflow = "hidden";
    // En un teléfono el teclado taparía la grilla: el foco va al título, no a la búsqueda.
    document.getElementById(idTitulo)?.focus();
    const alTeclear = (evento: KeyboardEvent) => { if (evento.key === "Escape") onCerrar(); };
    window.addEventListener("keydown", alTeclear);
    return () => {
      document.body.style.overflow = desborde;
      window.removeEventListener("keydown", alTeclear);
      anterior?.focus();
    };
    // Solo al abrir y al cerrar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { resultado, grupos } = selector;
  return (
    <div className={`fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4 ${presente ? "" : "pointer-events-none"}`}>
      <motion.button type="button" aria-label="Cerrar sin elegir" tabIndex={-1} onClick={onCerrar} className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={{ duration: 0.3, ease: EASE_SALIDA }}
        className="relative flex h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-superficie shadow-[0_-8px_40px_var(--sombra)] sm:h-auto sm:max-h-[88dvh] sm:max-w-2xl sm:rounded-3xl"
      >
        <header className="border-b border-borde-suave px-4 pb-3 pt-4 sm:px-5">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-acento">{locales ? "Colores Sempertex" : "Catálogo Sempertex"}</p>
              <h2 id={idTitulo} tabIndex={-1} style={{ outline: "none" }} className="text-lg font-semibold leading-snug text-texto outline-none focus:outline-none focus-visible:outline-none">{titulo}</h2>
              <p className="mt-0.5 text-sm text-texto-suave">{detalle}</p>
            </div>
            <motion.button type="button" onClick={onCerrar} whileTap={{ scale: 0.92 }} transition={RESORTE} aria-label="Cerrar" className="grid size-11 shrink-0 place-items-center rounded-full text-texto-suave hover:bg-superficie-2 hover:text-texto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50">
              <X className="size-5" aria-hidden />
            </motion.button>
          </div>
          <label className="mt-3 flex min-h-11 items-center gap-2 rounded-xl bg-superficie-2 px-3 ring-1 ring-borde-suave focus-within:ring-2 focus-within:ring-acento/50">
            <Search className="size-4 shrink-0 text-texto-suave" aria-hidden />
            <span className="sr-only">Buscar un globo</span>
            <input
              ref={buscarRef}
              type="search"
              value={selector.texto}
              onChange={(evento) => selector.setTexto(evento.target.value)}
              placeholder="Busca: dorado, reflex, perla, pastel…"
              enterKeyHint="search"
              className="min-w-0 flex-1 bg-transparent py-2 text-base text-texto placeholder:text-texto-suave focus:outline-none"
            />
            {selector.buscando && <LoaderCircle className="size-4 shrink-0 animate-spin text-acento motion-reduce:animate-none" aria-hidden />}
          </label>
          {selector.familias.length > 0 && (
            <div role="group" aria-label="Familias de color, de la más vendida a la menos" className="-mx-4 mt-2.5 flex gap-1.5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] sm:-mx-5 sm:px-5">
              <BotonFamilia activo={selector.familia === null} onClick={() => selector.elegirFamilia(null)}>Más vendidos</BotonFamilia>
              {selector.familias.map((familia) => (
                <BotonFamilia key={familia.id} activo={selector.familia === familia.id} onClick={() => selector.elegirFamilia(familia.id)}>{familia.nombre}</BotonFamilia>
              ))}
            </div>
          )}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 sm:px-5" aria-busy={resultado.fase === "cargando" || undefined}>
          {resultado.fase === "cargando" ? (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Cargando globos">
              {Array.from({ length: 8 }, (_, indice) => <li key={indice} className="brillo-carga h-36 rounded-2xl" aria-hidden />)}
            </ul>
          ) : resultado.fase === "error" ? (
            <div role="alert" className="flex flex-wrap items-center gap-2 rounded-2xl bg-error-suave px-3 py-3 text-sm text-texto">
              <span className="min-w-0 flex-1">{resultado.mensaje}</span>
              <button type="button" onClick={selector.reintentar} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-superficie px-3 font-semibold ring-1 ring-borde-suave focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50"><RotateCcw className="size-4" aria-hidden />Reintentar</button>
            </div>
          ) : grupos.length === 0 ? (
            <p className="rounded-2xl bg-superficie-suave px-3 py-4 text-sm text-texto-suave">No encontré globos lisos con «{selector.texto.trim() || "esa familia"}». Prueba con otro color o acabado (Fashion, Reflex, Silk, Pastel).</p>
          ) : (
            <div className="space-y-4">
              {grupos.map((grupo) => (
                <section key={grupo.familia} aria-label={grupo.nombre}>
                  <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-texto-suave">{grupo.nombre}</h3>
                  <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {grupo.globos.map((globo) => (
                      <li key={globo.clave}>
                        <TarjetaGlobo globo={globo} elegido={elegido?.clave === globo.clave} onClick={() => setElegido(globo)} />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>

        <footer className="border-t border-borde-suave px-4 py-3 sm:px-5">
          {extra && <div className="mb-2">{extra}</div>}
          <div className="flex gap-2">
            <button type="button" onClick={onCerrar} className="min-h-12 shrink-0 rounded-2xl px-4 text-sm font-medium text-texto-suave ring-1 ring-borde-suave hover:text-texto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50">Cancelar</button>
            <motion.button
              type="button"
              disabled={!elegido}
              onClick={() => { if (elegido) onElegir(elegido); }}
              whileTap={elegido ? { scale: 0.97 } : undefined}
              transition={RESORTE}
              className="flex min-h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl bg-acento px-4 text-sm font-semibold text-sobre-acento shadow-[0_8px_20px_var(--sombra-acento)] transition-opacity hover:bg-acento-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50 disabled:opacity-50 disabled:shadow-none"
            >
              <Check className="size-4 shrink-0" aria-hidden />
              <span className="truncate">{elegido ? accion(elegido) : "Elige un globo"}</span>
            </motion.button>
          </div>
        </footer>
      </motion.div>
    </div>
  );
}

function BotonFamilia({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={activo}
      onClick={onClick}
      className={`inline-flex min-h-9 shrink-0 items-center rounded-full px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50 ${activo ? "bg-acento text-sobre-acento" : "bg-superficie-2 text-texto ring-1 ring-borde-suave hover:ring-acento/60"}`}
    >
      {children}
    </button>
  );
}

function TarjetaGlobo({ globo, elegido, onClick }: { globo: GloboCatalogo; elegido: boolean; onClick: () => void }) {
  const foto = globo.imagen ? miniaturaDeCatalogo(globo.imagen, 160) : undefined;
  return (
    <motion.button
      type="button"
      aria-pressed={elegido}
      onClick={onClick}
      whileTap={{ scale: 0.97 }}
      transition={RESORTE}
      className={`relative flex h-full w-full flex-col items-center gap-1.5 rounded-2xl p-2.5 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/60 ${elegido ? "bg-acento-suave ring-2 ring-acento" : "bg-superficie-suave ring-1 ring-borde-suave hover:ring-acento/50"}`}
    >
      {elegido && <span className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-full bg-acento text-sobre-acento" aria-hidden><Check className="size-3.5" /></span>}
      <span className="grid size-16 place-items-center overflow-hidden rounded-xl bg-superficie">
        <GloboMiniatura hex={globo.hex} acabado={globo.acabado ?? undefined} pulgadas={12} tamano={56} titulo={globo.nombre} {...(foto ? { foto } : {})} />
      </span>
      <span className="text-sm font-semibold leading-tight text-texto">{globo.nombre}</span>
      <span className="text-xs leading-tight text-texto-suave">{globo.colorCliente}{globo.acabado ? ` · ${globo.acabado}` : ""}</span>
      <span className="text-[0.7rem] tabular-nums leading-tight text-texto-suave">{tamanosEnTexto(globo.tamanos)}</span>
    </motion.button>
  );
}
