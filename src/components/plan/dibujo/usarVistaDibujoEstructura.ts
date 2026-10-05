import { useEffect, useRef, useState } from "react";
import { mensajeFalloPlanArmado } from "@/lib/plan/peticion-armado";
import { pedirDibujoEstructura, RESPALDO_DIBUJO_ESTRUCTURA } from "@/lib/plan/peticion-dibujo-estructura";
import { esCancelacion } from "@/lib/plan/peticion-plan-editar";
import {
  claveDibujoEstructura,
  panelDibujoEstructura,
  peticionDibujoEstructura,
  type FalloDibujoEstructura,
  type PanelDibujoEstructura,
  type PiezaDibujoEstructura,
  type RespuestaDibujoEstructura,
} from "./vista-dibujo-estructura";

/**
 * El dibujo esquemático de una pieza sin motor, pedido a /api/plan-dibujo-estructura.
 *
 * Mismo patrón que `useVistaArcoOrganico`, con un estado menos: aquí no hay armado que el motor pueda
 * rechazar, así que un fallo siempre se puede reintentar. Gana la última pieza: cambiar un color cancela la
 * petición en vuelo (`AbortController`) y una respuesta vieja que llegue igual no cuenta. Lo que ya falló no se
 * vuelve a pedir solo —hay que tocar «Reintentar»—. En estado solo hay dos cosas, la última respuesta y el
 * último fallo; la fase sale de ellas (`panelDibujoEstructura`) y no se guarda aparte.
 */
export function useVistaDibujoEstructura(pieza: PiezaDibujoEstructura): {
  estado: PanelDibujoEstructura;
  reintentar: () => void;
} {
  const [respuesta, setRespuesta] = useState<RespuestaDibujoEstructura | null>(null);
  const [fallo, setFallo] = useState<FalloDibujoEstructura | null>(null);
  // Qué está en vuelo y por cuál dibujo: con esto un render de más (la tarjeta pinta a menudo) no vuelve a
  // pedir lo mismo, aunque `pieza` sea otro objeto en cada render.
  const vuelo = useRef<{ clave: string; controlador: AbortController } | null>(null);
  const clave = claveDibujoEstructura(pieza);

  useEffect(() => {
    if (respuesta?.clave === clave || fallo?.clave === clave) {
      // Un dibujo que ya se tiene o que ya falló: lo que vuele por otra pieza ya no cuenta.
      vuelo.current?.controlador.abort();
      vuelo.current = null;
      return;
    }
    if (vuelo.current?.clave === clave) return;
    vuelo.current?.controlador.abort();
    const propio = { clave, controlador: new AbortController() };
    vuelo.current = propio;
    pedirDibujoEstructura(peticionDibujoEstructura(pieza), { signal: propio.controlador.signal })
      .then((grafica) => {
        if (vuelo.current !== propio) return;
        vuelo.current = null;
        setRespuesta({ clave: propio.clave, grafica });
      })
      .catch((error: unknown) => {
        if (esCancelacion(error) || vuelo.current !== propio) return;
        vuelo.current = null;
        setFallo({ clave: propio.clave, mensaje: mensajeFalloPlanArmado(error, RESPALDO_DIBUJO_ESTRUCTURA) });
      });
  }, [clave, respuesta, fallo, pieza]);

  // Al desmontar se cancela lo que quede. El `null` no sobra: en StrictMode (y con Fast Refresh) el efecto se
  // vuelve a montar justo después, y sin él vería su propia petición abortada como si siguiera en vuelo.
  useEffect(() => () => {
    vuelo.current?.controlador.abort();
    vuelo.current = null;
  }, []);

  return {
    estado: panelDibujoEstructura(clave, respuesta, fallo),
    // Quitar el fallo de este dibujo basta: el efecto lo vuelve a pedir en el render siguiente.
    reintentar: () => setFallo((previo) => (previo?.clave === clave ? null : previo)),
  };
}
