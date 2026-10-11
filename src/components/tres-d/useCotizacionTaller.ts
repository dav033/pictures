"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MaterialDecoracion } from "@/lib/globos3d/figuras";
import { cabecerasConversacion } from "@/lib/registro/cliente";
import { CotizacionTallerSchema, FalloCotizacionTallerSchema, MAX_GLOBOS_LINEA_TALLER, MAX_GLOBOS_LISTA_TALLER, MAX_LINEAS_COTIZACION_TALLER, RUTA_COTIZACION_TALLER, type CotizacionTaller } from "@/lib/taller/cotizacion-taller-tipos";

export type EstadoCotizacionTaller =
  | { estado: "inactivo" }
  | { estado: "cotizando" }
  | { estado: "lista"; cotizacion: CotizacionTaller; vigente: boolean }
  | { estado: "error"; mensaje: string };

/** La lista que se cotiza: solo lo que la tienda vende por paquete (formato, código y cantidad), en un orden fijo. */
function pedidoDe(materiales: ReadonlyArray<MaterialDecoracion>) {
  return [...materiales].filter((m) => m.cantidad > 0).sort((a, b) => a.formatoId.localeCompare(b.formatoId) || a.codigo.localeCompare(b.codigo)).map((m) => ({ formatoId: m.formatoId, codigo: m.codigo, cantidad: m.cantidad }));
}

/**
 * El precio de la lista de compra del Taller (D-038), a pedido: se cotiza al pulsar el botón, nunca en cada cambio de la
 * escena (cada cotización llama al servicio de precios). Si la escena cambia después, la cotización queda marcada como
 * vieja hasta que se vuelva a pedir.
 */
export function useCotizacionTaller(materiales: ReadonlyArray<MaterialDecoracion>): { estado: EstadoCotizacionTaller; cotizar: () => void; demasiadas: boolean } {
  const pedido = useMemo(() => pedidoDe(materiales), [materiales]);
  const clave = useMemo(() => JSON.stringify(pedido), [pedido]);
  const [resultado, setResultado] = useState<{ clave: string; estado: Exclude<EstadoCotizacionTaller, { estado: "lista" }> | { estado: "lista"; cotizacion: CotizacionTaller } }>({ clave: "", estado: { estado: "inactivo" } });
  const control = useRef<AbortController | null>(null);
  useEffect(() => () => control.current?.abort(), []);

  const cotizar = useCallback(() => {
    control.current?.abort();
    const actual = new AbortController();
    control.current = actual;
    setResultado({ clave, estado: { estado: "cotizando" } });
    fetch(RUTA_COTIZACION_TALLER, { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json", ...cabecerasConversacion("3d") }, body: JSON.stringify({ materiales: pedido }), signal: actual.signal })
      .then(async (respuesta) => {
        const json: unknown = await respuesta.json().catch(() => null);
        const cotizacion = CotizacionTallerSchema.safeParse(json);
        if (respuesta.ok && cotizacion.success) return setResultado({ clave, estado: { estado: "lista", cotizacion: cotizacion.data } });
        const fallo = FalloCotizacionTallerSchema.safeParse(json);
        setResultado({ clave, estado: { estado: "error", mensaje: fallo.success ? fallo.data.error : "No pude cotizar la lista ahora." } });
      })
      .catch((causa: unknown) => {
        if (actual.signal.aborted) return;
        console.warn("[taller] no se pudo cotizar la lista de compra.", causa instanceof Error ? causa.message : causa);
        setResultado({ clave, estado: { estado: "error", mensaje: "No pude cotizar la lista: revisa la conexión." } });
      });
  }, [clave, pedido]);

  const estado: EstadoCotizacionTaller = resultado.estado.estado === "lista" ? { ...resultado.estado, vigente: resultado.clave === clave } : resultado.estado;
  const demasiadas = pedido.length > MAX_LINEAS_COTIZACION_TALLER || pedido.some((m) => m.cantidad > MAX_GLOBOS_LINEA_TALLER) || pedido.reduce((suma, m) => suma + m.cantidad, 0) > MAX_GLOBOS_LISTA_TALLER;
  return { estado, cotizar, demasiadas };
}
