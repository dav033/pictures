"use client";

import { useEffect, useState } from "react";
import { interpretarRespuestaRepositorios, RUTA_REPOSITORIOS, type RespuestaRepositorios } from "@/lib/catalogo/repositorios-api-tipos";

/**
 * Los repositorios del catálogo y si la interfaz por repositorio está encendida (`GET /api/catalogo/repositorios`, REQ-013). Se
 * lee al montar, una sola vez aunque se monten varios (el panel «Añadir», la lista de compra, la ficha) y se recuerda `VIGENCIA_MS`:
 * lo mismo que la fila de `ajustes_runtime` cachea en el servidor, así abrir una ficha no pide la ruta otra vez ni empieza sin saberlo.
 * Mientras no llega, o si la lectura falla (red, 401, respuesta que no es `{ repositorios, ui }`), vale `null` —con un aviso en la consola—: los
 * llamadores muestran lo de siempre, que es también la marcha atrás de la bandera. Un repositorio suelto que no se entiende se descarta
 * (también con aviso) y el resto sigue.
 */
const VIGENCIA_MS = 30_000;

let ultima: { respuesta: RespuestaRepositorios; leidaEn: number } | null = null;
let enCurso: Promise<RespuestaRepositorios | null> | null = null;

function leer(): Promise<RespuestaRepositorios | null> {
  enCurso ??= fetch(RUTA_REPOSITORIOS, { cache: "no-store" })
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then((json: unknown) => {
      const lectura = interpretarRespuestaRepositorios(json);
      if (!lectura.ok) {
        console.warn(`[taller] la lista de repositorios del catálogo no se entiende (${lectura.error}); el panel queda como siempre.`);
        return null;
      }
      if (lectura.descartados.length > 0) console.warn(`[taller] se descartan repositorios del catálogo que este navegador no entiende: ${lectura.descartados.join(" | ")}`);
      ultima = { respuesta: lectura.respuesta, leidaEn: Date.now() };
      return lectura.respuesta;
    })
    .catch((causa: unknown) => {
      console.warn("[taller] no se pudieron leer los repositorios del catálogo; el panel queda como siempre.", causa instanceof Error ? causa.message : causa);
      return null;
    })
    .finally(() => { enCurso = null; });
  return enCurso;
}

export function useRepositoriosCatalogo(): RespuestaRepositorios | null {
  const [respuesta, setRespuesta] = useState<RespuestaRepositorios | null>(() => ultima?.respuesta ?? null);
  useEffect(() => {
    if (ultima && Date.now() - ultima.leidaEn < VIGENCIA_MS) return;
    let vivo = true;
    void leer().then((leida) => { if (vivo && leida) setRespuesta(leida); });
    return () => { vivo = false; };
  }, []);
  return respuesta;
}
