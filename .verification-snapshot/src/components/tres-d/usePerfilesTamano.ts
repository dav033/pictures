"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { guardarPerfilesPropios, leerPerfilesPropios, quitarPerfilPropio, type PerfilTamano } from "@/lib/globos3d/perfiles-tamano";
import { almacenLocal, guardarEnAlmacen, suscribirAlmacen } from "./almacen-local";

/**
 * Los perfiles de tamaño que el usuario guardó en este navegador. Empiezan vacíos en el servidor y en la hidratación, y
 * luego se leen de este navegador (`useSyncExternalStore`, sin setState en un efecto). `guardar` y `eliminar` devuelven
 * `false` si el navegador no deja escribir; en ese caso la lista sigue en memoria.
 */
export function usePerfilesPropios(): { propios: PerfilTamano[]; guardar: (perfil: PerfilTamano) => boolean; eliminar: (id: string) => boolean } {
  const leidoJson = useSyncExternalStore(suscribirAlmacen, () => JSON.stringify(leerPerfilesPropios(almacenLocal())), () => "[]");
  const [escritos, setEscritos] = useState<PerfilTamano[] | null>(null);
  const propios = useMemo(() => escritos ?? (JSON.parse(leidoJson) as PerfilTamano[]), [escritos, leidoJson]);
  const guardar = useCallback((perfil: PerfilTamano) => {
    const siguientes = [...propios, perfil];
    const guardado = guardarEnAlmacen((almacen) => guardarPerfilesPropios(almacen, siguientes));
    setEscritos(guardado ? null : siguientes);
    return guardado;
  }, [propios]);
  const eliminar = useCallback((id: string) => {
    const siguientes = quitarPerfilPropio(propios, id);
    const guardado = guardarEnAlmacen((almacen) => guardarPerfilesPropios(almacen, siguientes));
    setEscritos(guardado ? null : siguientes);
    return guardado;
  }, [propios]);
  return { propios, guardar, eliminar };
}
