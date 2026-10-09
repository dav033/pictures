import type { Sala } from "@/lib/globos3d/escena";

/** Ancho y alto mínimos (cm) de la pared del fondo en la captura: que sus bordes queden fuera de cuadro en cualquier vista. */
const ANCHO_MINIMO_CM = 2400;
const ALTO_MINIMO_CM = 900;

/**
 * La sala de la captura: piso y pared del fondo lisos en gris claro, sin techo ni paredes laterales. Solo se agranda el
 * ancho y el alto (la profundidad no: de ella depende dónde está la pared y, con ella, las piezas colgadas), así no se ven
 * los bordes de la pared.
 */
export function salaNeutra(sala: Sala): Sala {
  return {
    ...sala, anchoCm: Math.max(sala.anchoCm, ANCHO_MINIMO_CM), altoCm: Math.max(sala.altoCm, ALTO_MINIMO_CM),
    tonos: { piso: "#d6d6da", paredes: "#dcdce0", techo: "#e6e6e9" }, mostrar: { piso: true, fondo: true, laterales: false, techo: false },
    // Las miniaturas de la biblioteca van sobre un fondo liso y neutro: sin madera ni luces.
    ambiente: { piso: "liso", luces: false, ventana: false },
  };
}
