"use client";

import { useEffect } from "react";
import { conversacionActiva, registrarEventoCliente } from "@/lib/registro/cliente";

/** Avisos del navegador que no son fallos de la app y solo gastarían el cupo por minuto. */
const IGNORADOS = [/ResizeObserver loop/i, /^Script error\.?$/i];

function ignorado(mensaje: string): boolean {
  return IGNORADOS.some((patron) => patron.test(mensaje));
}

function detalleRazon(razon: unknown): Record<string, unknown> {
  if (razon instanceof Error) return { nombre: razon.name, mensaje: razon.message, pila: razon.stack };
  if (typeof razon === "string") return { mensaje: razon };
  try {
    return { mensaje: JSON.stringify(razon) };
  } catch {
    return { mensaje: String(razon) };
  }
}

/**
 * Montado una vez en el layout raíz: manda a /api/registro-cliente los errores de `window.onerror` y los
 * rechazos de promesas sin manejar, atribuidos a la conversación activa de la pestaña si la hay. No pinta nada.
 */
export function CapturaErroresCliente(): null {
  useEffect(() => {
    const alError = (evento: ErrorEvent): void => {
      const mensaje = evento.message || (evento.error instanceof Error ? evento.error.message : "");
      if (ignorado(mensaje)) return;
      registrarEventoCliente(
        "error_navegador",
        {
          mensaje,
          archivo: evento.filename,
          linea: evento.lineno,
          columna: evento.colno,
          ...(evento.error instanceof Error ? { nombre: evento.error.name, pila: evento.error.stack } : {}),
        },
        conversacionActiva(),
        { nivel: "error", tipo: "error" },
      );
    };
    const alRechazo = (evento: PromiseRejectionEvent): void => {
      const detalle = detalleRazon(evento.reason);
      if (typeof detalle.mensaje === "string" && ignorado(detalle.mensaje)) return;
      registrarEventoCliente("promesa_rechazada", detalle, conversacionActiva(), { nivel: "error", tipo: "error" });
    };
    window.addEventListener("error", alError);
    window.addEventListener("unhandledrejection", alRechazo);
    return () => {
      window.removeEventListener("error", alError);
      window.removeEventListener("unhandledrejection", alRechazo);
    };
  }, []);
  return null;
}
