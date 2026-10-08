"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  descendientes, desplazamientoEntre, duplicarNodo, girarNodo, historialCambiar, historialDeshacer, historialNuevo, historialReemplazar,
  historialRehacer, marcoDePared, moverNodo, pasarDeAncla, quitarNodo, type Colocacion, type Escena, type EscenaArmada,
} from "@/lib/globos3d/escena";
import type { EscenaGlobos, Punto3 } from "./escena-globos";

/** Los cambios con la misma `agrupar` seguidos (menos de esto entre uno y otro) cuentan como un solo paso. */
const AGRUPAR_MS = 800;

/**
 * La escena con deshacer y rehacer (hasta 50 pasos). `cambiar(nueva)` guarda un paso; con `agrupar`, los cambios
 * seguidos de lo mismo (un deslizador que se arrastra) se guardan como uno solo.
 */
export function useHistorialEscena(inicial: () => Escena) {
  const [historial, setHistorial] = useState(() => historialNuevo(inicial()));
  const ultimo = useRef<{ clave: string; t: number } | null>(null);
  const cambiar = useCallback((nueva: Escena, opciones?: { agrupar?: string }) => {
    const ahora = Date.now();
    const clave = opciones?.agrupar;
    const juntar = Boolean(clave && ultimo.current?.clave === clave && ahora - ultimo.current.t < AGRUPAR_MS);
    ultimo.current = clave ? { clave, t: ahora } : null;
    setHistorial((h) => (juntar ? historialReemplazar(h, nueva) : historialCambiar(h, nueva)));
  }, []);
  const deshacer = useCallback(() => { ultimo.current = null; setHistorial(historialDeshacer); }, []);
  const rehacer = useCallback(() => { ultimo.current = null; setHistorial(historialRehacer); }, []);
  return { escena: historial.presente, cambiar, deshacer, rehacer, puedeDeshacer: historial.pasado.length > 0, puedeRehacer: historial.futuro.length > 0 };
}

export type PiezaEnVivo = { id: string; colocacion: Colocacion };

type Opciones = {
  lienzoRef: RefObject<HTMLCanvasElement | null>;
  visorRef: RefObject<EscenaGlobos | null>;
  /** Solo en la pestaña Escena y con el visor listo. */
  activo: boolean;
  escena: Escena;
  armada: EscenaArmada | null;
  seleccion: string | null;
  onSeleccion: (id: string | null) => void;
  /** Un cambio hecho a mano (guarda un paso en el historial). */
  onCambio: (escena: Escena) => void;
  /** Dónde va la pieza mientras se arrastra (para ver sus coordenadas en vivo); `null` al soltar. */
  onEnVivo: (pieza: PiezaEnVivo | null) => void;
  onDeshacer: () => void;
  onRehacer: () => void;
};

const CERO: Punto3 = { x: 0, y: 0, z: 0 };
const ARRIBA: Punto3 = { x: 0, y: 1, z: 0 };
/** Menos que esto (px) entre apretar y soltar es un clic (elige), no un arrastre de cámara. */
const CLIC_PX = 5;

/** El eje del mundo (±x o ±z) más parecido a una dirección horizontal: las flechas mueven en pasos limpios. */
function ejeMasCercano(v: Punto3): Punto3 {
  return Math.abs(v.x) >= Math.abs(v.z) ? { x: Math.sign(v.x) || 1, y: 0, z: 0 } : { x: 0, y: 0, z: Math.sign(v.z) || 1 };
}

const por = (v: Punto3, k: number): Punto3 => ({ x: v.x * k, y: v.y * k, z: v.z * k });

/** El foco está donde se escribe (o en un deslizador): las teclas son suyas. */
function escribiendo(objetivo: EventTarget | null): boolean {
  return objetivo instanceof HTMLElement && (objetivo.isContentEditable || Boolean(objetivo.closest("input, textarea, select, [contenteditable='true']")));
}

/**
 * Edición a mano de la escena en el visor:
 * - clic sobre una pieza la elige; clic en el vacío la suelta;
 * - arrastrar la pieza elegida la mueve sobre su superficie (piso, pared o techo; lo colgado de un ancla o apoyado
 *   sobre otra pieza lo coge `useLienzoDecoraciones`) con imán de 5 cm (Alt lo quita) y sin salirse de la sala; mientras, la cámara no gira y lo dibujado
 *   se corre sin rearmar nada; al soltar se guarda;
 * - teclado (fuera de los campos de texto): flechas 5 cm (Shift 25) relativo a la cámara, Q/E giran 15° (Shift
 *   45°), RePág/AvPág suben y bajan (pared y techo), Supr quita, Ctrl+D duplica, Ctrl+Z/Ctrl+Y deshacen y rehacen
 *   y Esc suelta la pieza. A lo colgado de un ancla, las flechas lo pasan a la ancla siguiente o anterior.
 */
export function useEdicionEscena(opciones: Opciones) {
  const datos = useRef(opciones);
  useEffect(() => { datos.current = opciones; });
  const { activo, lienzoRef, visorRef } = opciones;

  // Teclado.
  useEffect(() => {
    if (!activo) return;
    const alTeclado = (e: KeyboardEvent) => {
      if (e.defaultPrevented || escribiendo(e.target)) return;
      const d = datos.current;
      const tecla = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (tecla === "z" && !e.shiftKey) { e.preventDefault(); d.onDeshacer(); }
        else if (tecla === "y" || (tecla === "z" && e.shiftKey)) { e.preventDefault(); d.onRehacer(); }
        else if (tecla === "d" && d.seleccion) {
          e.preventDefault();
          const nueva = duplicarNodo(d.escena, d.seleccion);
          const copia = nueva.nodos.find((n) => !d.escena.nodos.some((x) => x.id === n.id));
          d.onCambio(nueva);
          if (copia) d.onSeleccion(copia.id);
        }
        return;
      }
      if (e.ctrlKey || e.metaKey) return;
      const id = d.seleccion;
      const nodo = id ? d.escena.nodos.find((n) => n.id === id) : undefined;
      if (tecla === "Escape") { if (id) { e.preventDefault(); d.onSeleccion(null); } return; }
      if (!nodo) return;
      const c = nodo.colocacion;
      const paso = e.shiftKey ? 25 : 5;
      const opcionesMover = { armada: d.armada ?? undefined, iman: !e.altKey };
      const mover = (delta: Punto3) => moverNodo(d.escena, nodo.id, delta, opcionesMover);
      let nueva: Escena | null = null;
      if (tecla === "Delete") {
        nueva = quitarNodo(d.escena, nodo.id, d.armada ?? undefined);
        d.onSeleccion(null);
      } else if (tecla === "q" || tecla === "e") {
        nueva = girarNodo(d.escena, nodo.id, (tecla === "q" ? 1 : -1) * (e.shiftKey ? 45 : 15));
      } else if (tecla === "PageUp" || tecla === "PageDown") {
        if (c.en === "pared" || c.en === "techo") nueva = mover(por(ARRIBA, tecla === "PageUp" ? paso : -paso));
        // Suelta: Re Pág / Av Pág la traen al frente o la llevan al fondo (↑/↓ ya la suben y la bajan).
        else if (c.en === "libre") nueva = mover({ x: 0, y: 0, z: tecla === "PageUp" ? paso : -paso });
        else { e.preventDefault(); return; }
      } else if (tecla === "ArrowUp" || tecla === "ArrowDown" || tecla === "ArrowLeft" || tecla === "ArrowRight") {
        const signo = tecla === "ArrowUp" || tecla === "ArrowRight" ? 1 : -1;
        const lateral = tecla === "ArrowLeft" || tecla === "ArrowRight";
        if (c.en === "ancla") nueva = pasarDeAncla(d.escena, nodo.id, signo * (e.shiftKey ? 5 : 1), d.armada ?? undefined);
        else {
          const visor = visorRef.current;
          if (!visor) return;
          const { adelante, derecha } = visor.ejesCamara();
          if (c.en === "libre") {
            // Suelta: ←/→ por el eje de la sala más parecido a la derecha de la cámara, ↑/↓ en altura.
            nueva = mover(lateral ? por(ejeMasCercano(derecha), signo * paso) : por(ARRIBA, signo * paso));
          } else if (c.en === "pared") {
            // En la pared: ←/→ a lo largo (hacia donde se ve la derecha en pantalla), ↑/↓ en altura.
            const largo = marcoDePared(d.escena.sala, c.pared).derecha;
            const hacia = Math.sign(largo.x * derecha.x + largo.z * derecha.z) || 1;
            nueva = mover(lateral ? por(largo, hacia * signo * paso) : por(ARRIBA, signo * paso));
          } else {
            // En el piso y el techo: ↑ se aleja de la cámara, → va a su derecha (por el eje de la sala más parecido).
            nueva = mover(por(ejeMasCercano(lateral ? derecha : adelante), signo * paso));
          }
        }
      } else return;
      e.preventDefault();
      if (nueva && nueva !== d.escena) d.onCambio(nueva);
    };
    window.addEventListener("keydown", alTeclado);
    return () => window.removeEventListener("keydown", alTeclado);
  }, [activo, visorRef]);

  // Ratón y dedo sobre el lienzo.
  useEffect(() => {
    const lienzo = lienzoRef.current;
    if (!activo || !lienzo) return;
    type Arrastre = {
      id: string; ids: string[]; inicio: Escena; armada: EscenaArmada | null; colocacion: Colocacion;
      punto: Punto3; normal: Punto3; ultima: Escena | null; puntero: number;
    };
    let arrastre: Arrastre | null = null;
    let presion: { x: number; y: number } | null = null;
    let encima: { x: number; y: number } | null = null;
    let cuadro = 0;

    const cursor = (valor: string) => { lienzo.style.cursor = valor; };
    const terminar = (guardar: boolean) => {
      const a = arrastre;
      if (!a) return;
      arrastre = null;
      const visor = visorRef.current;
      visor?.orbitar(true);
      if (lienzo.hasPointerCapture(a.puntero)) lienzo.releasePointerCapture(a.puntero);
      const d = datos.current;
      d.onEnVivo(null);
      if (guardar && a.ultima && a.ultima !== a.inicio) d.onCambio(a.ultima);
      else visor?.trasladarPiezas(a.ids, CERO);
      cursor("grab");
    };

    const alApretar = (e: PointerEvent) => {
      if (e.button !== 0) return;
      presion = { x: e.clientX, y: e.clientY };
      const d = datos.current;
      const visor = visorRef.current;
      const nodo = d.seleccion ? d.escena.nodos.find((n) => n.id === d.seleccion) : undefined;
      // Lo colgado de un ancla o apoyado sobre otra pieza lo coge `useLienzoDecoraciones` (por copia, sobre la superficie).
      if (!visor || !nodo || nodo.colocacion.en === "ancla" || nodo.colocacion.en === "sobre") return;
      const toque = visor.piezaEn(e.clientX, e.clientY);
      if (!toque || toque.nodo !== nodo.id) return;
      // Se arrastra en el plano de su superficie que pasa por donde se tocó: la pieza sigue al puntero.
      // Suelta: en el plano de frente (x, y), como en la pared del fondo.
      const normal = nodo.colocacion.en === "pared" ? marcoDePared(d.escena.sala, nodo.colocacion.pared).normal : nodo.colocacion.en === "libre" ? { x: 0, y: 0, z: 1 } : ARRIBA;
      arrastre = { id: nodo.id, ids: [...descendientes(d.escena, nodo.id)], inicio: d.escena, armada: d.armada, colocacion: nodo.colocacion, punto: toque.punto, normal, ultima: null, puntero: e.pointerId };
      // Antes que la cámara (este oyente va en captura): así no gira mientras se arrastra.
      visor.orbitar(false);
      lienzo.setPointerCapture(e.pointerId);
      cursor("grabbing");
    };

    const alMover = (e: PointerEvent) => {
      const visor = visorRef.current;
      if (!visor) return;
      const a = arrastre;
      if (a) {
        const p = visor.puntoEnPlano(e.clientX, e.clientY, a.punto, a.normal);
        if (!p) return;
        const plano = a.colocacion.en === "piso" || a.colocacion.en === "techo";
        const delta = { x: p.x - a.punto.x, y: plano ? 0 : p.y - a.punto.y, z: p.z - a.punto.z };
        const nueva = moverNodo(a.inicio, a.id, delta, { armada: a.armada ?? undefined, iman: !e.altKey });
        const colocacion = nueva.nodos.find((n) => n.id === a.id)?.colocacion ?? a.colocacion;
        visor.trasladarPiezas(a.ids, desplazamientoEntre(a.inicio.sala, a.colocacion, colocacion) ?? CERO);
        a.ultima = nueva;
        datos.current.onEnVivo({ id: a.id, colocacion });
        return;
      }
      // Pasar por encima (sin botones): mano sobre una pieza; «agarrar» sobre la elegida si se puede arrastrar.
      if (e.buttons !== 0) return;
      encima = { x: e.clientX, y: e.clientY };
      if (cuadro) return;
      cuadro = requestAnimationFrame(() => {
        cuadro = 0;
        if (!encima || arrastre) return;
        const toque = visor.piezaEn(encima.x, encima.y);
        const d = datos.current;
        const elegido = d.escena.nodos.find((n) => n.id === d.seleccion);
        const tocado = toque ? d.escena.nodos.find((n) => n.id === toque.nodo) : undefined;
        const colgada = tocado?.colocacion.en === "ancla" || tocado?.colocacion.en === "sobre";
        cursor(!toque ? "" : colgada || (toque.nodo === elegido?.id && elegido.colocacion.en !== "ancla") ? "grab" : "pointer");
      });
    };

    const alSoltar = (e: PointerEvent) => {
      if (arrastre) { terminar(true); presion = null; return; }
      const inicio = presion;
      presion = null;
      if (e.button !== 0 || !inicio || Math.hypot(e.clientX - inicio.x, e.clientY - inicio.y) > CLIC_PX) return;
      // Un clic (no un giro de cámara): elige la pieza tocada o, en el vacío, suelta la elegida.
      const toque = visorRef.current?.piezaEn(e.clientX, e.clientY) ?? null;
      datos.current.onSeleccion(toque?.nodo ?? null);
    };

    const alCancelar = () => { presion = null; terminar(false); };
    const alSalir = () => { encima = null; if (!arrastre) cursor(""); };

    lienzo.addEventListener("pointerdown", alApretar, { capture: true });
    lienzo.addEventListener("pointermove", alMover);
    lienzo.addEventListener("pointerup", alSoltar);
    lienzo.addEventListener("pointercancel", alCancelar);
    lienzo.addEventListener("pointerleave", alSalir);
    return () => {
      terminar(false);
      cancelAnimationFrame(cuadro);
      lienzo.removeEventListener("pointerdown", alApretar, { capture: true });
      lienzo.removeEventListener("pointermove", alMover);
      lienzo.removeEventListener("pointerup", alSoltar);
      lienzo.removeEventListener("pointercancel", alCancelar);
      lienzo.removeEventListener("pointerleave", alSalir);
      cursor("");
    };
  }, [activo, lienzoRef, visorRef]);
}
