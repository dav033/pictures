"use client";

import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import type { ConfigModulo } from "@/lib/modulos-estudio/configuracion";
import { LADO_CAPTURA, VISTA_CAPTURA } from "@/lib/modulos-estudio/captura-estudio";
import { SALA_ESTUDIO, armarEstudio, cajaDeGlobo } from "@/lib/modulos-estudio/escena-estudio";
import { mostrarArmada } from "@/components/tres-d/armada-visor";
import type { EscenaGlobos } from "@/components/tres-d/escena-globos";

/**
 * El visor del estudio: el mismo motor three.js del Taller 3D con UN módulo, sin sala ni cuadrícula. El lienzo es
 * transparente: el fondo continuo lo pone la página (un degradado suave) y three.js solo dibuja los globos y su sombra
 * suave en el piso. Arrastrar gira, pellizcar acerca. `capturar` entrega el PNG que viaja a FLUX como guía: el módulo
 * desde el ángulo estándar de tres cuartos, sobre el gris liso de las capturas del taller, sin cuadrícula ni ayudas.
 */
export type VisorModuloHandle = { capturar: () => string | null };

export function VisorModulo({ config, globoElegido, ref }: { config: ConfigModulo; globoElegido: number | null; ref?: Ref<VisorModuloHandle> }) {
  const lienzoRef = useRef<HTMLCanvasElement>(null);
  const visorRef = useRef<EscenaGlobos | null>(null);
  const formaMostrada = useRef<string | null>(null);
  const [listo, setListo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const armada = useMemo(() => armarEstudio(config), [config]);
  const forma = `${config.tipo}|${config.formatoId}`;

  useImperativeHandle(ref, () => ({
    capturar: () => {
      try { return visorRef.current?.renderEstandar(VISTA_CAPTURA, LADO_CAPTURA) ?? null; } catch (causa) { console.error("[estudio-modulos] captura", causa); return null; }
    },
  }), []);

  useEffect(() => {
    let vivo = true;
    let observador: ResizeObserver | null = null;
    void import("@/components/tres-d/escena-globos").then(({ crearEscena }) => {
      if (!vivo || !lienzoRef.current) return;
      try {
        const visor = crearEscena(lienzoRef.current);
        visorRef.current = visor;
        observador = new ResizeObserver(() => visor.redimensionar());
        observador.observe(lienzoRef.current);
        setListo(true);
      } catch (causa) {
        console.error("[estudio-modulos] visor", causa);
        setError("Tu navegador no pudo abrir el visor 3D (WebGL). Prueba con Chrome o Edge actualizados.");
      }
    });
    return () => {
      vivo = false;
      observador?.disconnect();
      visorRef.current?.destruir();
      visorRef.current = null;
    };
  }, []);

  useEffect(() => {
    const visor = visorRef.current;
    if (!listo || !visor) return;
    // La cámara solo se reencuadra al cambiar el módulo o su tamaño: al cambiar un color se queda donde la dejó la persona.
    const reencuadrar = formaMostrada.current !== forma;
    formaMostrada.current = forma;
    mostrarArmada(visor, armada, SALA_ESTUDIO, { encuadrar: reencuadrar, resaltado: globoElegido === null ? null : cajaDeGlobo(armada, globoElegido) });
  }, [listo, armada, forma, globoElegido]);

  return (
    <>
      <canvas ref={lienzoRef} className="absolute inset-0 block size-full touch-none" aria-label="Módulo en 3D: arrastra para girar, pellizca o usa la rueda para acercar" />
      {!listo && !error && <p className="absolute inset-0 grid place-items-center text-sm text-[#6b6178]">Cargando la vista 3D…</p>}
      {error && <p role="alert" className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-[#b23a45]">{error}</p>}
    </>
  );
}
