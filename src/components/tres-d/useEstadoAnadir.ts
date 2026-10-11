"use client";

import { useCallback, useState } from "react";
import type { EleccionAnadir } from "@/lib/catalogo/anadir-repositorios";
import type { PestanaAnadir } from "./PanelAnadir";

/**
 * Lo que tiene elegido el panel «Añadir»: la pestaña de Sempertex y el repositorio (REQ-013). Vive en `Taller3D`, no en el panel,
 * porque el taller también lo manda: «Colgar otra» pide Decoraciones, que son de Sempertex, y `pedirDecoraciones` lo deja en «Todos»
 * aunque la pestaña ya fuera esa. Con la interfaz por repositorio apagada, la elección no se usa y el panel es el de siempre.
 */
export function useEstadoAnadir() {
  const [estado, setEstado] = useState<{ pestana: PestanaAnadir; eleccion: EleccionAnadir }>({ pestana: "estructuras", eleccion: "todos" });
  const setPestana = useCallback((pestana: PestanaAnadir) => setEstado((e) => ({ ...e, pestana })), []);
  const setEleccion = useCallback((eleccion: EleccionAnadir) => setEstado((e) => ({ ...e, eleccion })), []);
  const pedirDecoraciones = useCallback(() => setEstado({ pestana: "decoraciones", eleccion: "todos" }), []);
  return { pestana: estado.pestana, eleccion: estado.eleccion, setPestana, setEleccion, pedirDecoraciones };
}
