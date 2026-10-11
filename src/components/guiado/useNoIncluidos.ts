"use client";

import { useCallback, useState } from "react";
import type { NoIncluidoEnPrecio } from "@/lib/guiada-motor/no-incluidos";

/**
 * La nota de «no incluido en el precio» de cada tarjeta de precio (D-038), SOLO en memoria: la cotización se guarda en la sesión del
 * navegador con un esquema estricto, y una clave nueva descartaría la conversación entera a un despliegue anterior (D-035). Al
 * recargar, el precio sigue y la nota se pierde; el modelo ya la dijo en su respuesta.
 *
 * La nota es de UNA tarjeta, no de la idea: preguntar dos veces cuánto cuesta la misma idea deja dos tarjetas, cada una con lo que su
 * propio costeo dejó fuera, y la segunda no borra ni reescribe la primera.
 */
export type NotasNoIncluidos = Readonly<Record<string, readonly NoIncluidoEnPrecio[]>>;

/** La clave de un widget del mensaje: la misma con la que se pinta (`key`) y con la que se busca su nota. */
export const claveDeWidget = (mensajeId: string, posicion: number): string => `${mensajeId}-${posicion}`;

/** Recuerda lo que dejó fuera el costeo de una tarjeta; sin nada, olvida solo la de ESA tarjeta. */
export function recordarNota(previo: NotasNoIncluidos, clave: string, noIncluidos: readonly NoIncluidoEnPrecio[] | undefined): NotasNoIncluidos {
  if (noIncluidos?.length) return { ...previo, [clave]: noIncluidos };
  return clave in previo ? Object.fromEntries(Object.entries(previo).filter(([otra]) => otra !== clave)) : previo;
}

export function useNoIncluidos() {
  const [notas, setNotas] = useState<NotasNoIncluidos>({});
  const registrar = useCallback((clave: string, noIncluidos: readonly NoIncluidoEnPrecio[] | undefined) => setNotas((previo) => recordarNota(previo, clave, noIncluidos)), []);
  return { noIncluidos: notas, registrarNoIncluidos: registrar };
}
