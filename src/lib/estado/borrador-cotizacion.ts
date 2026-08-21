"use client";

import { useCallback, useState } from "react";
import type { Cotizacion, LineaCotizada } from "@/lib/cotizacion/motor";
import type { Producto } from "@/lib/types";

/** Línea de cotización + su estado de edición local — nunca toca el servidor. */
export type LineaBorrador = LineaCotizada & { excluida: boolean };

function lineasIniciales(cotizacion: Cotizacion): LineaBorrador[] {
  return cotizacion.lineas.map((linea) => ({ ...linea, excluida: false }));
}

/**
 * Borrador de edición de una cotización ya mostrada en el chat (§ plan
 * "Cotización editable"): el cliente puede quitar líneas, ajustar paquetes o
 * reemplazar un producto sin que nada de eso toque la selección compartida
 * ([useSeleccion]) ni dispare una regeneración — solo pasa al confirmar con
 * "Listo" en `TarjetaCotizacion`, que le entrega las líneas resultantes a
 * `aplicarCotizacionEditada` en page.tsx.
 *
 * Cada `TarjetaCotizacion` monta su propia instancia de este hook: el
 * borrador es por tarjeta, no un estado global.
 */
export function useBorradorCotizacion(cotizacion: Cotizacion) {
  const [lineas, setLineas] = useState<LineaBorrador[]>(() => lineasIniciales(cotizacion));
  // Ajuste de estado durante el render (patrón recomendado por React para
  // "resetear estado cuando cambia una prop", sin pasar por un efecto): un
  // mismo mensaje puede pasar de la cotización preliminar (tool `cotizar`) a
  // la final (llega junto con la imagen generada) sin desmontar la tarjeta —
  // ver page.tsx `finalizarUltimoMensaje` / `generar()`. Si eso pasa,
  // cualquier edición en curso ya no aplica a las piezas viejas, así que el
  // borrador se reinicia con la cotización nueva.
  const [cotizacionPrevia, setCotizacionPrevia] = useState(cotizacion);
  if (cotizacion !== cotizacionPrevia) {
    setCotizacionPrevia(cotizacion);
    setLineas(lineasIniciales(cotizacion));
  }

  const cambiarPaquetes = useCallback((id: string, paquetes: number) => {
    setLineas((previas) =>
      previas.map((linea) => {
        if (linea.id !== id || linea.sinReferencia) return linea;
        const nuevosPaquetes = Math.max(1, Math.round(paquetes));
        return {
          ...linea,
          paquetes: nuevosPaquetes,
          subtotal: nuevosPaquetes * (linea.precioPaquete ?? 0),
          // Puede quedar negativo si el cliente baja la cantidad por debajo
          // de lo necesario: se muestra igual, nunca se oculta (§3.5 del
          // plan de cotización) — la UI lo lee como "faltan N".
          sobrante: nuevosPaquetes * (linea.unidadesPaquete ?? 0) - linea.cantidadNecesaria,
        };
      }),
    );
  }, []);

  const quitar = useCallback((id: string) => {
    setLineas((previas) => previas.map((linea) => (linea.id === id ? { ...linea, excluida: true } : linea)));
  }, []);

  const restaurar = useCallback((id: string) => {
    setLineas((previas) => previas.map((linea) => (linea.id === id ? { ...linea, excluida: false } : linea)));
  }, []);

  /** Sustituye la variante de una línea conservando cuánto necesita el cliente. */
  const reemplazar = useCallback((id: string, producto: Producto) => {
    setLineas((previas) =>
      previas.map((linea) => {
        if (linea.id !== id) return linea;
        const unidadesPaquete = Math.max(1, producto.unidadesPaquete ?? 1);
        const paquetes = Math.max(1, Math.ceil(linea.cantidadNecesaria / unidadesPaquete));
        return {
          ...linea,
          id: producto.id,
          varianteId: producto.id,
          nombre: producto.nombre,
          categoria: producto.categoria,
          colores: producto.colores,
          foto: producto.foto,
          descripcion: producto.descripcion,
          precioPaquete: producto.precio,
          unidadesPaquete,
          paquetes,
          subtotal: paquetes * producto.precio,
          sobrante: paquetes * unidadesPaquete - linea.cantidadNecesaria,
          disponible: true,
          sinReferencia: false,
          excluida: false,
        };
      }),
    );
  }, []);

  const descartar = useCallback(() => {
    setLineas(lineasIniciales(cotizacion));
  }, [cotizacion]);

  const incluidas = lineas.filter((linea) => !linea.excluida);
  const total = incluidas.reduce((suma, linea) => suma + (linea.subtotal ?? 0), 0);
  const hayCambios = lineas.some((linea, indice) => {
    const original = cotizacion.lineas[indice];
    return linea.excluida || linea.id !== original?.id || linea.paquetes !== original?.paquetes;
  });

  return { lineas, incluidas, total, hayCambios, cambiarPaquetes, quitar, restaurar, reemplazar, descartar };
}
