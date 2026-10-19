"use client";

import { useEffect, useState } from "react";
import { gestorDeLaPagina, type FirmaPlan, type GestorVista, type ImagenVista, type PedidoVista } from "./gestor-vista";

export type EstadoImagenPlan3D =
  | { fase: "cargando" }
  | { fase: "lista"; imagen: ImagenVista }
  | { fase: "error" };

type Resuelto = { clave: string; estado: Exclude<EstadoImagenPlan3D, { fase: "cargando" }> };

/**
 * La imagen fija del plan 3D (o de una de sus piezas): la pide al gestor de la página al montar y la cambia si cambia el
 * plan, la pieza o la cámara. Nunca lanza: un fallo es `error` y quien la pinta muestra su respaldo. Sin `Date.now` ni
 * azar, y sin cambiar el estado dentro del efecto: lo que llega queda anotado con la clave de lo que se pidió, y mientras
 * la clave de ahora no sea esa, el estado es `cargando` (el primer render lo es siempre).
 */
export function useImagenPlan3D(firma: FirmaPlan | null, pedido: PedidoVista, gestor: () => GestorVista = gestorDeLaPagina): EstadoImagenPlan3D {
  const [resuelto, setResuelto] = useState<Resuelto | null>(null);
  const hash = firma?.plan_hash ?? null;
  const { pieza, vista, lado } = pedido;
  // El final del token también va en la clave: el mismo plan con un token nuevo (el anterior venció) vuelve a intentarse.
  const clave = `${hash}|${firma?.approval_token.slice(-12) ?? ""}|${pieza ?? "*"}|${vista}|${lado}`;
  useEffect(() => {
    if (!firma || hash === null) return;
    let vivo = true;
    gestor().imagen(firma, { ...(pieza ? { pieza } : {}), vista, lado }).then(
      (imagen) => { if (vivo) setResuelto({ clave, estado: { fase: "lista", imagen } }); },
      () => { if (vivo) setResuelto({ clave, estado: { fase: "error" } }); },
    );
    return () => { vivo = false; };
    // La firma se identifica por su hash (dentro de `clave`): el objeto se rehace en cada render del plan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);
  return resuelto?.clave === clave ? resuelto.estado : { fase: "cargando" };
}
