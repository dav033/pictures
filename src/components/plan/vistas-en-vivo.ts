import { useSyncExternalStore } from "react";

/**
 * Dibujos en vivo del deslizador "Colores de la pieza", por pieza (ADR-0028
 * §13). El deslizador de un confeti deja aquí lo último que dibujó Python y
 * lo leen quienes lo muestran: el bloque del patrón de esa pieza y su tira en
 * el resumen. Vive fuera del estado de la tarjeta a propósito: con él dentro,
 * cada respuesta de Python volvía a pintar la tarjeta entera (las cuatro
 * piezas, sus dibujos y sus tiras: 444 globos por respuesta en el
 * laboratorio, tareas de 1 a 1,9 s por respuesta en un teléfono). Así solo se
 * vuelve a pintar lo que cambia. Sin lógica de patrón: guarda y avisa.
 */
export type VistasEnVivo<R> = {
  /** El dibujo en vivo de la pieza; `null` si la pieza muestra el de su plan. */
  vista: (id: string) => R | null;
  /** `null`: la pieza vuelve a mostrar el dibujo de su plan. */
  fijar: (id: string, vista: R | null) => void;
  suscribir: (oyente: () => void) => () => void;
};

export function crearVistasEnVivo<R>(): VistasEnVivo<R> {
  const vistas = new Map<string, R>();
  const oyentes = new Set<() => void>();
  return {
    vista: (id) => vistas.get(id) ?? null,
    fijar(id, vista) {
      if ((vistas.get(id) ?? null) === vista) return;
      if (vista === null) vistas.delete(id);
      else vistas.set(id, vista);
      for (const oyente of oyentes) oyente();
    },
    suscribir(oyente) {
      oyentes.add(oyente);
      return () => oyentes.delete(oyente);
    },
  };
}

const sinSuscripcion = () => () => undefined;

/**
 * El dibujo en vivo de la pieza `id`, o `null`. Solo vuelve a pintar a quien
 * lo usa cuando cambia el de SU pieza. Sin `vistas` (tarjeta sin edición),
 * siempre `null`.
 */
export function useVistaEnVivo<R>(vistas: VistasEnVivo<R> | undefined, id: string): R | null {
  const leer = () => vistas?.vista(id) ?? null;
  return useSyncExternalStore(vistas?.suscribir ?? sinSuscripcion, leer, leer);
}
