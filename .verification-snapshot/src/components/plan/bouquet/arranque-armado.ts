import type { DisposicionNumero, VarianteBouquet } from "@/lib/plan/armado-bouquet";
import { mensajeFalloPlanArmado, pedirVistaArmado, type GloboVistaArmado, type PeticionVistaArmado, type VistaArmado } from "@/lib/plan/peticion-armado";
import { esCancelacion } from "@/lib/plan/peticion-plan-editar";
import type { PlanResuelto } from "@/lib/plan/resuelto";

/**
 * La pieza sobre la que se pide una vista previa del armado: el plan que
 * había al abrir, la estructura y sus globos (de las líneas resueltas).
 */
export type PiezaVistaArmado = {
  plan: PlanResuelto["plan"];
  estructuraId: string;
  globos: readonly GloboVistaArmado[];
};

export type PedidoVistaArmado = Omit<PeticionVistaArmado, "plan" | "estructura_id" | "globos">;

/** Cuerpo de /api/plan-armado-bouquet para una pieza. Solo transporte. */
export function peticionVistaArmado(pieza: PiezaVistaArmado, pedido: PedidoVistaArmado): PeticionVistaArmado {
  return { ...pedido, plan: pieza.plan, estructura_id: pieza.estructuraId, globos: pieza.globos };
}

/** Un estilo o una disposición de los números que eligió el decorador: Python arma su punto de partida. */
export type PedidoEstiloArmado = { variante: VarianteBouquet; disposicion?: DisposicionNumero };

export type EstadoArranqueArmado = {
  /** Lo que Python está armando. */
  pendiente: PedidoEstiloArmado | null;
  error: { pedido: PedidoEstiloArmado; mensaje: string } | null;
};

export type ActualArranqueArmado = {
  pieza: PiezaVistaArmado;
  alLlegar: (vista: VistaArmado) => void;
};

export type ArranqueArmado = {
  estado: () => EstadoArranqueArmado;
  suscribir: (oyente: () => void) => () => void;
  elegir: (pedido: PedidoEstiloArmado) => void;
  cancelar: () => void;
  usar: (actual: ActualArranqueArmado) => void;
};

const SIN_PEDIDO: EstadoArranqueArmado = { pendiente: null, error: null };

/**
 * Elegir otro estilo o mover los números (ADR-0030): Python arma la receta
 * con `{armado_bouquet: null, variante, disposicion}` y esa respuesta pasa a
 * ser el borrador (`alLlegar`). Solo cuenta el último pedido; `cancelar` lo
 * descarta (otro gesto del decorador llegó antes). Un rechazo de Python queda
 * junto a lo que se eligió. Sin React: `useArranqueArmado` lo monta.
 */
export function crearArranqueArmado(inicial: ActualArranqueArmado, { fetcher }: { fetcher?: typeof fetch } = {}): ArranqueArmado {
  let actual = inicial;
  let controlador: AbortController | null = null;
  let estado = SIN_PEDIDO;
  const oyentes = new Set<() => void>();

  function fijar(siguiente: EstadoArranqueArmado): void {
    if (siguiente.pendiente === estado.pendiente && siguiente.error === estado.error) return;
    estado = siguiente;
    for (const oyente of oyentes) oyente();
  }

  function elegir(pedido: PedidoEstiloArmado): void {
    controlador?.abort();
    const propio = new AbortController();
    controlador = propio;
    fijar({ pendiente: pedido, error: null });
    pedirVistaArmado(peticionVistaArmado(actual.pieza, { armado_bouquet: null, ...pedido }), { signal: propio.signal, fetcher })
      .then(
        (vista) => {
          if (controlador !== propio) return;
          controlador = null;
          fijar(SIN_PEDIDO);
          actual.alLlegar(vista);
        },
        (fallo: unknown) => {
          if (esCancelacion(fallo) || controlador !== propio) return;
          controlador = null;
          fijar({ pendiente: null, error: { pedido, mensaje: mensajeFalloPlanArmado(fallo) } });
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
