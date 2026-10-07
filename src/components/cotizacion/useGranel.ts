"use client";

import { useEffect, useMemo, useState } from "react";
import type { Cotizacion } from "@/lib/cotizacion/motor";
import { leerBorrador, type BorradorProfesional, type EntradaLeida } from "@/lib/cotizacion/borrador-profesional";
import {
  anunciaGranel,
  entradaConGranel,
  granelConContenido,
  granelDesdeTexto,
  granelVacio,
  leerGranel,
  preciosLegibles,
  unidadesDesdeCotizacion,
  type BorradorGranel,
  type GranelLeido,
  type UnidadesMaterial,
} from "@/lib/cotizacion/granel";
import type { CotizacionProfesionalResultado, EntradaCotizacionProfesional, LineaMaterialProfesional, ModoMateriales } from "@/lib/cotizacion/profesional";
import { registrarEventoCliente } from "@/lib/registro/cliente";

const PREFIJO_GUARDADO = "cotizacion-granel:";

function leerGuardado(clave: string): BorradorGranel | null {
  try {
    return granelDesdeTexto(window.sessionStorage.getItem(PREFIJO_GUARDADO + clave));
  } catch {
    return null;
  }
}

function guardar(clave: string, borrador: BorradorGranel): void {
  try {
    if (granelConContenido(borrador)) window.sessionStorage.setItem(PREFIJO_GUARDADO + clave, JSON.stringify(borrador));
    else window.sessionStorage.removeItem(PREFIJO_GUARDADO + clave);
  } catch {
    // Sin almacenamiento: el borrador vive mientras la página siga abierta.
  }
}

export type EnvioCotizacion = { entrada: EntradaCotizacionProfesional; enviadas: EntradaLeida["enviadas"] };

export type Granel = {
  /** El Python que respondió sabe cotizar a granel y la cotización trae las unidades de cada material. */
  disponible: boolean;
  /** El modo que se cotiza: a granel solo si está disponible. */
  modo: ModoMateriales;
  unidades: Readonly<Record<string, UnidadesMaterial>> | null;
  borrador: BorradorGranel;
  leido: GranelLeido | null;
  /** Lo que se envía a Python, o `null` mientras algo escrito no se puede leer. */
  envio: EnvioCotizacion | null;
  cambiarModo: (modo: ModoMateriales) => void;
  cambiarPrecio: (variantId: string, texto: string | null) => void;
  cambiarExtra: (variantId: string, texto: string) => void;
};

/**
 * El modo a granel de la cotización profesional: su borrador (guardado en la
 * sesión, aparte del de paquetes), si se puede ofrecer y qué entrada se envía.
 * A un Python que no anunció `modos_materiales` se le envía exactamente la
 * entrada de siempre: así un Python anterior (que prohíbe campos de más) sigue
 * respondiendo y el conmutador no aparece.
 */
export function useGranel({ clave, cotizacion, materiales, borrador, leido, datos }: {
  clave: string;
  cotizacion: Pick<Cotizacion, "lineas">;
  materiales: readonly LineaMaterialProfesional[];
  borrador: BorradorProfesional;
  leido: EntradaLeida;
  /** El último resultado de Python que se ve (o `null`). */
  datos: Pick<CotizacionProfesionalResultado, "modos_materiales"> | null;
}): Granel {
  const [granel, setGranel] = useState<BorradorGranel>(() => leerGuardado(clave) ?? granelVacio());
  const unidades = useMemo(() => unidadesDesdeCotizacion(cotizacion, materiales), [cotizacion, materiales]);
  const leidoGranel = useMemo(() => (unidades ? leerGranel(granel, unidades, materiales) : null), [granel, unidades, materiales]);
  const disponible = unidades !== null && anunciaGranel(datos);
  const modo: ModoMateriales = disponible ? granel.modo : "paquete";

  const envio = useMemo((): EnvioCotizacion | null => {
    if (!disponible || !leidoGranel) return leido.entrada ? { entrada: leido.entrada, enviadas: leido.enviadas } : null;
    if (modo === "paquete") {
      if (!leido.entrada) return null;
      const entrada = entradaConGranel(leido.entrada, leidoGranel, "paquete");
      return entrada ? { entrada, enviadas: leido.enviadas } : null;
    }
    // A granel los precios por paquete ni se ven: uno a medio escribir no frena el cálculo.
    const base = leerBorrador(preciosLegibles(borrador, materiales), materiales);
    const entrada = base.entrada ? entradaConGranel(base.entrada, leidoGranel, "granel") : null;
    return entrada ? { entrada, enviadas: base.enviadas } : null;
  }, [disponible, leidoGranel, leido, modo, borrador, materiales]);

  useEffect(() => {
    guardar(clave, granel);
  }, [clave, granel]);

  return {
    disponible,
    modo,
    unidades,
    borrador: granel,
    leido: leidoGranel,
    envio,
    cambiarModo(nuevo) {
      setGranel((previo) => ({ ...previo, modo: nuevo }));
      registrarEventoCliente("cotizacion.granel.modo", { clave, modo: nuevo, materiales: materiales.length }, "activa");
    },
    cambiarPrecio(variantId, texto) {
      setGranel((previo) => {
        const preciosUnidad = { ...previo.preciosUnidad };
        if (texto === null) delete preciosUnidad[variantId];
        else preciosUnidad[variantId] = texto;
        return { ...previo, preciosUnidad };
      });
    },
    cambiarExtra(variantId, texto) {
      setGranel((previo) => {
        const extras = { ...previo.extras };
        if (!texto.trim()) delete extras[variantId];
        else extras[variantId] = texto;
        return { ...previo, extras };
      });
    },
  };
}
