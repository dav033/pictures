"use client";

import { useSyncExternalStore } from "react";

export type VistaApp = "clasica" | "guiada";
export const CLAVE_VISTA_APP = "demo-decoracion:vista-app";
const EVENTO_CAMBIO = "demo-decoracion:vista-app-cambio";
let vistaMemoria: VistaApp = "clasica";

function leer(): VistaApp {
  try {
    const guardada = window.localStorage.getItem(CLAVE_VISTA_APP);
    vistaMemoria = guardada === "guiada" ? "guiada" : "clasica";
  } catch {
    // La URL sigue indicando la vista cuando el navegador bloquea el almacenamiento.
  }
  return vistaMemoria;
}

export function guardarVistaApp(vista: VistaApp): void {
  vistaMemoria = vista;
  try {
    window.localStorage.setItem(CLAVE_VISTA_APP, vista);
  } catch {
    console.warn("[vista-app] localStorage no disponible; preferencia temporal en memoria.");
  }
  window.dispatchEvent(new Event(EVENTO_CAMBIO));
}

export function useVistaApp(): VistaApp {
  return useSyncExternalStore(
    (avisar) => {
      window.addEventListener(EVENTO_CAMBIO, avisar);
      const alCambiarOtraPestana = (event: StorageEvent) => {
        if (event.key !== CLAVE_VISTA_APP) return;
        vistaMemoria = event.newValue === "guiada" ? "guiada" : "clasica";
        avisar();
      };
      window.addEventListener("storage", alCambiarOtraPestana);
      return () => {
        window.removeEventListener(EVENTO_CAMBIO, avisar);
        window.removeEventListener("storage", alCambiarOtraPestana);
      };
    },
    leer,
    () => "clasica",
  );
}
