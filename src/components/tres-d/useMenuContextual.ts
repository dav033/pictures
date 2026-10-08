"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { EscenaGlobos } from "./escena-globos";

/** Cuánto hay que mantener el dedo sobre una pieza para abrir su menú. */
export const MANTENER_MS = 500;
/** Más que esto (px) es arrastrar u orbitar, no mantener (ni un clic derecho: era mover la cámara). */
const TOLERANCIA_PX = 8;

type Opciones = {
  lienzoRef: RefObject<HTMLCanvasElement | null>;
  visorRef: RefObject<EscenaGlobos | null>;
  activo: boolean;
  /** La pieza elegida (para la tecla Menú / Shift+F10) y dónde está en el mundo (cm), para abrir el menú junto a ella. */
  elegida: () => { id: string; centro: { x: number; y: number; z: number } } | null;
  onAbrir: (id: string, x: number, y: number, tactil: boolean) => void;
};

function escribiendo(objetivo: EventTarget | null): boolean {
  return objetivo instanceof HTMLElement && (objetivo.isContentEditable || Boolean(objetivo.closest("input, textarea, select, [contenteditable='true'], [role='menu']")));
}

/**
 * Cómo se abre el menú contextual de una pieza en el visor:
 * - clic derecho sobre ella (si no se arrastró: arrastrar con el derecho mueve la cámara);
 * - mantener el dedo ~500 ms sin moverlo (moverlo antes sigue orbitando o arrastrando como siempre). Al abrirse se
 *   cancela el gesto en curso (un `pointercancel`): ni la cámara ni la pieza se mueven si el dedo se corre después;
 * - la tecla Menú o Shift+F10 con una pieza elegida (fuera de los campos de texto), junto a esa pieza.
 */
export function useMenuContextual(opciones: Opciones) {
  const datos = useRef(opciones);
  useEffect(() => { datos.current = opciones; });
  const { activo, lienzoRef, visorRef } = opciones;

  useEffect(() => {
    const lienzo = lienzoRef.current;
    if (!activo || !lienzo) return;
    let derecho: { x: number; y: number } | null = null;
    let presion: { id: number; tipo: string; x: number; y: number; reloj: number } | null = null;
    const punteros = new Set<number>();
    let abiertoEn = -Infinity;
    let tecladoEn = -Infinity;

    const soltarPresion = () => { if (presion) clearTimeout(presion.reloj); presion = null; };
    const abrirEn = (x: number, y: number, tactil: boolean) => {
      const toque = visorRef.current?.piezaEn(x, y);
      if (!toque) return false;
      abiertoEn = performance.now();
      datos.current.onAbrir(toque.nodo, x, y, tactil);
      return true;
    };

    const alApretar = (e: PointerEvent) => {
      punteros.add(e.pointerId);
      if (e.button === 2) derecho = { x: e.clientX, y: e.clientY };
      if (e.pointerType === "mouse" || e.button !== 0) return;
      // Dos dedos: es pellizcar.
      if (punteros.size > 1) { soltarPresion(); return; }
      const p = { id: e.pointerId, tipo: e.pointerType, x: e.clientX, y: e.clientY, reloj: 0 };
      p.reloj = window.setTimeout(() => {
        if (presion !== p) return;
        presion = null;
        if (!abrirEn(p.x, p.y, true)) return;
        // Corta el gesto en curso (cámara, arrastre de pieza o de decoración) como si el sistema lo cancelara.
        lienzo.dispatchEvent(new PointerEvent("pointercancel", { pointerId: p.id, pointerType: p.tipo, bubbles: true }));
      }, MANTENER_MS);
      presion = p;
    };
    const alMover = (e: PointerEvent) => {
      if (presion && e.pointerId === presion.id && Math.hypot(e.clientX - presion.x, e.clientY - presion.y) > TOLERANCIA_PX) soltarPresion();
    };
    const alSoltar = (e: PointerEvent) => { punteros.delete(e.pointerId); if (presion?.id === e.pointerId) soltarPresion(); };
    const alMenu = (e: MouseEvent) => {
      e.preventDefault();
      // Ya lo abrió el dedo (Android también manda `contextmenu` al mantener).
      if (performance.now() - abiertoEn < 1500) return;
      if (presion) { const p = presion; soltarPresion(); abrirEn(p.x, p.y, true); return; }
      const inicio = derecho;
      derecho = null;
      if (inicio && Math.hypot(e.clientX - inicio.x, e.clientY - inicio.y) > TOLERANCIA_PX) return;
      abrirEn(e.clientX, e.clientY, false);
    };
    const alTeclado = (e: KeyboardEvent) => {
      if (e.defaultPrevented || escribiendo(e.target)) return;
      if (e.key !== "ContextMenu" && !(e.shiftKey && e.key === "F10")) return;
      const elegida = datos.current.elegida();
      if (!elegida) return;
      e.preventDefault();
      tecladoEn = performance.now();
      const r = lienzo.getBoundingClientRect();
      const p = visorRef.current?.aPantalla(elegida.centro);
      const x = p ? Math.min(r.right, Math.max(r.left, p.x)) : r.left + r.width / 2;
      const y = p ? Math.min(r.bottom, Math.max(r.top, p.y)) : r.top + r.height / 2;
      datos.current.onAbrir(elegida.id, x, y, false);
    };
    // La tecla Menú también manda `contextmenu` (al foco): ese no abre el del navegador.
    const alMenuVentana = (e: MouseEvent) => { if (performance.now() - tecladoEn < 1000) e.preventDefault(); };

    lienzo.addEventListener("pointerdown", alApretar, { capture: true });
    lienzo.addEventListener("pointermove", alMover);
    lienzo.addEventListener("pointerup", alSoltar);
    lienzo.addEventListener("pointercancel", alSoltar);
    lienzo.addEventListener("contextmenu", alMenu);
    window.addEventListener("keydown", alTeclado);
    window.addEventListener("contextmenu", alMenuVentana, true);
    return () => {
      soltarPresion();
      lienzo.removeEventListener("pointerdown", alApretar, { capture: true });
      lienzo.removeEventListener("pointermove", alMover);
      lienzo.removeEventListener("pointerup", alSoltar);
      lienzo.removeEventListener("pointercancel", alSoltar);
      lienzo.removeEventListener("contextmenu", alMenu);
      window.removeEventListener("keydown", alTeclado);
      window.removeEventListener("contextmenu", alMenuVentana, true);
    };
  }, [activo, lienzoRef, visorRef]);
}
