import type { DependenciasCotizacion } from "@/lib/globos3d/motor/v1";
import { llamarPythonListaMateriales } from "@/lib/ia/nucleo/python-adapter";
import { leerMotorGuiada } from "./bandera";
import { consultaDelCosteo } from "./consulta-del-costeo";
import type { Costeo, DependenciasCosteo } from "./costear-idea";

/**
 * Lo que `costearDecoracion` necesita de la ruta del asistente guiado, con Python y el motor puestos (D-038). El motor, el
 * cruce con la tienda (250 KB) y los planes guardados se cargan SOLO al costear, con `import()`: el resto de los turnos no
 * los paga, y el motor de un plan solo con la bandera en 3d.
 */
export type ContextoDeCosteo = { request: Request; requestId: string; signal: AbortSignal; auditar: DependenciasCosteo["auditar"] };

/**
 * Lo que el costeo deja en `datos` (el `result` del evento `fin` y lo que lee la vista): la cotización y, si algo quedó fuera del precio,
 * su nota. Sin nota la clave NO existe: el evento `fin` solo admite JSON y un `undefined` lo rechaza (`EVENTO_GUIADO_INVALIDO`).
 */
export function datosDelCosteo(datos: Record<string, unknown>, costeo: Pick<Costeo, "cotizacion" | "noIncluidos">): void {
  datos.cotizacion = costeo.cotizacion;
  if (costeo.noIncluidos?.length) datos.noIncluidos = costeo.noIncluidos;
  else delete datos.noIncluidos;
}

export function dependenciasDeCosteo({ request, requestId, signal, auditar }: ContextoDeCosteo): DependenciasCosteo {
  // Toda lectura del catálogo de este costeo tiene plazo y comparte presupuesto con las demás: un catálogo lento no cuelga el turno.
  const conexion = consultaDelCosteo(signal);
  const cotizarLista: DependenciasCotizacion["cotizarLista"] = (entrada) => llamarPythonListaMateriales({ entrada, requestId: crypto.randomUUID(), correlationId: requestId, parentSignal: signal });
  const cotizadorDelMotor = async (): Promise<DependenciasCotizacion> => {
    const motor = await import("@/lib/globos3d/motor/v1");
    return { crosswalk: async () => motor.crosswalkIncluido(), crosswalkEnVivo: () => motor.crosswalkEnVivo({ conexion }), snapshotPublicado: () => motor.snapshotPublicado({ conexion }), cotizarLista };
  };
  return {
    leerMotor: async () => (await leerMotorGuiada(request)).motor,
    tienePlanGuardado: async (ideaId) => (await import("@/lib/plan/planes-ideas-guardados")).planGuardadoDeIdea(ideaId) !== null,
    cotizarConMotor: async (ideaId) => {
      const [{ cotizarIdeaConMotor }, deps, { planGuardadoDeIdea }] = await Promise.all([import("./cotizar-idea"), cotizadorDelMotor(), import("@/lib/plan/planes-ideas-guardados")]);
      return cotizarIdeaConMotor(ideaId, { ...deps, planGuardado: planGuardadoDeIdea });
    },
    cotizarConPython: async (ideaId) => {
      const [{ cotizarIdeaConPython, DEADLINE_COTIZAR_IDEA_MS }, { planGuardadoDeIdea }, { resolverIdeaSola }] = await Promise.all([import("./cotizar-idea-python"), import("@/lib/plan/planes-ideas-guardados"), import("@/lib/plan/resolver-idea")]);
      // Recordada por su pedido: «Crear mi plan con esta idea» la reutiliza (D-038).
      return cotizarIdeaConPython(ideaId, { planGuardado: planGuardadoDeIdea, resolver: (pedido) => resolverIdeaSola(pedido, { requestId: crypto.randomUUID(), correlationId: requestId, signal, deadlineMs: DEADLINE_COTIZAR_IDEA_MS }) });
    },
    cotizarCurada: async (materiales) => {
      const [{ cotizarListaCurada }, deps, motor] = await Promise.all([import("./cotizar-curada"), cotizadorDelMotor(), import("@/lib/globos3d/motor/v1")]);
      return cotizarListaCurada(materiales, { ...deps, presentaciones: (variantIds) => motor.presentacionesDeVariantes(variantIds, { conexion }) });
    },
    auditar,
  };
}
