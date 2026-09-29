"use client";

import { useCallback, useRef, useState } from "react";
import {
  filaVacia,
  totalesPlantilla,
  type CabeceraPlantilla,
  type ClaveSeccion,
  type FilaPlantilla,
  type PlantillaCotizacion,
  type TotalesPlantilla,
} from "@/lib/cotizacion/plantilla";

/** Lo editable de una fila: su id nunca cambia. */
export type CambioFila = Partial<Omit<FilaPlantilla, "id">>;

export type BorradorPlantillaCotizacion = {
  plantilla: PlantillaCotizacion;
  /** Derivado en cada render desde `plantilla`: nunca se guarda aparte. */
  totales: TotalesPlantilla;
  cambiarCabecera: (campo: keyof CabeceraPlantilla, valor: string) => void;
  anadirFila: (clave: ClaveSeccion) => void;
  cambiarFila: (clave: ClaveSeccion, id: string, cambio: CambioFila) => void;
  borrarFila: (clave: ClaveSeccion, id: string) => void;
  cambiarUtilidad: (porcentaje: number) => void;
  reiniciar: () => void;
};

/**
 * Borrador de la hoja de cotización, con el mismo patrón que
 * `useBorradorCotizacion`: vive en el cliente, no toca el servidor y se reinicia
 * ajustando estado durante el render (el patrón que React recomienda para
 * "resetear estado cuando cambia una prop") en vez de pasar por un efecto.
 *
 * `clave` es la identidad de lo que se está cotizando — el `plan_hash`. Mientras
 * no cambie, lo que la persona escribió sobrevive a cualquier re-render, a que
 * el diálogo se cierre y se vuelva a abrir y a que el plan se vuelva a dibujar.
 * Cuando cambia, la hoja se rearma porque ya cotiza otra decoración.
 *
 * `crear` se llama solo al montar y al cambiar la clave, así que quien lo pasa
 * no necesita memorizarlo.
 */
export function useBorradorPlantillaCotizacion(clave: string, crear: () => PlantillaCotizacion): BorradorPlantillaCotizacion {
  const [plantilla, setPlantilla] = useState<PlantillaCotizacion>(crear);
  const [claveAnterior, setClaveAnterior] = useState(clave);
  if (clave !== claveAnterior) {
    setClaveAnterior(clave);
    setPlantilla(crear());
  }

  // Consecutivo para los ids de las filas nuevas: dos filas añadidas y borradas
  // en cualquier orden nunca comparten id, que es lo que necesita React.
  const consecutivo = useRef(0);

  const cambiarCabecera = useCallback((campo: keyof CabeceraPlantilla, valor: string) => {
    setPlantilla((previa) => ({ ...previa, cabecera: { ...previa.cabecera, [campo]: valor } }));
  }, []);

  const anadirFila = useCallback((clave: ClaveSeccion) => {
    consecutivo.current += 1;
    const nueva = filaVacia(clave, consecutivo.current);
    setPlantilla((previa) => ({ ...previa, secciones: { ...previa.secciones, [clave]: [...previa.secciones[clave], nueva] } }));
  }, []);

  const cambiarFila = useCallback((clave: ClaveSeccion, id: string, cambio: CambioFila) => {
    setPlantilla((previa) => ({
      ...previa,
      secciones: {
        ...previa.secciones,
        // Los importes y las cantidades se guardan ya saneados para que lo que
        // se ve en el campo sea exactamente lo que suma el total.
        [clave]: previa.secciones[clave].map((fila) =>
          fila.id === id
            ? {
                ...fila,
                ...cambio,
                ...(cambio.costoUnitario === undefined ? {} : { costoUnitario: sinNegativos(cambio.costoUnitario) }),
                ...(cambio.cantidad === undefined ? {} : { cantidad: sinNegativos(cambio.cantidad) }),
              }
            : fila,
        ),
      },
    }));
  }, []);

  const borrarFila = useCallback((clave: ClaveSeccion, id: string) => {
    setPlantilla((previa) => ({ ...previa, secciones: { ...previa.secciones, [clave]: previa.secciones[clave].filter((fila) => fila.id !== id) } }));
  }, []);

  const cambiarUtilidad = useCallback((porcentaje: number) => {
    setPlantilla((previa) => ({ ...previa, utilidadPorcentaje: sinNegativos(porcentaje) }));
  }, []);

  // Sin memorizar a propósito: `crear` cambia de identidad en cada render de
  // quien monta el hook, y memorizarlo aquí solo serviría para reiniciar la hoja
  // con una versión vieja. Va a un `onClick`, así que no hay nada que optimizar.
  const reiniciar = (): void => setPlantilla(crear());

  return { plantilla, totales: totalesPlantilla(plantilla), cambiarCabecera, anadirFila, cambiarFila, borrarFila, cambiarUtilidad, reiniciar };
}

/** Un campo numérico vacío o con basura vale 0, nunca un negativo. */
function sinNegativos(valor: number): number {
  return Number.isFinite(valor) && valor > 0 ? valor : 0;
}
