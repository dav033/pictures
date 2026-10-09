"use client";

import { useCallback, useEffect, useState } from "react";
import type { ConfigModulo } from "@/lib/modulos-estudio/configuracion";

/**
 * El render con IA del módulo que se está viendo: primero pregunta al caché (`GET /api/modulos-render`, gratis) y solo
 * cuando la persona lo pide genera (`POST`, de pago si no estaba guardado). El estado se deriva de la clave actual: lo que
 * llegó para otra combinación no se muestra, sin tener que reiniciarlo desde un efecto.
 */
export type EstadoRender =
  | { fase: "consultando" }
  /** Ya existe en el caché: verlo no cuesta nada. */
  | { fase: "guardado"; url: string }
  /** No existe y el caché está disponible: generar paga una imagen y la deja guardada. */
  | { fase: "por_generar" }
  /** No existe y no hay dónde guardarla: generar paga una imagen que no se conserva. */
  | { fase: "sin_cache" }
  | { fase: "generando" }
  | { fase: "lista"; url: string; origen: "cache" | "generada"; guardada: boolean; avisos: string[] }
  | { fase: "error"; mensaje: string };

type Consulta = { clave: string; estado: Extract<EstadoRender, { fase: "guardado" | "por_generar" | "sin_cache" }> };
type Generacion = { clave: string; estado: Extract<EstadoRender, { fase: "generando" | "lista" | "error" }> };

const ESPERA_CONSULTA_MS = 300;

const cuerpoDe = (config: ConfigModulo) => ({ tipo: config.tipo, formatoId: config.formatoId, colores: [...config.colores] });

export function useRenderModulo(config: ConfigModulo, clave: string, capturar: () => string | null) {
  const [consulta, setConsulta] = useState<Consulta | null>(null);
  const [generacion, setGeneracion] = useState<Generacion | null>(null);
  const tipo = config.tipo, formatoId = config.formatoId, coloresTexto = config.colores.join(",");

  useEffect(() => {
    const control = new AbortController();
    let creada: string | null = null;
    const espera = setTimeout(() => {
      // La consulta sale de la clave canónica: dos arreglos equivalentes comparten consulta (y su imagen) sin revocarla.
      const [, tipoClave, formatoClave, coloresClave] = clave.split(":");
      const parametros = new URLSearchParams({ tipo: tipoClave ?? "", formato: formatoClave ?? "", colores: (coloresClave ?? "").split("_").join(",") });
      fetch(`/api/modulos-render?${parametros}`, { signal: control.signal })
        .then(async (respuesta) => {
          if (respuesta.ok) {
            creada = URL.createObjectURL(await respuesta.blob());
            setConsulta({ clave, estado: { fase: "guardado", url: creada } });
            return;
          }
          const datos = (await respuesta.json().catch(() => ({}))) as { cache?: string };
          setConsulta({ clave, estado: { fase: datos.cache === "disponible" ? "por_generar" : "sin_cache" } });
        })
        .catch((error: unknown) => {
          if (control.signal.aborted) return;
          console.error("[estudio-modulos] consulta", error);
          setConsulta({ clave, estado: { fase: "sin_cache" } });
        });
    }, ESPERA_CONSULTA_MS);
    return () => {
      clearTimeout(espera);
      control.abort();
      if (creada) URL.revokeObjectURL(creada);
    };
  }, [clave]);

  const generar = useCallback(async () => {
    const captura = capturar();
    if (!captura) {
      setGeneracion({ clave, estado: { fase: "error", mensaje: "No pude capturar el módulo en 3D. Recarga la página e inténtalo de nuevo." } });
      return;
    }
    setGeneracion({ clave, estado: { fase: "generando" } });
    try {
      const respuesta = await fetch("/api/modulos-render", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...cuerpoDe({ tipo, formatoId, colores: coloresTexto.split(",") }), captura }),
      });
      const datos = (await respuesta.json().catch(() => ({}))) as { error?: string; imagen?: string; origen?: "cache" | "generada"; guardada?: boolean; avisos?: string[] };
      if (!respuesta.ok || !datos.imagen) {
        setGeneracion({ clave, estado: { fase: "error", mensaje: datos.error ?? "No pude generar el render ahora. Vuelve a intentarlo en un momento." } });
        return;
      }
      setGeneracion({ clave, estado: { fase: "lista", url: datos.imagen, origen: datos.origen ?? "generada", guardada: datos.guardada ?? false, avisos: datos.avisos ?? [] } });
    } catch (error) {
      console.error("[estudio-modulos] generar", error);
      setGeneracion({ clave, estado: { fase: "error", mensaje: "No hubo conexión con el servidor. Vuelve a intentarlo." } });
    }
  }, [capturar, clave, tipo, formatoId, coloresTexto]);

  const estado: EstadoRender = generacion?.clave === clave ? generacion.estado : consulta?.clave === clave ? consulta.estado : { fase: "consultando" };
  /** Si el error vino con la consulta ya hecha, el botón vuelve a ofrecer generar. */
  return { estado, generar, base: consulta?.clave === clave ? consulta.estado : null };
}
