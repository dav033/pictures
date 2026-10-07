"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowDown } from "lucide-react";
import { RESORTE } from "./movimiento";

type Opciones = {
  /** El elemento que hace scroll (la conversación). */
  contenedorRef: RefObject<HTMLElement | null>;
  /** Lo que crece dentro (la lista de mensajes): su ResizeObserver decide si seguir al final. */
  contenidoRef: RefObject<HTMLElement | null>;
  /** Distancia al fondo, en px, por debajo de la cual se considera «pegado». */
  umbral?: number;
};

/**
 * Autoscroll que no estorba: sigue al final solo si el cliente ya estaba abajo (a menos de `umbral` px), sin
 * animación en cada fragmento de texto, y si estaba releyendo arriba marca `hayNuevo` para el botón «Ir al final».
 * `mostrarMensaje(id)` lleva un widget alto (plan, carrusel) a la vista por su CABECERA, no por su final.
 */
export function useSeguirFinal({ contenedorRef, contenidoRef, umbral = 120 }: Opciones): {
  pegado: boolean;
  hayNuevo: boolean;
  irAlFinal: (comportamiento?: ScrollBehavior) => void;
  mostrarMensaje: (id: string) => void;
  seguirSiPegado: () => void;
} {
  const reducido = useReducedMotion();
  const [pegado, setPegado] = useState(true);
  const [hayNuevo, setHayNuevo] = useState(false);
  const pegadoRef = useRef(true);
  // Mientras dura un desplazamiento pedido (ir al final, mostrar un mensaje), ni el scroll intermedio ni el
  // ResizeObserver deben deshacerlo.
  const suspendidoHastaRef = useRef(0);
  const destinoRef = useRef<"final" | "mensaje" | null>(null);

  useEffect(() => {
    const contenedor = contenedorRef.current;
    if (!contenedor) return;
    const medir = () => {
      const cerca = contenedor.scrollHeight - contenedor.scrollTop - contenedor.clientHeight < umbral;
      if (!cerca && destinoRef.current === "final" && performance.now() < suspendidoHastaRef.current) return;
      if (cerca) destinoRef.current = null;
      pegadoRef.current = cerca;
      setPegado(cerca);
      if (cerca) setHayNuevo(false);
    };
    medir();
    contenedor.addEventListener("scroll", medir, { passive: true });
    return () => contenedor.removeEventListener("scroll", medir);
  }, [contenedorRef, umbral]);

  useEffect(() => {
    const contenedor = contenedorRef.current;
    const contenido = contenidoRef.current;
    if (!contenedor || !contenido || typeof ResizeObserver === "undefined") return;
    let alto = contenido.offsetHeight;
    const observador = new ResizeObserver(() => {
      const nuevo = contenido.offsetHeight;
      const crecio = nuevo > alto + 1;
      alto = nuevo;
      if (!crecio) return;
      if (destinoRef.current === "mensaje" && performance.now() < suspendidoHastaRef.current) return;
      if (pegadoRef.current) contenedor.scrollTo({ top: contenedor.scrollHeight, behavior: "auto" });
      else setHayNuevo(true);
    });
    observador.observe(contenido);
    return () => observador.disconnect();
  }, [contenedorRef, contenidoRef]);

  const irAlFinal = useCallback((comportamiento?: ScrollBehavior) => {
    const contenedor = contenedorRef.current;
    setHayNuevo(false);
    pegadoRef.current = true;
    setPegado(true);
    if (!contenedor) return;
    const modo = comportamiento ?? (reducido ? "auto" : "smooth");
    destinoRef.current = "final";
    suspendidoHastaRef.current = performance.now() + (modo === "smooth" ? 900 : 50);
    contenedor.scrollTo({ top: contenedor.scrollHeight, behavior: modo });
  }, [contenedorRef, reducido]);

  const mostrarMensaje = useCallback((id: string) => {
    destinoRef.current = "mensaje";
    suspendidoHastaRef.current = performance.now() + 1200;
    pegadoRef.current = false;
    requestAnimationFrame(() => {
      const contenedor = contenedorRef.current;
      const elemento = contenedor?.querySelector<HTMLElement>(`[data-mensaje-id="${CSS.escape(id)}"]`);
      if (!elemento) { destinoRef.current = null; return; }
      elemento.scrollIntoView({ block: "start", behavior: reducido ? "auto" : "smooth" });
    });
  }, [contenedorRef, reducido]);

  const seguirSiPegado = useCallback(() => {
    const contenedor = contenedorRef.current;
    if (!contenedor || !pegadoRef.current) return;
    if (destinoRef.current === "mensaje" && performance.now() < suspendidoHastaRef.current) return;
    contenedor.scrollTo({ top: contenedor.scrollHeight, behavior: "auto" });
  }, [contenedorRef]);

  return { pegado, hayNuevo, irAlFinal, mostrarMensaje, seguirSiPegado };
}

/** Botón flotante «Ir al final», con un punto de acento si llegó algo nuevo mientras el cliente leía arriba. */
export function BotonIrAlFinal({ visible, hayNuevo, onClick }: { visible: boolean; hayNuevo: boolean; onClick: () => void }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          type="button"
          aria-label={hayNuevo ? "Ir al final, hay un mensaje nuevo" : "Ir al final"}
          title="Ir al final"
          onClick={onClick}
          initial={{ opacity: 0, y: 8, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.9 }}
          transition={RESORTE}
          whileTap={{ scale: 0.92 }}
          className="absolute bottom-3 left-1/2 z-10 grid size-11 -translate-x-1/2 place-items-center rounded-full bg-superficie text-texto shadow-lg ring-1 ring-borde focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50"
        >
          <ArrowDown className="size-5" aria-hidden />
          {hayNuevo && <span className="absolute right-1 top-1 size-2.5 rounded-full bg-acento ring-2 ring-superficie" aria-hidden />}
        </motion.button>
      )}
    </AnimatePresence>
  );
}
