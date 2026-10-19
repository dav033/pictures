"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * Modo de la pantalla principal (B1, docs/mejoras/PLAN-ESTRUCTURAS-Y-UX.md).
 *
 * "usuario" es lo que ve el cliente final; "dev" suma controles y datos
 * técnicos. Es una preferencia de presentación del navegador, NO un permiso:
 * no autoriza nada en el servidor ni cambia qué datos responde una ruta.
 */
export type ModoVista = "usuario" | "dev";

export const CLAVE_MODO_VISTA = "demo-decoracion:modo-vista";
const EVENTO_CAMBIO = "demo-decoracion:modo-vista-cambio";

/** Valor guardado → modo. Cualquier cosa distinta de "dev" es modo usuario (el default). */
export function interpretarModoVista(valor: string | null | undefined): ModoVista {
  return valor === "dev" ? "dev" : "usuario";
}

/** `?dev=1` activa el modo dev y `?dev=0` vuelve a usuario; sin el parámetro no cambia nada. */
export function modoVistaDesdeQuery(search: string): ModoVista | null {
  const valor = new URLSearchParams(search).get("dev");
  if (valor === "1") return "dev";
  if (valor === "0") return "usuario";
  return null;
}

// Respaldo en memoria cuando localStorage no está disponible (modo privado,
// política del navegador): la preferencia dura mientras la pestaña siga abierta.
let modoEnMemoria: ModoVista | null = null;

function leerModoVista(): ModoVista {
  if (modoEnMemoria) return modoEnMemoria;
  try {
    return interpretarModoVista(window.localStorage.getItem(CLAVE_MODO_VISTA));
  } catch {
    return "usuario";
  }
}

export function guardarModoVista(modo: ModoVista): void {
  modoEnMemoria = modo;
  try {
    window.localStorage.setItem(CLAVE_MODO_VISTA, modo);
  } catch {
    // Sin almacenamiento persistente: queda el respaldo en memoria de esta pestaña.
  }
  window.dispatchEvent(new Event(EVENTO_CAMBIO));
}

function suscribir(avisar: () => void): () => void {
  const alCambiarOtraPestana = (event: StorageEvent) => {
    if (event.key !== CLAVE_MODO_VISTA) return;
    modoEnMemoria = null;
    avisar();
  };
  window.addEventListener(EVENTO_CAMBIO, avisar);
  window.addEventListener("storage", alCambiarOtraPestana);
  return () => {
    window.removeEventListener(EVENTO_CAMBIO, avisar);
    window.removeEventListener("storage", alCambiarOtraPestana);
  };
}

export function useModoVista(): { modo: ModoVista; cambiar: (modo: ModoVista) => void } {
  // El servidor siempre renderiza modo usuario; el navegador aplica la
  // preferencia guardada al hidratar, sin setState dentro de efectos.
  const modo = useSyncExternalStore(suscribir, leerModoVista, () => "usuario" as const);
  useEffect(() => {
    const desdeQuery = modoVistaDesdeQuery(window.location.search);
    if (desdeQuery) guardarModoVista(desdeQuery);
  }, []);
  return { modo, cambiar: guardarModoVista };
}
