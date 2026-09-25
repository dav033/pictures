import type { ModoPatronColor, PatronColor } from "@/lib/plan/patron-color";
import { mensajeFalloPlanPatron, pedirVistaPatronDetallada, type VistaPatronDetallada } from "@/lib/plan/peticion-patron";
import { esCancelacion } from "@/lib/plan/peticion-plan-editar";
import { peticionVistaPieza, type PiezaVistaPrevia } from "./peticion-pieza";

/**
 * Elegir un estilo que no es el del borrador (ADR-0028 §10 y §13): Python
 * arma su punto de partida (`modo` en la vista previa) y esa respuesta pasa a
 * ser el borrador (`alLlegar`). Con el pedido va el borrador que el editor
 * tiene a la vista en ese momento (`desde`): Python conserva de él lo que el
 * estilo nuevo admite (tamaño del racimo, dirección, espejo, acentos) y avisa
 * de lo que no pudo; aquí no se mezcla nada. Solo cuenta el último pedido;
 * `cancelar` lo descarta (otro cambio del decorador llegó antes). Un rechazo
 * de Python queda junto al estilo que se eligió. Sin React: `useArranqueEstilo`
 * lo monta en el editor y las pruebas lo manejan igual.
 */

export type EstadoArranqueEstilo = {
  /** El estilo que Python está armando. */
  pendiente: ModoPatronColor | null;
  error: { modo: ModoPatronColor; mensaje: string } | null;
};

/** Lo que el editor tiene ahora: cambia con cada render y cuenta el último. */
export type ActualArranqueEstilo = {
  pieza: PiezaVistaPrevia;
  /** El borrador a la vista (el patrón o la sugerencia); `null` sin ninguno. */
  borrador: PatronColor | null;
  alLlegar: (detallada: VistaPatronDetallada) => void;
};

export type ArranqueEstilo = {
  estado: () => EstadoArranqueEstilo;
  suscribir: (oyente: () => void) => () => void;
  elegir: (modo: ModoPatronColor) => void;
  cancelar: () => void;
  /** La pieza, el borrador y quién recibe la respuesta del último render. */
  usar: (actual: ActualArranqueEstilo) => void;
};

const SIN_PEDIDO: EstadoArranqueEstilo = { pendiente: null, error: null };

export function crearArranqueEstilo(inicial: ActualArranqueEstilo, { fetcher }: { fetcher?: typeof fetch } = {}): ArranqueEstilo {
  let actual = inicial;
  let controlador: AbortController | null = null;
  let estado = SIN_PEDIDO;
  const oyentes = new Set<() => void>();

  function fijar(siguiente: EstadoArranqueEstilo): void {
    if (siguiente.pendiente === estado.pendiente && siguiente.error === estado.error) return;
    estado = siguiente;
    for (const oyente of oyentes) oyente();
  }

  function elegir(modo: ModoPatronColor): void {
    controlador?.abort();
    const propio = new AbortController();
    controlador = propio;
    fijar({ pendiente: modo, error: null });
    const { pieza, borrador } = actual;
    pedirVistaPatronDetallada(peticionVistaPieza(pieza, { patron_color: null, modo, ...(borrador ? { desde: borrador } : {}) }), { signal: propio.signal, fetcher })
      .then(
        (detallada) => {
          if (controlador !== propio) return;
          controlador = null;
          fijar(SIN_PEDIDO);
          actual.alLlegar(detallada);
        },
        (fallo: unknown) => {
          if (esCancelacion(fallo) || controlador !== propio) return;
          controlador = null;
          fijar({ pendiente: null, error: { modo, mensaje: mensajeFalloPlanPatron(fallo) } });
        },
      );
  }

  return {
    estado: () => estado,
    suscribir(oyente) {
      oyentes.add(oyente);
      return () => oyentes.delete(oyente);
    },
    elegir,
    cancelar() {
      controlador?.abort();
      controlador = null;
      fijar(SIN_PEDIDO);
    },
    usar(siguiente) {
      actual = siguiente;
    },
  };
}
