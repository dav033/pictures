"use client";

import { useEffect, useRef } from "react";
import { vistaRenderDe, vistaPorForma, esVistaRender, type VistaRender } from "@/lib/taller/vista-render";
import { crearResolverItems, salaNeutra } from "./captura-items";
import { mostrarArmada } from "./armada-visor";
import type { EscenaGlobos } from "./escena-globos";
import type { Escena, EscenaArmada } from "@/lib/globos3d/escena";
import type { Encuadre } from "@/lib/globos3d/encuadre-foto";
import { capturarEscenaParaRefinar } from "./captura-refinar";

/**
 * **Captura de renders estándar** (REQ-002, paso 3): dado `?item=<id>` (y `&vista=frente|tres-cuartos`), arma el item con el
 * mismo código del taller, lo dibuja una vez con la cámara fija de su tipo y deja el PNG en `window.__captura`. Sin
 * interfaz y sin tocar la escena guardada del taller (no lee ni escribe localStorage). `window.__capturarFoto(escena, encuadre)` da la escena vista desde la cámara de una foto (refinado, REQ-001 paso 9). `window.__capturarItem(id, vista?)`
 * repite el proceso en la misma página, sin recargar three.js: es lo que usa `scripts/taller/capturar-renders.ts`.
 */

export type EstadoCaptura = { listo: boolean; dataUrl: string | null; error: string | null; id: string | null; vista: VistaRender | null; ms: number; fases?: { armar: number; visor: number; dibujar: number; render: number } };

declare global {
  interface Window {
    __captura?: EstadoCaptura;
    __capturarItem?: (id: string, vista?: string | null) => Promise<EstadoCaptura>;
    /** La escena desde la cámara de una foto (JPEG en base64): lo que ve el refinado de «Comparando con la foto». */
    __capturarFoto?: (escena: Escena, encuadre: Encuadre) => Promise<{ mime: string; base64: string }>;
  }
}

const LADO = 512;
/** Cada cuántos renders se rehace el visor: los materiales y geometrías en caché no se liberan solos. */
const RENDERS_POR_VISOR = 40;
/** Lo que ocupa todo lo armado (cm), sumando las cajas de cada pieza. */
function cajaDe(armada: EscenaArmada) {
  const cajas = armada.porNodo.filter((n) => n.copias > 0).map((n) => n.caja).filter((c) => Number.isFinite(c.min.x) && Number.isFinite(c.max.x));
  const eje = (f: (c: (typeof cajas)[number]) => number, mejor: (...v: number[]) => number) => (cajas.length ? mejor(...cajas.map(f)) : 0);
  return {
    min: { x: eje((c) => c.min.x, Math.min), y: eje((c) => c.min.y, Math.min), z: eje((c) => c.min.z, Math.min) },
    max: { x: eje((c) => c.max.x, Math.max), y: eje((c) => c.max.y, Math.max), z: eje((c) => c.max.z, Math.max) },
  };
}
const esperarCuadro = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const mensaje = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function CapturaRender({ item, vista }: { item: string | null; vista: string | null }) {
  const lienzoRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const lienzo = lienzoRef.current;
    if (!lienzo) return;
    let vivo = true;
    let visor: EscenaGlobos | null = null;
    let rendersDelVisor = 0;
    const resolver = crearResolverItems();

    const obtenerVisor = async (): Promise<EscenaGlobos> => {
      if (visor && rendersDelVisor >= RENDERS_POR_VISOR) { visor.destruir(); visor = null; }
      if (!visor) {
        const { crearEscena } = await import("./escena-globos");
        visor = crearEscena(lienzo);
        rendersDelVisor = 0;
      }
      return visor;
    };

    const capturarItem = async (id: string, vistaPedida?: string | null): Promise<EstadoCaptura> => {
      const t0 = performance.now();
      const ms = () => Math.round(performance.now() - t0);
      const fallo = (error: string, vistaUsada: VistaRender | null = null): EstadoCaptura => ({ listo: true, dataUrl: null, error, id, vista: vistaUsada, ms: ms() });
      /** Solo publica quien sigue montado (en desarrollo React monta dos veces la página). */
      const publicar = (estado: EstadoCaptura): EstadoCaptura => { if (vivo) window.__captura = estado; return estado; };
      publicar({ listo: false, dataUrl: null, error: null, id, vista: null, ms: 0 });
      try {
        const encontrado = resolver.item(id);
        if (!encontrado) return publicar(fallo(`Item desconocido: ${id}`));
        const t1 = performance.now();
        const armada = resolver.armar(encontrado);
        const vistaUsada = esVistaRender(vistaPedida) ? vistaPedida : vistaPorForma(vistaRenderDe(encontrado), cajaDe(armada));
        const t2 = performance.now();
        const v = await obtenerVisor();
        if (!vivo) { v.destruir(); visor = null; throw new Error("Página desmontada"); }
        mostrarArmada(v, armada, salaNeutra(armada.sala));
        const t3 = performance.now();
        await esperarCuadro();
        await esperarCuadro();
        const t4 = performance.now();
        const dataUrl = v.renderEstandar(vistaUsada, LADO);
        rendersDelVisor++;
        const fases = { armar: Math.round(t2 - t1), visor: Math.round(t3 - t2), dibujar: Math.round(t4 - t3), render: Math.round(performance.now() - t4) };
        return publicar({ listo: true, dataUrl, error: null, id, vista: vistaUsada, ms: ms(), fases });
      } catch (causa) {
        // Un visor que falló a medias no se reutiliza.
        visor?.destruir();
        visor = null;
        return publicar(fallo(mensaje(causa)));
      }
    };

    window.__capturarItem = capturarItem;
    window.__capturarFoto = (escena, encuadre) => capturarEscenaParaRefinar(escena, encuadre);
    window.__captura = { listo: false, dataUrl: null, error: null, id: item, vista: null, ms: 0 };
    if (item) void capturarItem(item, vista);
    return () => {
      vivo = false;
      visor?.destruir();
      visor = null;
      delete window.__capturarItem;
      delete window.__capturarFoto;
    };
  }, [item, vista]);

  return <canvas ref={lienzoRef} width={LADO} height={LADO} aria-hidden style={{ position: "fixed", inset: 0, width: LADO, height: LADO }} />;
}
