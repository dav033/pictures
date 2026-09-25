import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ArmadoBouquetResuelto, ArmadoBouquetV1 } from "@/lib/plan/armado-bouquet";
import { FalloPlanArmado, mensajeFalloPlanArmado, pedirVistaArmado, type OpcionesArmado, type VistaArmado } from "@/lib/plan/peticion-armado";
import { esCancelacion } from "@/lib/plan/peticion-plan-editar";
import { claveArmado } from "./borrador-armado";
import { crearArranqueArmado, peticionVistaArmado, type ArranqueArmado, type EstadoArranqueArmado, type PiezaVistaArmado } from "./arranque-armado";

/** Pausa tras el último cambio antes de pedir la vista previa. */
const ESPERA_MS = 300;
const CLAVE_SUGERENCIA = "sugerencia";

export type ErrorVistaArmado = { mensaje: string; armadoInvalido: boolean };

/** Qué se sabe del borrador: Python lo dibujó, lo rechazó, no respondió o todavía no contesta. */
export type EstadoBorradorArmado = "listo" | "rechazado" | "fallido" | "pendiente";

type Opciones = {
  pieza: PiezaVistaArmado;
  /** `null` pide la receta de Python. */
  armado: ArmadoBouquetV1 | null;
  /** Armado que ya trae el plan: se muestra sin esperar otro. */
  inicial: ArmadoBouquetResuelto | null;
  /** Python rechazó un borrador del decorador (no la petición de opciones al abrir). */
  alRechazar?: (mensaje: string) => void;
};

type Respuesta = { claves: ReadonlySet<string>; vista: ArmadoBouquetResuelto | null };

/**
 * Vista previa de Python para el borrador del editor de armado: con espera
 * tras el último cambio, cancelable y a prueba de respuestas viejas. Mientras
 * carga se conserva el último dibujo. La receta (`armado: null`) se pide una
 * sola vez. Trae también los estilos y las disposiciones que Python admite
 * (`opciones`): llegan con cada respuesta y con cada rechazo; al abrir con el
 * armado del plan se pide igual una vez, sin tapar ese dibujo, solo para saberlas.
 */
export function useVistaArmado({ pieza, armado, inicial, alRechazar }: Opciones): {
  vista: ArmadoBouquetResuelto | null;
  opciones: OpcionesArmado | null;
  cargando: boolean;
  error: ErrorVistaArmado | null;
  estadoBorrador: EstadoBorradorArmado;
  reintentar: () => void;
  /** Una respuesta pedida por otro camino (el punto de partida de un estilo): se dibuja sin pedirla otra vez. */
  sembrar: (vista: VistaArmado) => void;
} {
  const [respuesta, setRespuesta] = useState<Respuesta>(() => ({ claves: new Set(inicial ? [claveArmado(inicial.armado)] : []), vista: inicial }));
  const [sugerencia, setSugerencia] = useState<ArmadoBouquetResuelto | null>(null);
  const [opciones, setOpciones] = useState<OpcionesArmado | null>(null);
  const [enVuelo, setEnVuelo] = useState(false);
  const [error, setError] = useState<(ErrorVistaArmado & { clave: string }) | null>(null);
  const [intento, setIntento] = useState(0);
  const secuencia = useRef(0);
  const controlador = useRef<AbortController | null>(null);
  // El aviso de rechazo del último render, fuera del render (se llama desde la respuesta de Python).
  const rechazar = useRef(alRechazar);
  useEffect(() => {
    rechazar.current = alRechazar;
  }, [alRechazar]);
  const clave = armado ? claveArmado(armado) : CLAVE_SUGERENCIA;
  const sugerenciaGuardada = clave === CLAVE_SUGERENCIA && sugerencia !== null && !respuesta.claves.has(clave);
  const respondida = respuesta.claves.has(clave) || sugerenciaGuardada;
  const faltanOpciones = opciones === null;
  const yaFallo = error?.clave === clave;

  useEffect(() => {
    if (respondida && !faltanOpciones) {
      controlador.current?.abort();
      secuencia.current += 1;
      return;
    }
    if (yaFallo) return;
    const soloOpciones = respondida;
    const temporizador = window.setTimeout(() => {
      controlador.current?.abort();
      const actual = new AbortController();
      controlador.current = actual;
      const numero = ++secuencia.current;
      setEnVuelo(true);
      pedirVistaArmado(peticionVistaArmado(pieza, { armado_bouquet: armado }), { signal: actual.signal })
        .then(({ armado: vista, opciones: admitidas }) => {
          if (numero !== secuencia.current) return;
          setRespuesta({ claves: new Set([clave, claveArmado(vista.armado)]), vista });
          setOpciones(admitidas);
          if (clave === CLAVE_SUGERENCIA) setSugerencia((previa) => previa ?? vista);
          setError(null);
        })
        .catch((fallo: unknown) => {
          if (esCancelacion(fallo) || numero !== secuencia.current) return;
          const invalido = fallo instanceof FalloPlanArmado && fallo.armadoInvalido;
          if (fallo instanceof FalloPlanArmado && fallo.opciones) setOpciones(fallo.opciones);
          const mensaje = mensajeFalloPlanArmado(fallo);
          setError({ clave, mensaje, armadoInvalido: invalido });
          if (invalido && !soloOpciones && clave !== CLAVE_SUGERENCIA) rechazar.current?.(mensaje);
        })
        .finally(() => {
          if (numero === secuencia.current) setEnVuelo(false);
        });
    }, clave === CLAVE_SUGERENCIA || respondida ? 0 : ESPERA_MS);
    return () => window.clearTimeout(temporizador);
  }, [clave, respondida, faltanOpciones, yaFallo, intento, pieza, armado]);

  useEffect(() => () => controlador.current?.abort(), []);

  function reintentar(): void {
    setRespuesta((previa) => ({ ...previa, claves: new Set() }));
    setError(null);
    setIntento((valor) => valor + 1);
  }

  function sembrar({ armado: vista, opciones: admitidas }: VistaArmado): void {
    setRespuesta({ claves: new Set([claveArmado(vista.armado)]), vista });
    setOpciones(admitidas);
    setError(null);
  }

  const errorVisible = error && (error.clave === clave || !respondida) ? { mensaje: error.mensaje, armadoInvalido: error.armadoInvalido } : null;
  const errorPropio = !respondida && error?.clave === clave ? error : null;
  const estadoBorrador: EstadoBorradorArmado = respondida ? "listo" : errorPropio ? (errorPropio.armadoInvalido ? "rechazado" : "fallido") : "pendiente";
  return {
    vista: sugerenciaGuardada ? sugerencia : respuesta.vista,
    opciones,
    cargando: enVuelo && !respondida,
    error: errorVisible,
    estadoBorrador,
    reintentar,
    sembrar,
  };
}

/** `crearArranqueArmado` para el editor: una instancia por montaje; la pieza y `alLlegar` son las del último render. */
export function useArranqueArmado({ pieza, alLlegar }: { pieza: PiezaVistaArmado; alLlegar: (vista: VistaArmado) => void }): EstadoArranqueArmado & Pick<ArranqueArmado, "elegir" | "cancelar"> {
  const [control] = useState(() => crearArranqueArmado({ pieza, alLlegar }));
  useEffect(() => {
    control.usar({ pieza, alLlegar });
  }, [control, pieza, alLlegar]);
  useEffect(() => () => control.cancelar(), [control]);
  const estado = useSyncExternalStore(control.suscribir, control.estado, control.estado);
  return { ...estado, elegir: control.elegir, cancelar: control.cancelar };
}
