import { useEffect, useState, useSyncExternalStore } from "react";
import { crearVistaReparto, type EstadoVistaReparto } from "./vista-reparto";

type Pedir<R> = (participaciones: readonly number[], signal: AbortSignal) => Promise<R>;

const SIN_VISTA: EstadoVistaReparto<never> = { vista: null, participaciones: null, actualizando: false, apagada: false };
const sinPedir = (): Promise<never> => Promise.reject(new Error("sin vista previa"));

/**
 * `crearVistaReparto` para el deslizador de colores: una instancia por
 * montaje. `mostrados` es lo que muestra la barra cuando no es lo del plan
 * (`null` en cuanto vuelve a él). Sin `pedir` (la pieza no es un confeti) no
 * hay vista previa. `pedir` puede cambiar en cada render; se usa el último.
 */
export function useVistaReparto<R>(pedir: Pedir<R> | undefined, mostrados: readonly number[] | null): EstadoVistaReparto<R> {
  const [control] = useState(() => crearVistaReparto<R>({
    pedir: pedir ?? sinPedir,
    // Fallar es volver a la barra sola, como sin patrón: queda rastro para quien depura.
    alFallar: (error) => console.warn("[reparto] la vista previa en vivo no respondió; sigue la barra sola.", error instanceof Error ? error.message : error),
  }));
  useEffect(() => {
    control.usarPedir(pedir ?? sinPedir);
  }, [control, pedir]);
  const activa = Boolean(pedir);
  const clave = activa && mostrados ? mostrados.join(",") : null;
  useEffect(() => {
    control.mostrar(clave === null ? null : clave.split(",").map(Number));
  }, [control, clave]);
  // Desmontar (o el doble montaje de desarrollo) cancela lo que vuele; al montar de nuevo se vuelve a pedir.
  useEffect(() => () => control.mostrar(null), [control]);
  const estado = useSyncExternalStore(control.suscribir, control.estado, control.estado);
  return activa ? estado : SIN_VISTA;
}
