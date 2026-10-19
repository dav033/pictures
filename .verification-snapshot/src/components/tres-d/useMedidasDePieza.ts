import { useState } from "react";

/**
 * El interruptor de las medidas de alto y ancho. Valen para la pieza que estaba elegida al encenderlas: elegir otra, o
 * quitar la selección, las apaga (no quedan encendidas esperando a la próxima pieza). Sin pieza elegida no se enciende.
 */
export function useMedidasDePieza(seleccion: string | null): { verMedidas: boolean; alternarMedidas: () => void } {
  const [medidasDe, setMedidasDe] = useState<string | null>(null);
  // Ajuste de estado al cambiar la selección (patrón de React para derivar estado de las props, sin efecto).
  if (medidasDe !== null && medidasDe !== seleccion) setMedidasDe(null);
  return {
    verMedidas: medidasDe !== null && medidasDe === seleccion,
    alternarMedidas: () => setMedidasDe(medidasDe === null ? seleccion : null),
  };
}
