"use client";

import { useCallback, useEffect, useRef } from "react";
import { registrarEventoCliente } from "@/lib/registro/cliente";

/**
 * Registro de lo que hace quien arma su precio al cliente (agregar, quitar,
 * deshacer, sugerencias, − / +, ganancia), en la conversación activa: la guiada
 * o la clásica, la que esté abierta. Nunca lanza ni cambia lo que se ve.
 */
export function registrarCotizacion(evento: string, datos: Record<string, unknown>): void {
  try {
    registrarEventoCliente(`cotizacion.${evento}`, datos, "activa");
  } catch {
    // El registro nunca cambia la vista.
  }
}

/** Espera tras la última tecla antes de registrar una edición (una línea por edición, no por tecla). */
const ESPERA_REGISTRO_MS = 1200;

/** Registra una edición escrita cuando se deja de teclear; lo pendiente se envía igual si el bloque se desmonta. */
export function useRegistroEscrito(): (clave: string, evento: string, datos: Record<string, unknown>) => void {
  const pendientes = useRef(new Map<string, { temporizador: number; evento: string; datos: Record<string, unknown> }>());
  useEffect(() => {
    const mapa = pendientes.current;
    return () => {
      for (const { temporizador, evento, datos } of mapa.values()) {
        window.clearTimeout(temporizador);
        registrarCotizacion(evento, datos);
      }
      mapa.clear();
    };
  }, []);
  return useCallback((clave, evento, datos) => {
    const mapa = pendientes.current;
    const previa = mapa.get(clave);
    if (previa) window.clearTimeout(previa.temporizador);
    const temporizador = window.setTimeout(() => {
      mapa.delete(clave);
      registrarCotizacion(evento, datos);
    }, ESPERA_REGISTRO_MS);
    mapa.set(clave, { temporizador, evento, datos });
  }, []);
}
