"use client";

import type { EstructuraOficialId } from "@/lib/plan/estructuras-oficiales";
import { vistaDePieza } from "./firma-plan";
import type { FirmaPlan } from "./gestor-vista";
import { useImagenPlan3D } from "./usarImagenPlan3D";

/** El lado (px) de la imagen de una pieza: cabe en el marco de su fila (80–96 px) con densidad doble. */
export const LADO_MINIATURA = 192;

export type PropsMiniaturaPieza = { firma: FirmaPlan; piezaId: string; nombre: string; oficial: EstructuraOficialId | null };

/**
 * El dibujo de una fila de «Tu plan» en un plan 3D: la pieza sola, encuadrada por su caja, con el mismo visor sin pantalla de
 * la vista grande. Mientras llega (o si no llega) no pinta nada y queda debajo el icono de la pieza, que es lo que había antes.
 */
export function MiniaturaPieza3D({ firma, piezaId, nombre, oficial }: PropsMiniaturaPieza) {
  const estado = useImagenPlan3D(firma, { pieza: piezaId, vista: vistaDePieza(oficial), lado: LADO_MINIATURA });
  if (estado.fase !== "lista") return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={estado.imagen.url} alt={`Cómo se ve ${nombre}`} width={LADO_MINIATURA} height={LADO_MINIATURA} className="size-full rounded-lg object-cover" draggable={false} />;
}
