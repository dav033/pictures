
import { useEffect, useRef, useState } from "react";
import type { PatronColor, PatronColorResuelto } from "@/lib/plan/patron-color";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import { FalloPlanPatron, mensajeFalloPlanPatron, pedirVistaPatron } from "@/lib/plan/peticion-patron";
import { esCancelacion } from "@/lib/plan/peticion-plan-editar";
import { clavePatron } from "./borrador";

/** Pausa tras el último cambio antes de pedir la vista previa. */
const ESPERA_MS = 200;
const CLAVE_SUGERENCIA = "sugerencia";

export type ErrorVista = { mensaje: string; patronInvalido: boolean };

/**
 * Qué se sabe del borrador actual: Python lo dibujó (`listo`), lo rechazó
 * (`rechazado`, `patron_invalido`), no respondió (`fallido`: red, servidor) o
 * todavía no contesta (`pendiente`). El autoguardado solo guarda un `listo`.
 */
export type EstadoBorrador = "listo" | "rechazado" | "fallido" | "pendiente";

type Opciones = {
  plan: PlanResuelto["plan"];
  estructuraId: string;
  /** `null` pide la sugerencia de Python. */
  patron: PatronColor | null;
  /** Expansión que ya trae el plan: se muestra sin pedirla otra vez. */
  inicial: PatronColorResuelto | null;
};

/** Último dibujo de Python y las claves que cubre: la pedida y su eco (puede traer las claves en otro orden). */
type Respuesta = { claves: ReadonlySet<string>; vista: PatronColorResuelto | null };

/**
 * Vista previa de Python para el borrador del editor: con espera tras el
 * último cambio, cancelable y a prueba de respuestas viejas (solo cuenta la
 * última petición). Mientras carga se conserva el último dibujo. La
 * sugerencia se pide una sola vez: volver a "sin patrón" la muestra de nuevo
 * sin otra petición.
 */
export function useVistaPrevia({ plan, estructuraId, patron, inicial }: Opciones): {
  vista: PatronColorResuelto | null;
  /** Primera sugerencia de Python (cuando se pidió con `patron: null`): de ella parten los estilos si la pieza no tenía patrón. */
  sugerencia: PatronColorResuelto | null;
  cargando: boolean;
  error: ErrorVista | null;
  estadoBorrador: EstadoBorrador;
  reintentar: () => void;
} {
  const [respuesta, setRespuesta] = useState<Respuesta>(() => ({ claves: new Set(inicial ? [clavePatron(inicial.patron)] : []), vista: inicial }));
  const [sugerencia, setSugerencia] = useState<PatronColorResuelto | null>(null);
  const [enVuelo, setEnVuelo] = useState(false);
  const [error, setError] = useState<(ErrorVista & { clave: string }) | null>(null);
  const [intento, setIntento] = useState(0);
  const secuencia = useRef(0);
  const controlador = useRef<AbortController | null>(null);
  const clave = patron ? clavePatron(patron) : CLAVE_SUGERENCIA;
  const sugerenciaGuardada = clave === CLAVE_SUGERENCIA && sugerencia !== null && !respuesta.claves.has(clave);
  const respondida = respuesta.claves.has(clave) || sugerenciaGuardada;

  useEffect(() => {
    if (respondida) {
      // De vuelta a un diseño ya dibujado (deshacer): lo que siga en vuelo ya no cuenta.
      controlador.current?.abort();
      secuencia.current += 1;
      return;
    }
    const temporizador = window.setTimeout(() => {
      controlador.current?.abort();
      const actual = new AbortController();
      controlador.current = actual;
      const numero = ++secuencia.current;
      setEnVuelo(true);
      pedirVistaPatron({ plan, estructura_id: estructuraId, patron_color: patron }, { signal: actual.signal })
        .then((vista) => {
          if (numero !== secuencia.current) return;
          setRespuesta({ claves: new Set([clave, clavePatron(vista.patron)]), vista });
          if (clave === CLAVE_SUGERENCIA) setSugerencia((previa) => previa ?? vista);
          setError(null);
        })
        .catch((fallo: unknown) => {
          if (esCancelacion(fallo) || numero !== secuencia.current) return;
          setError({ clave, mensaje: mensajeFalloPlanPatron(fallo), patronInvalido: fallo instanceof FalloPlanPatron && fallo.patronInvalido });
        })
        .finally(() => {
          if (numero === secuencia.current) setEnVuelo(false);
        });
    }, clave === CLAVE_SUGERENCIA ? 0 : ESPERA_MS);
    return () => window.clearTimeout(temporizador);
  }, [clave, respondida, estructuraId, intento, plan, patron]);

  useEffect(() => () => controlador.current?.abort(), []);

  function reintentar(): void {
    setRespuesta((previa) => ({ ...previa, claves: new Set() }));
    setError(null);
    setIntento((valor) => valor + 1);
  }

  // Un diseño ya dibujado no arrastra el error de otro borrador; mientras llega
  // la respuesta del actual, el último error sigue a la vista hasta que la reemplace.
  const errorVisible = error && (error.clave === clave || !respondida) ? { mensaje: error.mensaje, patronInvalido: error.patronInvalido } : null;
  const errorPropio = !respondida && error?.clave === clave ? error : null;
  const estadoBorrador: EstadoBorrador = respondida ? "listo" : errorPropio ? (errorPropio.patronInvalido ? "rechazado" : "fallido") : "pendiente";
  return {
    vista: sugerenciaGuardada ? sugerencia : respuesta.vista,
    sugerencia,
    cargando: enVuelo && !respondida,
    error: errorVisible,
    estadoBorrador,
    reintentar,
  };
}
