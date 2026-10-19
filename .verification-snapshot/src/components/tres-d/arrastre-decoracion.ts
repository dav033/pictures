"use client";

import { createContext, useContext, useRef, type MouseEvent, type PointerEvent } from "react";
import type { Decoracion } from "@/lib/globos3d/figuras";
import type { Pieza } from "@/lib/globos3d/piezas";
import { baseIdDe, type ItemBiblioteca } from "@/lib/globos3d/biblioteca";

/**
 * Lo que se empieza a arrastrar del panel hacia el visor: una decoración (se suelta sobre una estructura, una pared o
 * el techo) o una pieza cualquiera de «Añadir» (una estructura nueva, un globo suelto: va al piso, a una pared o al techo).
 */
export type DecoracionArrastrada =
  | { decoracion: Decoracion; pieza?: undefined; item?: undefined; nombre: string; idBase: string }
  /** Con `item` (de la biblioteca), al soltar entra el item entero (la estructura con sus decoraciones) con su raíz ahí. */
  | { pieza: Pieza; decoracion?: undefined; item?: ItemBiblioteca; nombre: string; idBase: string };

/**
 * Lo que arrastra una tarjeta de la biblioteca: una decoración va como decoración (se suelta también sobre una
 * estructura); una pieza o una estructura con sus decoraciones, como pieza (al piso, una pared o el techo), con su raíz
 * de vista previa. Las ideas (escenas enteras) no se arrastran: se abren en su ficha.
 */
export function arrastreDeItem(item: ItemBiblioteca): DecoracionArrastrada | null {
  const c = item.contenido;
  if (c.tipo === "escena") return null;
  const pieza = c.tipo === "pieza" ? c.pieza : c.conjunto.raiz.pieza;
  if (c.tipo === "pieza" && pieza.tipo === "decoracion") return { decoracion: pieza.decoracion, nombre: item.nombre, idBase: baseIdDe(pieza) };
  return { pieza, item, nombre: item.nombre, idBase: baseIdDe(pieza) };
}

/**
 * Del panel de decoraciones pequeñas al visor: el panel avisa que una tarjeta empezó a arrastrarse (con el ratón o
 * un lápiz; con el dedo se sigue tocando la tarjeta y eligiendo dónde) y el visor se encarga del resto.
 */
export const ArrastreDecoracionContexto = createContext<((d: DecoracionArrastrada, inicio: { x: number; y: number }) => void) | null>(null);

/**
 * Para una lista de tarjetas del panel (murales, formas y letras…): `apretar` empieza el arrastre al visor con el ratón
 * o un lápiz (con el dedo, la tarjeta se toca como siempre) y `fueArrastre` dice en el clic si eso fue un arrastre que
 * ya puso la pieza (entonces el clic no hace nada más). Una sola referencia para toda la lista: se aprieta de a una.
 */
export function useArrastreDesdePanel() {
  const arrastrar = useContext(ArrastreDecoracionContexto);
  const apretada = useRef<{ x: number; y: number } | null>(null);
  return {
    arrastrable: Boolean(arrastrar),
    apretar: (e: PointerEvent<HTMLElement>, crear: () => DecoracionArrastrada | null) => {
      apretada.current = { x: e.clientX, y: e.clientY };
      if (!arrastrar || e.button !== 0 || e.pointerType === "touch") return;
      const d = crear();
      if (!d) return;
      e.preventDefault();
      arrastrar(d, { x: e.clientX, y: e.clientY });
    },
    fueArrastre: (e: MouseEvent<HTMLElement>) => {
      const desde = apretada.current;
      apretada.current = null;
      return Boolean(desde && e.detail > 0 && Math.hypot(e.clientX - desde.x, e.clientY - desde.y) > 6);
    },
  };
}
