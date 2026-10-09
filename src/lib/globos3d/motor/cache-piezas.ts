import type { CachePiezasEspec, PiezaPreparada } from "./espec-a-escena";

/**
 * Las piezas ya armadas, por su espec: una edición del cliente cambia una o dos piezas y las demás no se vuelven a armar
 * (REQ-007, fase 5). Con tope: al pasarse sale la menos usada. Solo guarda números y geometría ya armada, nunca recursos de
 * GPU (D-017). `estadisticas` deja ver cuántas se rearmaron (para el registro y las pruebas).
 */
export type CachePiezas = CachePiezasEspec & { estadisticas: () => { aciertos: number; fallos: number; guardadas: number } };

export function crearCachePiezas(tope: number): CachePiezas {
  const guardadas = new Map<string, PiezaPreparada>();
  let aciertos = 0;
  let fallos = 0;
  return {
    leer(clave) {
      const pieza = guardadas.get(clave);
      if (!pieza) { fallos += 1; return undefined; }
      aciertos += 1;
      guardadas.delete(clave);
      guardadas.set(clave, pieza);
      return pieza;
    },
    guardar(clave, pieza) {
      guardadas.delete(clave);
      guardadas.set(clave, pieza);
      while (guardadas.size > tope) guardadas.delete(guardadas.keys().next().value as string);
    },
    estadisticas: () => ({ aciertos, fallos, guardadas: guardadas.size }),
  };
}
