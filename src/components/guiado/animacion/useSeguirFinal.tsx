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
  /** Distancia al fondo, en px, desde la que una respuesta que llega (un plan) ya no mueve la vista. */
  umbralLlegada?: number;
};

/**
 * Autoscroll que no estorba: sigue al final solo si el cliente ya estaba abajo (a menos de `umbral` px), sin
 * animación en cada fragmento de texto, y si estaba releyendo arriba marca `hayNuevo` para el botón «Ir al final».
 * `mostrarMensaje(id)` lleva un widget alto (plan, carrusel) a la vista por su CABECERA, no por su final.
 * `mostrarLlegada(id)` es lo mismo para lo que llega solo (el plan tras su espera): si el cliente subió a releer
 * (a más de `umbralLlegada` px del final) no lo mueve y deja `hayNuevo` para el botón «Ver lo nuevo», que lo lleva
 * con suavidad a la cabecera de lo que llegó (`irALoNuevo`).
 */
export function useSeguirFinal({ contenedorRef, contenidoRef, umbral = 120, umbralLlegada = 200 }: Opciones): {
  pegado: boolean;
  hayNuevo: boolean;
  irAlFinal: (comportamiento?: ScrollBehavior) => void;
  mostrarMensaje: (id: string) => void;
  mostrarLlegada: (id: string) => void;
  irALoNuevo: () => void;
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
  // Distancia al final medida en el último scroll: crecer el contenido no la cambia, así que dice dónde estaba el
  // cliente ANTES de que llegara lo nuevo.
  const distanciaRef = useRef(0);
  // Mensaje que llegó mientras el cliente releía arriba: «Ver lo nuevo» lleva a su cabecera.
  const nuevoIdRef = useRef<string | null>(null);

  useEffect(() => {
    const contenedor = contenedorRef.current;
    if (!contenedor) return;
    const medir = () => {
      const distancia = contenedor.scrollHeight - contenedor.scrollTop - contenedor.clientHeight;
      distanciaRef.current = distancia;
      const cerca = distancia < umbral;
      if (!cerca && destinoRef.current === "final" && performance.now() < suspendidoHastaRef.current) return;
      if (cerca) destinoRef.current = null;
      pegadoRef.current = cerca;
      setPegado(cerca);
      if (cerca) { nuevoIdRef.current = null; setHayNuevo(false); return; }
      // Si el cliente bajó por su cuenta hasta lo nuevo, el aviso sobra.
      const nuevo = nuevoIdRef.current;
      const elemento = nuevo ? contenedor.querySelector<HTMLElement>(`[data-mensaje-id="${CSS.escape(nuevo)}"]`) : null;
      if (elemento && elemento.getBoundingClientRect().top < contenedor.getBoundingClientRect().bottom - 48) { nuevoIdRef.current = null; setHayNuevo(false); }
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
    // El último mensaje y su alto: «Ver lo nuevo» es para lo que llega AL FINAL de la conversación (un mensaje nuevo o
    // el último que sigue escribiéndose), no para una tarjeta que cambia donde el cliente la está mirando.
    const ultimoMensaje = () => {
      const mensajes = contenido.querySelectorAll<HTMLElement>("[data-mensaje-id]");
      return mensajes.length ? mensajes[mensajes.length - 1]! : null;
    };
    let ultimoId = ultimoMensaje()?.dataset.mensajeId ?? null;
    let altoUltimo = ultimoMensaje()?.offsetHeight ?? 0;
    const observador = new ResizeObserver(() => {
      const nuevo = contenido.offsetHeight;
      const crecio = nuevo > alto + 1;
      alto = nuevo;
      const ultimo = ultimoMensaje();
      const id = ultimo?.dataset.mensajeId ?? null;
      const altoActual = ultimo?.offsetHeight ?? 0;
      const cambioAlFinal = id !== ultimoId || altoActual > altoUltimo + 1;
      ultimoId = id;
      altoUltimo = altoActual;
      if (!crecio) return;
      if (destinoRef.current === "mensaje" && performance.now() < suspendidoHastaRef.current) return;
      if (pegadoRef.current) { contenedor.scrollTo({ top: contenedor.scrollHeight, behavior: "auto" }); return; }
      // Releyendo arriba: solo se avisa si lo que creció es el final y empieza por debajo de lo que se ve. Un ajuste en
      // «Ajustar mi plan» hace crecer la tarjeta que el cliente tiene delante: la píldora tapaba sus botones (390 px).
      if (cambioAlFinal && ultimo && ultimo.getBoundingClientRect().top >= contenedor.getBoundingClientRect().bottom - 48) setHayNuevo(true);
    });
    observador.observe(contenido);
    return () => observador.disconnect();
  }, [contenedorRef, contenidoRef]);

  const irAlFinal = useCallback((comportamiento?: ScrollBehavior) => {
    const contenedor = contenedorRef.current;
    nuevoIdRef.current = null;
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

  const mostrarLlegada = useCallback((id: string) => {
    const contenedor = contenedorRef.current;
    if (!contenedor) return;
    // Cerca del final, o camino del final por un desplazamiento pedido: como siempre, a la cabecera de lo nuevo.
    const yendoAlFinal = destinoRef.current === "final" && performance.now() < suspendidoHastaRef.current;
    if (distanciaRef.current < umbralLlegada || yendoAlFinal) { mostrarMensaje(id); return; }
    // Releyendo arriba: la vista se queda donde está. Solo si lo nuevo empieza por debajo de lo que se ve, se avisa.
    const elemento = contenedor.querySelector<HTMLElement>(`[data-mensaje-id="${CSS.escape(id)}"]`);
    if (!elemento || elemento.getBoundingClientRect().top < contenedor.getBoundingClientRect().bottom - 48) return;
    nuevoIdRef.current = id;
    setHayNuevo(true);
  }, [contenedorRef, mostrarMensaje, umbralLlegada]);

  const irALoNuevo = useCallback(() => {
    const id = nuevoIdRef.current;
    nuevoIdRef.current = null;
    setHayNuevo(false);
    if (id && contenedorRef.current?.querySelector(`[data-mensaje-id="${CSS.escape(id)}"]`)) mostrarMensaje(id);
    else irAlFinal();
  }, [contenedorRef, irAlFinal, mostrarMensaje]);

  const seguirSiPegado = useCallback(() => {
    const contenedor = contenedorRef.current;
    if (!contenedor || !pegadoRef.current) return;
    if (destinoRef.current === "mensaje" && performance.now() < suspendidoHastaRef.current) return;
    contenedor.scrollTo({ top: contenedor.scrollHeight, behavior: "auto" });
  }, [contenedorRef]);

  return { pegado, hayNuevo, irAlFinal, mostrarMensaje, mostrarLlegada, irALoNuevo, seguirSiPegado };
}

/**
 * Botón flotante para volver abajo. Con algo nuevo mientras el cliente releía arriba es una pastilla discreta
 * «Ver lo nuevo ↓»; si no, el círculo «Ir al final».
 */
export function BotonIrAlFinal({ visible, hayNuevo, onClick }: { visible: boolean; hayNuevo: boolean; onClick: () => void }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          key={hayNuevo ? "nuevo" : "final"}
          type="button"
          aria-label={hayNuevo ? "Ver lo nuevo" : "Ir al final"}
          title={hayNuevo ? "Ver lo nuevo" : "Ir al final"}
          onClick={onClick}
          initial={{ opacity: 0, y: 8, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.9 }}
          transition={RESORTE}
          whileTap={{ scale: 0.95 }}
          className={`absolute bottom-3 left-1/2 z-10 -translate-x-1/2 shadow-lg ring-1 ring-borde focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50 ${hayNuevo
            ? "inline-flex min-h-11 items-center gap-1.5 rounded-full bg-superficie/95 px-4 text-sm font-medium text-texto backdrop-blur-sm"
            : "grid size-11 place-items-center rounded-full bg-superficie text-texto"}`}
        >
          {hayNuevo && <span className="size-2 rounded-full bg-acento" aria-hidden />}
          {hayNuevo && "Ver lo nuevo"}
          <ArrowDown className={hayNuevo ? "size-4" : "size-5"} aria-hidden />
        </motion.button>
      )}
    </AnimatePresence>
  );
}
