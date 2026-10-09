"use client";

import { Suspense, lazy, useState } from "react";
import { Rotate3d } from "lucide-react";
import type { PiezaVista } from "../piezas-vista";
import { VistaPlanNoDisponible } from "../Plan3DEnPreparacion";
import { vistaDelPlan } from "./firma-plan";
import type { FirmaPlan, ImagenVista } from "./gestor-vista";
import { LeyendaPlan3D } from "./LeyendaPlan3D";
import { useImagenPlan3D, type EstadoImagenPlan3D } from "./usarImagenPlan3D";

/** La hoja que gira se baja al tocar: su código no hace falta hasta entonces. */
const HojaOrbita = lazy(() => import("./HojaOrbita").then((m) => ({ default: m.HojaOrbita })));

/** El lado (px) de la imagen fija de la tarjeta. */
export const LADO_VISTA = 768;

export type PropsVistaPlan3D = { firma: FirmaPlan; titulo: string; piezas: readonly PiezaVista[] };

/**
 * **La vista del plan 3D en «Tu plan»** (REQ-007, fase 3): una imagen fija de la decoración —cámara fija, sala neutra, sin
 * cuadrícula ni ayudas— hecha por el visor sin pantalla de la página, con la leyenda de colores de la lista de materiales.
 * Si el navegador puede, tocarla abre la hoja que gira; si no (sin WebGL, poca memoria, contexto perdido), es la vista de
 * reserva que dibuja el servidor y no gira. Solo se mira: nada se elige, se arrastra ni se edita aquí (D-020).
 */
export function VistaPlan3D(props: PropsVistaPlan3D) {
  const estado = useImagenPlan3D(props.firma, { vista: vistaDelPlan(props.piezas), lado: LADO_VISTA });
  return <MarcoVistaPlan3D {...props} estado={estado} />;
}

/** Lo que se ve según el estado de la imagen (sin red ni visor, para probarlo con cada camino: WebGL, reserva SVG, error). */
export function MarcoVistaPlan3D({ firma, titulo, piezas, estado }: PropsVistaPlan3D & { estado: EstadoImagenPlan3D }) {
  const [girando, setGirando] = useState(false);

  if (estado.fase === "error") return <VistaPlanNoDisponible />;
  const imagen: ImagenVista | null = estado.fase === "lista" ? estado.imagen : null;
  const puedeGirar = imagen?.modo === "webgl";
  const contenido = imagen ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={imagen.url} alt={`Cómo se ve ${titulo}, vista fija`} width={LADO_VISTA} height={LADO_VISTA} className="size-full object-cover" draggable={false} />
  ) : (
    <div className="brillo-carga size-full" role="status" aria-label="Preparando la vista de tu decoración" />
  );

  return (
    <section data-testid="vista-plan-3d" data-modo={imagen?.modo ?? "cargando"} aria-label="Vista de tu decoración" className="mx-auto mt-2.5 max-w-[30rem] rounded-2xl bg-superficie-suave p-2.5">
      {puedeGirar ? (
        <button type="button" onClick={() => setGirando(true)} aria-label="Abrir la vista de tu decoración para girarla" className="group relative block aspect-square w-full overflow-hidden rounded-xl bg-[#e6e6e9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/50">
          {contenido}
          <span aria-hidden className="absolute bottom-2 right-2 inline-flex items-center gap-1.5 rounded-full bg-superficie/95 px-3 py-1.5 text-xs font-semibold text-acento shadow-[0_1px_3px_var(--sombra)] ring-1 ring-borde-suave transition-transform group-hover:scale-105">
            <Rotate3d className="size-4" />
            Toca para girarla
          </span>
        </button>
      ) : (
        <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-[#e6e6e9]">{contenido}</div>
      )}
      {imagen?.modo === "svg" && <p className="mt-1.5 text-xs text-texto-suave">Este es un dibujo de tu decoración; en este dispositivo no se puede girar.</p>}
      <LeyendaPlan3D piezas={piezas} />
      {girando && <Suspense fallback={null}><HojaOrbita firma={firma} titulo={titulo} {...(imagen ? { respaldo: imagen.url } : {})} onCerrar={() => setGirando(false)} /></Suspense>}
    </section>
  );
}

