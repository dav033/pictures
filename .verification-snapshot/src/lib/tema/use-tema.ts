"use client";

import { useSyncExternalStore } from "react";
import {
  CLAVE_TEMA,
  EVENTO_CAMBIO_TEMA,
  interpretarPreferenciaTema,
  resolverTema,
  type PreferenciaTema,
  type TemaElegido,
} from "./tema";

const CONSULTA_OSCURO = "(prefers-color-scheme: dark)";

// In-memory fallback when localStorage is unavailable: the choice lasts while the tab is open.
let preferenciaEnMemoria: PreferenciaTema | null = null;

function leerPreferencia(): PreferenciaTema {
  if (preferenciaEnMemoria) return preferenciaEnMemoria;
  try {
    return interpretarPreferenciaTema(window.localStorage.getItem(CLAVE_TEMA));
  } catch {
    return "sistema";
  }
}

function leerTemaPintado(): TemaElegido {
  return resolverTema(leerPreferencia(), window.matchMedia(CONSULTA_OSCURO).matches);
}

/** Writes the choice to storage and to `<html data-theme>`; "sistema" removes the attribute. */
export function guardarPreferenciaTema(preferencia: PreferenciaTema): void {
  preferenciaEnMemoria = preferencia;
  try {
    if (preferencia === "sistema") window.localStorage.removeItem(CLAVE_TEMA);
    else window.localStorage.setItem(CLAVE_TEMA, preferencia);
  } catch {
    // No persistent storage: the in-memory fallback keeps this tab consistent.
  }
  if (preferencia === "sistema") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", preferencia);
  window.dispatchEvent(new Event(EVENTO_CAMBIO_TEMA));
}

function suscribir(avisar: () => void): () => void {
  const media = window.matchMedia(CONSULTA_OSCURO);
  const alCambiarOtraPestana = (event: StorageEvent) => {
    if (event.key !== CLAVE_TEMA) return;
    preferenciaEnMemoria = null;
    const preferencia = interpretarPreferenciaTema(event.newValue);
    if (preferencia === "sistema") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", preferencia);
    avisar();
  };
  window.addEventListener(EVENTO_CAMBIO_TEMA, avisar);
  window.addEventListener("storage", alCambiarOtraPestana);
  media.addEventListener("change", avisar);
  return () => {
    window.removeEventListener(EVENTO_CAMBIO_TEMA, avisar);
    window.removeEventListener("storage", alCambiarOtraPestana);
    media.removeEventListener("change", avisar);
  };
}

/**
 * Painted theme (for the sun/moon icon), the stored preference (for the
 * Claro / Oscuro / Sistema menu) and a setter. Server snapshots: light and
 * "sistema".
 */
export function useTema(): { tema: TemaElegido; preferencia: PreferenciaTema; cambiar: (preferencia: PreferenciaTema) => void } {
  const tema = useSyncExternalStore(suscribir, leerTemaPintado, () => "light" as const);
  const preferencia = useSyncExternalStore(suscribir, leerPreferencia, () => "sistema" as const);
  return { tema, preferencia, cambiar: guardarPreferenciaTema };
}
