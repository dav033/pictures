import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ModoAdmitido, PatronColor, PatronColorResuelto } from "@/lib/plan/patron-color";
import { FalloPlanPatron, mensajeFalloPlanPatron, pedirVistaPatronDetallada, type VistaPatronDetallada } from "@/lib/plan/peticion-patron";
import { esCancelacion } from "@/lib/plan/peticion-plan-editar";
import { clavePatron } from "./borrador";
import { crearArranqueEstilo, type ArranqueEstilo, type EstadoArranqueEstilo } from "./arranque-estilo";
import { peticionVistaPieza, type PiezaVistaPrevia } from "./peticion-pieza";

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
  /** La pieza tal como estaba al abrir el editor (plan, estructura y sus líneas). */
  pieza: PiezaVistaPrevia;
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
 * con cada respuesta y con cada rechazo del patrón (así se conocen aunque
 * Python no pueda sugerir ninguno). Al abrir con el dibujo del plan se pide
 * igual una vez, sin tapar ese dibujo, solo para saberlos.
 */
export function useVistaPrevia({ pieza, patron, inicial }: Opciones): {
  vista: PatronColorResuelto | null;
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
      pedirVistaPatronDetallada(peticionVistaPieza(pieza, { patron_color: patron }), { signal: actual.signal })
        .then(({ patron: vista, modos_admitidos: admitidos }) => {
          if (numero !== secuencia.current) return;
          setRespuesta({ claves: new Set([clave, clavePatron(vista.patron)]), vista });
          setModos(admitidos);
          if (clave === CLAVE_SUGERENCIA) setSugerencia((previa) => previa ?? vista);
          setError(null);
        })
        .catch((fallo: unknown) => {
          if (esCancelacion(fallo) || numero !== secuencia.current) return;
          // Un rechazo del patrón dice igual qué estilos admite la pieza.
          if (fallo instanceof FalloPlanPatron && fallo.modosAdmitidos) setModos(fallo.modosAdmitidos);
          setError({ clave, mensaje: mensajeFalloPlanPatron(fallo), patronInvalido: fallo instanceof FalloPlanPatron && fallo.patronInvalido });
        })
        .finally(() => {
          if (numero === secuencia.current) setEnVuelo(false);
        });
    }, clave === CLAVE_SUGERENCIA || respondida ? 0 : ESPERA_MS);
    return () => window.clearTimeout(temporizador);
  }, [clave, respondida, faltanModos, yaFallo, intento, pieza, patron]);

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
    modos,
    cargando: enVuelo && !respondida,
    error: errorVisible,
    estadoBorrador,
    reintentar,
    sembrar,
  };
}

/**
 * Lo que el punto de partida de un estilo trae de nuevo respecto del dibujo
 * que había: sobre todo lo que Python tuvo que quitar del borrador al cambiar
 * ("El estilo «bloques» no se arma en espejo…", ADR-0028 §10). Se muestra
 * junto a los estilos, donde el decorador acaba de tocar; los avisos que ya
 * traía el dibujo siguen solo en el conteo. Solo compara textos: no decide nada.
 */
export function avisosDelCambioDeEstilo(previa: PatronColorResuelto | null, llegada: PatronColorResuelto): string[] {
  const antes = new Set(previa?.avisos ?? []);
  return llegada.avisos.filter((aviso) => !antes.has(aviso));
}

/**
 * `crearArranqueEstilo` para el editor: una instancia por montaje. La pieza,
 * el borrador y `alLlegar` pueden cambiar en cada render; se usan los del
 * último. Desmontar descarta el pedido que quede.
 */
export function useArranqueEstilo({ pieza, borrador, alLlegar }: {
  pieza: PiezaVistaPrevia;
  /** El borrador a la vista cuando se elige el estilo (el patrón o la sugerencia); `null` sin ninguno. */
  borrador: PatronColor | null;
  alLlegar: (detallada: VistaPatronDetallada) => void;
}): EstadoArranqueEstilo & Pick<ArranqueEstilo, "elegir" | "cancelar"> {
  const [control] = useState(() => crearArranqueEstilo({ pieza, borrador, alLlegar }));
  useEffect(() => {
    control.usar({ pieza, borrador, alLlegar });
  }, [control, pieza, borrador, alLlegar]);
  useEffect(() => () => control.cancelar(), [control]);
  const estado = useSyncExternalStore(control.suscribir, control.estado, control.estado);
  return { ...estado, elegir: control.elegir, cancelar: control.cancelar };
}
