import { useEffect, useState, useSyncExternalStore } from "react";
import { crearAutoguardado, type Autoguardado, type EstadoAutoguardado, type OpcionesAutoguardado } from "./autoguardado";
import type { PendientesAjustes } from "./cola-ajustes";

type Opciones<T> = Omit<OpcionesAutoguardado<T>, "alPendiente"> & {
  /** Contador de la tarjeta: mientras este control tenga algo sin guardar, aprobar espera. */
  pendientes?: PendientesAjustes;
};

/**
 * `crearAutoguardado` para un componente: una instancia por montaje y su
 * estado como estado de React. `guardar` puede cambiar en cada render; se usa
 * siempre el último. Desmontar no cancela nada: lo que ya salió o se cerró
 * termina igual, quien guarda muestra el resultado y el contador de
 * pendientes se entera igual (el aviso no depende del montaje).
 */
export function useAutoguardado<T>({ pendientes, ...opciones }: Opciones<T>): { estado: EstadoAutoguardado; control: Autoguardado<T> } {
  const [control] = useState(() => crearAutoguardado({ ...opciones, alPendiente: pendientes?.avisador() }));
  const { guardar } = opciones;
  useEffect(() => {
    control.usarGuardar(guardar);
  }, [control, guardar]);
  const estado = useSyncExternalStore(control.suscribir, control.estado, control.estado);
  return { estado, control };
}
