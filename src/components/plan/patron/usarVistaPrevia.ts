import { useEffect, useRef, useState } from "react";
import type { ModoAdmitido, ModoPatronColor, PatronColor, PatronColorResuelto } from "@/lib/plan/patron-color";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import { FalloPlanPatron, mensajeFalloPlanPatron, pedirModosAdmitidos, pedirVistaPatronDetallada, type VistaPatronDetallada } from "@/lib/plan/peticion-patron";
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
  /** Expansión que ya trae el plan: se muestra sin esperar otra. */
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
 *
 * También trae los estilos que Python admite para la pieza (`modos`): llegan
 * con cada respuesta. Al abrir con el dibujo del plan se pide igual una vez,
 * sin tapar ese dibujo, solo para saberlos. Si Python no pudo sugerir un
 * patrón (su rechazo no los trae), se preguntan con `pedirModosAdmitidos`.
 */
export function useVistaPrevia({ plan, estructuraId, patron, inicial }: Opciones): {
  vista: PatronColorResuelto | null;
  /** Primera sugerencia de Python (cuando se pidió con `patron: null`). */
  sugerencia: PatronColorResuelto | null;
  /** Estilos que Python admite para la pieza, en su orden; `null` mientras no los dijo. */
  modos: ModoAdmitido[] | null;
  cargando: boolean;
  error: ErrorVista | null;
  estadoBorrador: EstadoBorrador;
  reintentar: () => void;
  /** Una respuesta de Python pedida por otro camino (el punto de partida de un estilo): se dibuja sin pedirla otra vez. */
  sembrar: (detallada: VistaPatronDetallada) => void;
} {
  const [respuesta, setRespuesta] = useState<Respuesta>(() => ({ claves: new Set(inicial ? [clavePatron(inicial.patron)] : []), vista: inicial }));
  const [sugerencia, setSugerencia] = useState<PatronColorResuelto | null>(null);
  const [modos, setModos] = useState<ModoAdmitido[] | null>(null);
  const [enVuelo, setEnVuelo] = useState(false);
  const [error, setError] = useState<(ErrorVista & { clave: string }) | null>(null);
  const [intento, setIntento] = useState(0);
  const secuencia = useRef(0);
  const controlador = useRef<AbortController | null>(null);
  const clave = patron ? clavePatron(patron) : CLAVE_SUGERENCIA;
  const sugerenciaGuardada = clave === CLAVE_SUGERENCIA && sugerencia !== null && !respuesta.claves.has(clave);
  const respondida = respuesta.claves.has(clave) || sugerenciaGuardada;
  const faltanModos = modos === null;
  // Lo que Python ya contestó mal para este borrador no se vuelve a pedir solo: "Reintentar" o un cambio.
  const yaFallo = error?.clave === clave;
  // Python rechazó la sugerencia y con ella no vinieron los estilos: se preguntan aparte.
  const sinSugerencia = faltanModos && clave === CLAVE_SUGERENCIA && error?.clave === CLAVE_SUGERENCIA && error.patronInvalido;

  useEffect(() => {
    if (respondida && !faltanModos) {
      // De vuelta a un diseño ya dibujado (deshacer): lo que siga en vuelo ya no cuenta.
      controlador.current?.abort();
      secuencia.current += 1;
      return;
    }
    if (yaFallo) return;
    const temporizador = window.setTimeout(() => {
      controlador.current?.abort();
      const actual = new AbortController();
      controlador.current = actual;
      const numero = ++secuencia.current;
      setEnVuelo(true);
      pedirVistaPatronDetallada({ plan, estructura_id: estructuraId, patron_color: patron }, { signal: actual.signal })
        .then(({ patron: vista, modos_admitidos: admitidos }) => {
          if (numero !== secuencia.current) return;
          setRespuesta({ claves: new Set([clave, clavePatron(vista.patron)]), vista });
          setModos(admitidos);
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
    }, clave === CLAVE_SUGERENCIA || respondida ? 0 : ESPERA_MS);
    return () => window.clearTimeout(temporizador);
  }, [clave, respondida, faltanModos, yaFallo, estructuraId, intento, plan, patron]);

  useEffect(() => {
    if (!sinSugerencia) return;
    const actual = new AbortController();
    pedirModosAdmitidos({ plan, estructura_id: estructuraId }, { signal: actual.signal })
      .then(setModos)
      // Sin ningún estilo que Python arme, el mensaje de la sugerencia ya dice por qué.
      .catch((fallo: unknown) => {
        if (!esCancelacion(fallo)) console.warn("[patron] ningún estilo se arma en esta pieza:", mensajeFalloPlanPatron(fallo));
      });
    return () => actual.abort();
  }, [sinSugerencia, plan, estructuraId]);

  useEffect(() => () => controlador.current?.abort(), []);

  function reintentar(): void {
    setRespuesta((previa) => ({ ...previa, claves: new Set() }));
    setError(null);
    setIntento((valor) => valor + 1);
  }

  function sembrar({ patron: vista, modos_admitidos: admitidos }: VistaPatronDetallada): void {
    setRespuesta({ claves: new Set([clavePatron(vista.patron)]), vista });
    setModos(admitidos);
    setError(null);
  }

  // Un diseño ya dibujado no arrastra el error de otro borrador; mientras llega
  // la respuesta del actual, el último error sigue a la vista hasta que la reemplace.
  const errorVisible = error && (error.clave === clave || !respondida) ? { mensaje: error.mensaje, patronInvalido: error.patronInvalido } : null;
  const errorPropio = !respondida && error?.clave === clave ? error : null;
  const estadoBorrador: EstadoBorrador = respondida ? "listo" : errorPropio ? (errorPropio.patronInvalido ? "rechazado" : "fallido") : "pendiente";
  return {
    vista: sugerenciaGuardada ? sugerencia : respuesta.vista,
    sugerencia,
    modos,
    cargando: enVuelo && !respondida,
    error: errorVisible,
    estadoBorrador,
    reintentar,
    sembrar,
  };
}

/**
 * Elegir un estilo que no es el del borrador: Python arma su punto de partida
 * (`modo` en la vista previa) y esa respuesta pasa a ser el borrador
 * (`alLlegar`). Solo cuenta el último pedido; `cancelar` lo descarta (otro
 * cambio del decorador llegó antes). Un rechazo de Python queda junto al
 * estilo que se eligió.
 */
export function useArranqueEstilo({ plan, estructuraId, alLlegar }: {
  plan: PlanResuelto["plan"];
  estructuraId: string;
  alLlegar: (detallada: VistaPatronDetallada) => void;
}): {
  pendiente: ModoPatronColor | null;
  error: { modo: ModoPatronColor; mensaje: string } | null;
  elegir: (modo: ModoPatronColor) => void;
  cancelar: () => void;
} {
  const [pendiente, setPendiente] = useState<ModoPatronColor | null>(null);
  const [error, setError] = useState<{ modo: ModoPatronColor; mensaje: string } | null>(null);
  const controlador = useRef<AbortController | null>(null);
  const alLlegarRef = useRef(alLlegar);
  useEffect(() => {
    alLlegarRef.current = alLlegar;
  }, [alLlegar]);
  useEffect(() => () => controlador.current?.abort(), []);

  function elegir(modo: ModoPatronColor): void {
    controlador.current?.abort();
    const actual = new AbortController();
    controlador.current = actual;
    setPendiente(modo);
    setError(null);
    pedirVistaPatronDetallada({ plan, estructura_id: estructuraId, patron_color: null, modo }, { signal: actual.signal })
      .then((detallada) => {
        if (controlador.current !== actual) return;
        controlador.current = null;
        setPendiente(null);
        alLlegarRef.current(detallada);
      })
      .catch((fallo: unknown) => {
        if (esCancelacion(fallo) || controlador.current !== actual) return;
        controlador.current = null;
        setPendiente(null);
        setError({ modo, mensaje: mensajeFalloPlanPatron(fallo) });
      });
  }

  function cancelar(): void {
    controlador.current?.abort();
    controlador.current = null;
    setPendiente(null);
    setError(null);
  }

  return { pendiente, error, elegir, cancelar };
}
