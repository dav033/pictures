"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { Caja, Colocacion } from "@/lib/globos3d/escena";
import { medidasDePieza, textoMetros } from "@/lib/globos3d/medidas-caja";
import type { EscenaGlobos } from "./escena-globos";

/**
 * Alto (a la derecha de la caja) y ancho (al frente, sobre el piso) de la pieza elegida, en metros. Lo enciende la barra
 * del visor (`activo`); sin pieza elegida no muestra nada. La caja es la de la copia elegida, si la hay; con la caja de la pieza
 * en su propio marco (`cajaLocal`) el ancho no cambia al girarla (ver `medidasDePieza`).
 */
export function EtiquetasMedidas({ visor, activo, caja, cajaLocal, colocacion, contenedor }: { visor: EscenaGlobos | null; activo: boolean; caja: Caja; cajaLocal: Caja | undefined; colocacion: Colocacion; contenedor: RefObject<HTMLElement | null> }) {
  const alto = useRef<HTMLSpanElement>(null);
  const ancho = useRef<HTMLSpanElement>(null);
  const medidas = medidasDePieza(cajaLocal, caja, colocacion);
  useEffect(() => {
    if (!visor || !activo) return;
    const poner = () => {
      const cont = contenedor.current;
      if (!cont) return;
      const r = cont.getBoundingClientRect();
      const mitadX = (caja.min.x + caja.max.x) / 2, mitadY = (caja.min.y + caja.max.y) / 2;
      const colocar = (el: HTMLSpanElement | null, punto: { x: number; y: number; z: number }) => {
        if (!el) return;
        const p = visor.aPantalla(punto);
        if (!p) { el.style.visibility = "hidden"; return; }
        el.style.transform = `translate(${Math.round(p.x - r.left)}px, ${Math.round(p.y - r.top)}px)`;
        el.style.visibility = "visible";
      };
      colocar(alto.current, { x: caja.max.x + 25, y: mitadY, z: caja.max.z });
      colocar(ancho.current, { x: mitadX, y: caja.min.y, z: caja.max.z + 25 });
    };
    poner();
    return visor.alDibujar(poner);
  }, [visor, activo, caja, contenedor]);
  if (!activo) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-[5] overflow-hidden font-mono text-[11px] leading-none text-taller-texto">
      <span ref={alto} style={{ visibility: "hidden" }} className="absolute left-0 top-0 whitespace-nowrap rounded bg-taller-encima/80 px-1 py-0.5">
        <span className="sr-only">Alto de la pieza: </span>{textoMetros(medidas.altoM)}
      </span>
      <span ref={ancho} style={{ visibility: "hidden" }} className="absolute left-0 top-0 whitespace-nowrap rounded bg-taller-encima/80 px-1 py-0.5">
        <span className="sr-only">Ancho de la pieza: </span>{textoMetros(medidas.anchoM)}
      </span>
    </div>
  );
}
