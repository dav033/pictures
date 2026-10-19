"use client";

import { useEffect, useState } from "react";

/** El navegador puede grabar audio (micrófono y MediaRecorder; en HTTP que no es localhost no hay micrófono). */
export function navegadorPuedeGrabar(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function" && typeof MediaRecorder !== "undefined";
}

let consulta: Promise<boolean> | null = null;

/** Pregunta una sola vez por carga de página si el servidor tiene el dictado encendido (`VOZ_ENABLED`). */
function servidorHabilitado(): Promise<boolean> {
  consulta ??= fetch("/api/voz/transcribir")
    .then(async (r) => (r.ok ? ((await r.json()) as { habilitada?: unknown }).habilitada === true : false))
    .catch(() => {
      consulta = null;
      return false;
    });
  return consulta;
}

/** `true` solo si el servidor lo habilitó Y este navegador puede grabar: si no, el botón de dictar ni aparece. */
export function useVozDisponible(): boolean {
  const [disponible, setDisponible] = useState(false);
  useEffect(() => {
    if (!navegadorPuedeGrabar()) return;
    let vivo = true;
    void servidorHabilitado().then((habilitada) => { if (vivo) setDisponible(habilitada); });
    return () => { vivo = false; };
  }, []);
  return disponible;
}
