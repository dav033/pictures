"use client";

import { Suspense, lazy } from "react";
import { IconoEstructura } from "@/components/plan/IconoEstructura";
import type { PropsMiniaturaPieza } from "./MiniaturaPieza3D";
import type { PropsVistaPlan3D } from "./VistaPlan3D";

/**
 * Las únicas puertas de «Tu plan» a la vista 3D (REQ-007, fase 3). Todo lo que trae el visor, el gestor y, detrás de ellos,
 * three.js está detrás de estos `import()`: la primera carga de /asistente no cambia y el trozo se baja al ver el primer plan
 * del motor 3D. `React.lazy` y no `next/dynamic`: no suma ni un byte a la primera carga. `test-motor3d-frontera.ts` vigila que
 * ninguna otra ruta estática llegue hasta el visor.
 */
const VistaPlan3D = lazy(() => import("./VistaPlan3D").then((m) => ({ default: m.VistaPlan3D })));
const MiniaturaPieza3D = lazy(() => import("./MiniaturaPieza3D").then((m) => ({ default: m.MiniaturaPieza3D })));

const Esqueleto = () => <div data-testid="vista-plan-3d-cargando" role="status" aria-label="Preparando la vista de tu decoración" className="brillo-carga mx-auto mt-2.5 aspect-square w-full max-w-[30rem] rounded-2xl" />;

export function VistaPlan3DPerezosa(props: PropsVistaPlan3D) {
  return <Suspense fallback={<Esqueleto />}><VistaPlan3D {...props} /></Suspense>;
}

/** El icono de la pieza hasta que llega su imagen (o para siempre, si no llega). */
export function MiniaturaPieza3DPerezosa(props: PropsMiniaturaPieza) {
  return (
    <span className="relative grid size-full place-items-center">
      <IconoEstructura id={props.oficial ?? "arco"} className="size-9" />
      <span className="absolute inset-0 overflow-hidden rounded-lg"><Suspense fallback={null}><MiniaturaPieza3D {...props} /></Suspense></span>
    </span>
  );
}
