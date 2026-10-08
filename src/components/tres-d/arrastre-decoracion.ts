"use client";

import { createContext } from "react";
import type { Decoracion } from "@/lib/globos3d/figuras";

/** Una decoración del panel que se empieza a arrastrar hacia el visor. */
export type DecoracionArrastrada = { decoracion: Decoracion; nombre: string; idBase: string };

/**
 * Del panel de decoraciones pequeñas al visor: el panel avisa que una tarjeta empezó a arrastrarse (con el ratón o
 * un lápiz; con el dedo se sigue tocando la tarjeta y eligiendo dónde) y el visor se encarga del resto.
 */
export const ArrastreDecoracionContexto = createContext<((d: DecoracionArrastrada, inicio: { x: number; y: number }) => void) | null>(null);
