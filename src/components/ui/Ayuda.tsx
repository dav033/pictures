"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type PointerEvent as EventoPuntero } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CircleQuestionMark } from "lucide-react";
import { registrarEventoCliente } from "@/lib/registro/cliente";
import { cn } from "@/lib/utils";

/** Una ayuda: su id (el del registro), el tema que nombra el botón y el texto (una o dos frases). */
export type DatosAyuda = { id: string; tema: string; texto: string };

type Props = DatosAyuda & {
  className?: string;
};

type Modo = "raton" | "toque" | "teclado";
type Lado = "arriba" | "abajo";
export type PosicionAyuda = { top: number; left: number; lado: Lado; flecha: number };

/** Distancia mínima al borde de la ventana y separación entre el icono y la burbuja (px). */
const MARGEN = 8;
const SEPARACION = 8;
/** Espera antes de abrir al pasar el ratón (que no salte al cruzarlo) y antes de cerrar al salir (para llegar a la burbuja). */
const ESPERA_ABRIR_MS = 180;
const ESPERA_CERRAR_MS = 120;
/** Un scroll justo después de abrir (el navegador llevando el foco a la vista) recoloca en vez de cerrar. */
const GRACIA_SCROLL_MS = 250;

/**
 * Dónde va la burbuja: arriba del icono si cabe (así no tapa el campo que explica, que va debajo de su etiqueta),
 * si no abajo; centrada en el icono y empujada hacia dentro para que nunca se salga de la ventana (390 px incluidos).
 * La flecha sigue apuntando al icono. Pura: la prueba la llama sin navegador.
 */
export function posicionAyuda(
  icono: { top: number; bottom: number; left: number; width: number },
  burbuja: { width: number; height: number },
  ventana: { width: number; height: number },
): PosicionAyuda {
  const cabeArriba = icono.top - SEPARACION - burbuja.height >= MARGEN;
  const cabeAbajo = icono.bottom + SEPARACION + burbuja.height <= ventana.height - MARGEN;
  const lado: Lado = cabeArriba ? "arriba" : cabeAbajo ? "abajo" : icono.top > ventana.height - icono.bottom ? "arriba" : "abajo";
  const top = lado === "arriba" ? Math.max(MARGEN, icono.top - SEPARACION - burbuja.height) : icono.bottom + SEPARACION;
  const centro = icono.left + icono.width / 2;
  const maximo = Math.max(MARGEN, ventana.width - MARGEN - burbuja.width);
  const left = Math.min(maximo, Math.max(MARGEN, centro - burbuja.width / 2));
  const flecha = Math.min(burbuja.width - 14, Math.max(14, centro - left));
  return { top, left, lado, flecha };
}

const sinSuscripcion = () => () => undefined;

/**
 * Icono «?» junto a una etiqueta que abre una burbuja con una explicación corta. Se abre al pasar el ratón, con el
 * foco del teclado y al TOCARLO (en el móvil no hay hover: un toque abre y otro cierra); se cierra con Escape, al
 * tocar fuera, al desplazarse o al salir el ratón (si no se fijó con un clic). La burbuja va en un portal (los
 * paneles plegables recortan lo que se sale), por encima del icono si cabe, y se recoloca para caber en 390 px.
 *
 * Accesible: es un `button` con `aria-label` («Ayuda: …») y `aria-describedby` que apunta a un `role="tooltip"`
 * oculto con el mismo texto, siempre presente (también en el HTML del servidor): el lector de pantalla lo lee al
 * llegar al botón sin depender de la animación. La burbuja visible es solo para la vista (`aria-hidden`).
 * Cada apertura queda en el registro de la conversación activa: `ayuda.abrir` con su id y cómo se abrió.
 *
 * No usa el Tooltip de Radix (`ui/tooltip.tsx`): ese, por diseño, no se abre al tocar en el móvil. Pensada para la
 * página, no para dentro de un diálogo modal (su portal va al `body`).
 */
export function Ayuda({ id, tema, texto, className }: Props) {
  const reducido = useReducedMotion();
  // El portal solo existe en el navegador; en el servidor (y al hidratar) no se pinta.
  const enNavegador = useSyncExternalStore(sinSuscripcion, () => true, () => false);
  const base = useId();
  const idTexto = `${base}-ayuda`;
  const botonRef = useRef<HTMLButtonElement>(null);
  const burbujaRef = useRef<HTMLDivElement>(null);
  const [abierta, setAbierta] = useState(false);
  const [posicion, setPosicion] = useState<PosicionAyuda | null>(null);
  const abiertaRef = useRef(false);
  /** Abierta con un clic o un toque: no se cierra al salir el ratón. */
  const fijada = useRef(false);
  const abiertaDesde = useRef(0);
  const ultimoPuntero = useRef<Modo | null>(null);
  const tocandoBurbuja = useRef(false);
  const temporizador = useRef<number | null>(null);

  const limpiarEspera = useCallback(() => {
    if (temporizador.current !== null) window.clearTimeout(temporizador.current);
    temporizador.current = null;
  }, []);

  const abrir = useCallback((modo: Modo, fijar: boolean) => {
    limpiarEspera();
    if (abiertaRef.current) {
      // Ya abierta: un clic la fija; el foco o el ratón nunca la sueltan.
      if (fijar) fijada.current = true;
      return;
    }
    fijada.current = fijar;
    abiertaRef.current = true;
    abiertaDesde.current = Date.now();
    setPosicion(null);
    setAbierta(true);
    registrarEventoCliente("ayuda.abrir", { id, modo }, "activa");
  }, [id, limpiarEspera]);

  const cerrar = useCallback(() => {
    limpiarEspera();
    fijada.current = false;
    abiertaRef.current = false;
    setAbierta(false);
  }, [limpiarEspera]);

  const colocar = useCallback(() => {
    const boton = botonRef.current;
    const burbuja = burbujaRef.current;
    if (!boton || !burbuja) return;
    // offsetWidth/Height: el tamaño sin la escala de la animación de entrada.
    setPosicion(posicionAyuda(boton.getBoundingClientRect(), { width: burbuja.offsetWidth, height: burbuja.offsetHeight }, { width: document.documentElement.clientWidth, height: window.innerHeight }));
  }, []);

  // Medir y colocar antes de pintar: la burbuja nunca se ve en un sitio y luego salta.
  useLayoutEffect(() => {
    if (abierta) colocar();
  }, [abierta, colocar]);

  useEffect(() => {
    if (!abierta) return;
    const alTeclear = (evento: KeyboardEvent) => {
      if (evento.key !== "Escape") return;
      // Solo esta burbuja: el panel o diálogo de debajo no se cierra con el mismo Escape.
      evento.stopPropagation();
      cerrar();
    };
    const alTocarFuera = (evento: PointerEvent) => {
      const destino = evento.target;
      if (!(destino instanceof Node)) return;
      if (botonRef.current?.contains(destino) || burbujaRef.current?.contains(destino)) return;
      cerrar();
    };
    const alDesplazar = () => {
      if (Date.now() - abiertaDesde.current < GRACIA_SCROLL_MS) colocar();
      else cerrar();
    };
    window.addEventListener("keydown", alTeclear, true);
    document.addEventListener("pointerdown", alTocarFuera, true);
    window.addEventListener("scroll", alDesplazar, { capture: true, passive: true });
    window.addEventListener("resize", cerrar);
    return () => {
      window.removeEventListener("keydown", alTeclear, true);
      document.removeEventListener("pointerdown", alTocarFuera, true);
      window.removeEventListener("scroll", alDesplazar, { capture: true });
      window.removeEventListener("resize", cerrar);
    };
  }, [abierta, cerrar, colocar]);

  useEffect(() => limpiarEspera, [limpiarEspera]);

  // Solo el ratón abre y cierra al pasar: en el móvil, un toque también «entra» y «sale», y eso lo resuelve el clic.
  const alEntrarEnBoton = (evento: EventoPuntero) => {
    if (evento.pointerType !== "mouse") return;
    limpiarEspera();
    if (!abiertaRef.current) temporizador.current = window.setTimeout(() => abrir("raton", false), ESPERA_ABRIR_MS);
  };
  const alEntrarEnBurbuja = (evento: EventoPuntero) => {
    if (evento.pointerType === "mouse") limpiarEspera();
  };
  const alSalir = (evento: EventoPuntero) => {
    if (evento.pointerType !== "mouse" || fijada.current) return;
    limpiarEspera();
    temporizador.current = window.setTimeout(cerrar, ESPERA_CERRAR_MS);
  };

  return (
    <span className={cn("relative inline-flex shrink-0 align-middle", className)}>
      <button
        ref={botonRef}
        type="button"
        aria-label={`Ayuda: ${tema}`}
        aria-describedby={idTexto}
        data-ayuda={id}
        onPointerDown={(evento) => { ultimoPuntero.current = evento.pointerType === "mouse" ? "raton" : "toque"; }}
        onPointerEnter={alEntrarEnBoton}
        onPointerLeave={alSalir}
        onFocus={(evento) => {
          // Solo el foco del teclado abre: el de un toque o un clic lo resuelve el clic (abrir y cerrar a la vez, no).
          if (evento.currentTarget.matches(":focus-visible")) abrir("teclado", false);
        }}
        onBlur={() => {
          if (!tocandoBurbuja.current) cerrar();
        }}
        onClick={(evento) => {
          const modo: Modo = evento.detail === 0 ? "teclado" : ultimoPuntero.current ?? "raton";
          ultimoPuntero.current = null;
          if (!abiertaRef.current) abrir(modo, true);
          else if (fijada.current) cerrar();
          else { limpiarEspera(); fijada.current = true; }
        }}
        className={cn(
          "relative grid size-5 place-items-center rounded-full transition-colors",
          // Zona de toque de 36 px sin mover nada alrededor.
          "before:absolute before:-inset-2 before:content-['']",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/60",
          abierta ? "text-acento" : "text-texto-suave hover:text-acento",
        )}
      >
        <CircleQuestionMark className="size-4" aria-hidden />
      </button>
      <span id={idTexto} role="tooltip" hidden>{texto}</span>
      {enNavegador && createPortal(
        <AnimatePresence>
          {abierta && (
            <motion.div
              ref={burbujaRef}
              key="burbuja"
              aria-hidden="true"
              data-ayuda-burbuja={id}
              initial={reducido ? { opacity: 0 } : { opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={reducido ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
              onPointerEnter={alEntrarEnBurbuja}
              onPointerLeave={alSalir}
              onPointerDown={() => {
                // Tocar la burbuja no la cierra (el botón pierde el foco justo después).
                tocandoBurbuja.current = true;
                window.setTimeout(() => { tocandoBurbuja.current = false; }, 0);
              }}
              style={{
                position: "fixed",
                top: posicion?.top ?? 0,
                left: posicion?.left ?? 0,
                visibility: posicion ? "visible" : "hidden",
                transformOrigin: posicion ? `${posicion.flecha}px ${posicion.lado === "arriba" ? "100%" : "0%"}` : "50% 100%",
              }}
              className="z-[80] w-max max-w-[min(17.5rem,calc(100vw-1rem))] rounded-xl bg-texto px-3 py-2 text-left text-[13px] font-normal leading-snug normal-case tracking-normal text-fondo shadow-[0_10px_28px_var(--sombra)]"
            >
              {texto}
              {posicion && (
                <span
                  aria-hidden="true"
                  className={`absolute size-2.5 rotate-45 rounded-[2px] bg-texto ${posicion.lado === "arriba" ? "-bottom-1" : "-top-1"}`}
                  style={{ left: posicion.flecha - 5 }}
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </span>
  );
}
