"use client";

import { useCallback, useEffect, useState } from "react";
import type { ConfigModulo } from "@/lib/modulos-estudio/configuracion";

/**
 * El render con IA del módulo que se está viendo: primero pregunta al caché (`GET /api/modulos-render?meta=1`, gratis) y solo
 * cuando la persona lo pide genera (`POST`, de pago si no estaba guardado). El estado se deriva de la clave actual: lo que
 * llegó para otra combinación no se muestra, sin tener que reiniciarlo desde un efecto. La imagen guardada se muestra por su
 * URL versionada (inmutable): un render descartado y regenerado tiene otra URL.
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

type Consulta = { clave: string; puedeEscribir: boolean; estado: Extract<EstadoRender, { fase: "guardado" | "por_generar" | "sin_cache" }> };
type Generacion = { clave: string; estado: Extract<EstadoRender, { fase: "generando" | "lista" | "error" }> };

const ESPERA_CONSULTA_MS = 300;

type RespuestaMeta = { encontrada?: boolean; cache?: string; puedeEscribir?: boolean; imagen?: string };
type RespuestaGeneracion = { error?: string; imagen?: string; origen?: "cache" | "generada"; guardada?: boolean; avisos?: string[]; puedeEscribir?: boolean };

/** Los parámetros de la consulta salen de la clave canónica: dos arreglos equivalentes comparten consulta y URL de imagen. */
function parametrosDe(clave: string): URLSearchParams {
  const [, tipo, formato, colores] = clave.split(":");
  return new URLSearchParams({ tipo: tipo ?? "", formato: formato ?? "", colores: (colores ?? "").split("_").join(",") });
}

export function useRenderModulo(config: ConfigModulo, clave: string, capturar: () => string | null) {
  const [consulta, setConsulta] = useState<Consulta | null>(null);
  const [generacion, setGeneracion] = useState<Generacion | null>(null);
  const tipo = config.tipo, formatoId = config.formatoId, coloresTexto = config.colores.join(",");

  useEffect(() => {
    const control = new AbortController();
    const espera = setTimeout(() => {
      fetch(`/api/modulos-render?${parametrosDe(clave)}&meta=1`, { signal: control.signal })
        .then(async (respuesta) => {
          const datos = (await respuesta.json().catch(() => ({}))) as RespuestaMeta;
          const puedeEscribir = datos.puedeEscribir === true;
          if (datos.encontrada && datos.imagen) setConsulta({ clave, puedeEscribir, estado: { fase: "guardado", url: datos.imagen } });
          else setConsulta({ clave, puedeEscribir, estado: { fase: datos.cache === "disponible" ? "por_generar" : "sin_cache" } });
        })
        .catch((error: unknown) => {
          if (control.signal.aborted) return;
          console.error("[estudio-modulos] consulta", error);
          setConsulta({ clave, puedeEscribir: false, estado: { fase: "sin_cache" } });
        });
    }, ESPERA_CONSULTA_MS);
    return () => {
      clearTimeout(espera);
      control.abort();
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
        body: JSON.stringify({ tipo, formatoId, colores: coloresTexto.split(","), captura }),
      });
      const datos = (await respuesta.json().catch(() => ({}))) as RespuestaGeneracion;
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

  /** Descarta el render guardado (borra fila y objeto) y deja la combinación lista para generarse de nuevo. */
  const descartar = useCallback(async () => {
    try {
      const respuesta = await fetch(`/api/modulos-render?${parametrosDe(clave)}`, { method: "DELETE" });
      const datos = (await respuesta.json().catch(() => ({}))) as { error?: string };
      if (!respuesta.ok) {
        setGeneracion({ clave, estado: { fase: "error", mensaje: datos.error ?? "No pude descartar el render ahora." } });
        return;
      }
      setGeneracion(null);
      setConsulta({ clave, puedeEscribir: true, estado: { fase: "por_generar" } });
    } catch (error) {
      console.error("[estudio-modulos] descartar", error);
      setGeneracion({ clave, estado: { fase: "error", mensaje: "No hubo conexión con el servidor. Vuelve a intentarlo." } });
    }
  }, [clave]);

  const delaClave = consulta?.clave === clave ? consulta : null;
  const estado: EstadoRender = generacion?.clave === clave ? generacion.estado : delaClave?.estado ?? { fase: "consultando" };
  /** Lo que dijo el caché de esta combinación (para saber qué ofrecer tras un error). `puedeEscribir`: `null` mientras no se sabe. */
  return { estado, generar, descartar, base: delaClave?.estado ?? null, puedeEscribir: delaClave ? delaClave.puedeEscribir : null };
}
