"use client";

import { useCallback, useEffect, useState } from "react";
import { guardarPerfilesPropios, leerPerfilesPropios, quitarPerfilPropio, type PerfilTamano } from "@/lib/globos3d/perfiles-tamano";
import { almacenLocal } from "./almacen-local";

/**
 * Los perfiles de tamaño que el usuario guardó en este navegador. Empiezan vacíos y se leen al montar (no en el render).
 * `guardar` y `eliminar` devuelven `false` si el navegador no deja escribir.
 */
export function usePerfilesPropios(): { propios: PerfilTamano[]; guardar: (perfil: PerfilTamano) => boolean; eliminar: (id: string) => boolean } {
  const [propios, setPropios] = useState<PerfilTamano[]>([]);
  useEffect(() => { setPropios(leerPerfilesPropios(almacenLocal())); }, []);
  const guardar = useCallback((perfil: PerfilTamano) => {
    const siguientes = [...propios, perfil];
    setPropios(siguientes);
    return guardarPerfilesPropios(almacenLocal(), siguientes);
  }, [propios]);
  const eliminar = useCallback((id: string) => {
    const siguientes = quitarPerfilPropio(propios, id);
    setPropios(siguientes);
    return guardarPerfilesPropios(almacenLocal(), siguientes);
  }, [propios]);
  return { propios, guardar, eliminar };
}
