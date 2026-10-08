"use client";

import { createContext } from "react";
import type { Decoracion } from "@/lib/globos3d/figuras";
import type { Pieza } from "@/lib/globos3d/piezas";

/**
 * Lo que se empieza a arrastrar del panel hacia el visor: una decoración (se suelta sobre una estructura, una pared o
 * el techo) o una pieza cualquiera de «Añadir» (una estructura nueva, un globo suelto: va al piso, a una pared o al techo).
 */
export type DecoracionArrastrada =
  | { decoracion: Decoracion; pieza?: undefined; nombre: string; idBase: string }
  | { pieza: Pieza; decoracion?: undefined; nombre: string; idBase: string };

/**
 * Del panel de decoraciones pequeñas al visor: el panel avisa que una tarjeta empezó a arrastrarse (con el ratón o
 * un lápiz; con el dedo se sigue tocando la tarjeta y eligiendo dónde) y el visor se encarga del resto.
 */
export const ArrastreDecoracionContexto = createContext<((d: DecoracionArrastrada, inicio: { x: number; y: number }) => void) | null>(null);
