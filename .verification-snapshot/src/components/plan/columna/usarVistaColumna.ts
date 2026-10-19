import { useEffect, useRef, useState } from "react";
import type { ArmadoColumnaV1 } from "@/lib/plan/armado-columna";
import { FalloPlanArmado, mensajeFalloPlanArmado } from "@/lib/plan/peticion-armado";
import { pedirVistaArmadoColumna, RESPALDO_VISTA_ARMADO_COLUMNA } from "@/lib/plan/peticion-armado-columna";
import { esCancelacion } from "@/lib/plan/peticion-plan-editar";
import { claveVistaColumna, panelVistaColumna, peticionVistaColumna, type FalloVistaColumna, type PanelVistaColumna, type PiezaVistaColumna, type RespuestaVistaColumna } from "./vista-columna";

/**
 * El dibujo que el motor hace dla columna de una pieza (ADR-0034), pedido a /api/plan-armado-columna.
 *
 * Gana el último armado: cambiar de armado cancela la petición en vuelo (`AbortController`, como
 * `usarVistaPrevia`) y una respuesta vieja que llegue igual no cuenta. No hay espera tras el último cambio
 * porque aquí no hay deslizador: el armado es el que trae el plan y cambia cuando el plan cambia.
 *
 * Lo que ya falló no se vuelve a pedir solo —hay que tocar "Reintentar"—, y lo que el motor rechazó
 * (`armado_invalido`) no se reintenta en absoluto: el armado del plan es el que no se sostiene y la frase de
 * Python dice qué pasa. En estado solo hay dos cosas, la última respuesta y el último fallo; la fase sale de
 * ellas (`panelVistaColumna`) y no se guarda aparte.
 */
export function useVistaColumna({ pieza, armado }: { pieza: PiezaVistaColumna; armado: ArmadoColumnaV1 }): {
  estado: PanelVistaColumna;
  reintentar: () => void;
} {
  const [respuesta, setRespuesta] = useState<RespuestaVistaColumna | null>(null);
  const [fallo, setFallo] = useState<FalloVistaColumna | null>(null);
  // Qué está en vuelo y por cuál dibujo: con esto un render de más (la tarjeta pinta a menudo) no vuelve a
  // pedir lo mismo, aunque `pieza` sea otro objeto en cada render.
  const vuelo = useRef<{ clave: string; controlador: AbortController } | null>(null);
  const clave = claveVistaColumna(pieza, armado);

  useEffect(() => {
    const respondido = respuesta?.clave === clave;
    const yaFallo = fallo?.clave === clave;
    if (respondido || yaFallo) {
      // Un dibujo que ya se tiene o que ya falló: lo que vuele por otro armado ya no cuenta.
      vuelo.current?.controlador.abort();
      vuelo.current = null;
      return;
    }
    if (vuelo.current?.clave === clave) return;
    vuelo.current?.controlador.abort();
    const propio = { clave, controlador: new AbortController() };
    vuelo.current = propio;
    pedirVistaArmadoColumna(peticionVistaColumna(pieza, armado), { signal: propio.controlador.signal })
      .then((vista) => {
        if (vuelo.current !== propio) return;
        vuelo.current = null;
        setRespuesta({ clave: propio.clave, vista });
      })
      .catch((error: unknown) => {
        if (esCancelacion(error) || vuelo.current !== propio) return;
        vuelo.current = null;
        setFallo({
          clave: propio.clave,
          mensaje: mensajeFalloPlanArmado(error, RESPALDO_VISTA_ARMADO_COLUMNA),
          armadoInvalido: error instanceof FalloPlanArmado && error.armadoInvalido,
        });
      });
  }, [clave, respuesta, fallo, pieza, armado]);

  // Al desmontar se cancela lo que quede. El `null` no sobra: en StrictMode (y con Fast Refresh) el efecto
  // se vuelve a montar justo después, y sin él vería su propia petición abortada como si siguiera en vuelo.
  useEffect(() => () => {
    vuelo.current?.controlador.abort();
    vuelo.current = null;
  }, []);

  return {
    estado: panelVistaColumna(clave, respuesta, fallo),
    // Quitar el fallo de este dibujo basta: el efecto lo vuelve a pedir en el render siguiente.
    reintentar: () => setFallo((previo) => (previo?.clave === clave ? null : previo)),
  };
}
