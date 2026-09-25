import type { Cotizacion, LineaCotizada } from "@/lib/cotizacion/motor";
import { PLAN_RESUELTO_CONTRACT_VERSION } from "@/lib/ia/contracts/domain-v1";
import type { PlanResolutionResultV1, PlanResueltoV1, QuoteV1 } from "@/lib/ia/contracts/domain-v1";
import { TIPOS_ESTRUCTURA, UBICACIONES, type TipoEstructura, type Ubicacion } from "./composicion";
import type { EstructuraResuelta, PlanResuelto, PropResuelto } from "./resuelto";
import { ROLES_ESCENA, type PropCatalogo } from "./tipos";

/**
 * Transport mapping between the Python plan-resolution contract
 * (`plan-resolution-result.v1`) and the shapes the Next UI already consumes.
 *
 * This file must never recompute a commercial value. Every quantity, cost and
 * total is copied from the payload Python produced and the adapter already
 * validated (`llamarPythonPlanResolution`); the only work here is renaming
 * fields, narrowing the contract's open string vocabularies to the TypeScript
 * unions, and joining the quote lines with their consolidated purchases for the
 * two fields `quote.v1` does not carry (`unidades_necesarias` and
 * `additional_package_for_waste`). Both live in `plan_resuelto`, which always
 * travels in the same response.
 */
export class PythonPlanMappingError extends Error {
  readonly code = "PYTHON_PLAN_MAPPING" as const;

  constructor(message: string) {
    super(message);
    this.name = "PythonPlanMappingError";
  }
}

function tipoEstructura(value: string, estructuraId: string): TipoEstructura {
  if ((TIPOS_ESTRUCTURA as readonly string[]).includes(value)) return value as TipoEstructura;
  throw new PythonPlanMappingError(`Tipo de estructura desconocido en ${estructuraId}: ${value}`);
}

function ubicacion(value: string, elementoId: string): Ubicacion {
  if ((UBICACIONES as readonly string[]).includes(value)) return value as Ubicacion;
  throw new PythonPlanMappingError(`Ubicación desconocida en ${elementoId}: ${value}`);
}

function rolEscena(value: string, propId: string): PropCatalogo["rol_escena"] {
  if ((ROLES_ESCENA as readonly string[]).includes(value)) return value as PropCatalogo["rol_escena"];
  throw new PythonPlanMappingError(`Rol de escena desconocido en ${propId}: ${value}`);
}

function estructura(entrada: PlanResueltoV1["estructuras"][number]): EstructuraResuelta {
  return {
    ...entrada,
    tipo: tipoEstructura(entrada.tipo, entrada.estructura_id),
    ubicacion: ubicacion(entrada.ubicacion, entrada.estructura_id),
  };
}

function prop(entrada: NonNullable<PlanResueltoV1["props"]>[number]): PropResuelto {
  return {
    ...entrada,
    rol_escena: rolEscena(entrada.rol_escena, entrada.prop_id),
    ubicacion: ubicacion(entrada.ubicacion, entrada.prop_id),
  };
}

/**
 * `plan-resuelto.v1` minus its `schema_version`, with the contract's open string
 * vocabularies narrowed to the unions `src/lib/plan/composicion.ts` defines. An
 * unknown value is a broken response, not something to coerce silently.
 */
export function planResueltoDesdePython(payload: PlanResueltoV1): PlanResuelto {
  const { schema_version: contrato, estructuras, props, costes_por_estructura: costesPorEstructura, patrones_color: patronesColor, armados_bouquet: armadosBouquet, ...resto } = payload;
  // This mapper is where the transport marker is dropped, so it states which
  // contract it accepted instead of discarding it silently.
  if (contrato !== PLAN_RESUELTO_CONTRACT_VERSION) {
    throw new PythonPlanMappingError(`Contrato de plan resuelto inesperado: ${contrato}`);
  }
  return {
    ...resto,
    estructuras: estructuras.map(estructura),
    // Se nombra en vez de viajar dentro de `...resto`: es el consumo por estructura que
    // la tarjeta muestra, y pasarlo sin declararlo fue lo que obligo a recalcularlo en React.
    costes_por_estructura: costesPorEstructura,
    // Igual que el consumo: el patrón expandido lo escribe Python y la tarjeta
    // solo lo dibuja (ADR-0028). Ausente cuando ninguna estructura lo tiene.
    ...(patronesColor === undefined ? {} : { patrones_color: patronesColor }),
    // Lo mismo para el armado de los bouquets (ADR-0030).
    ...(armadosBouquet === undefined ? {} : { armados_bouquet: armadosBouquet }),
    ...(props === undefined ? {} : { props: props.map(prop) }),
  };
}

function lineaCotizada(
  linea: QuoteV1["lines"][number],
  comprasPorVariante: ReadonlyMap<string, PlanResueltoV1["compras"][number]>,
  referenciaPorEstructura: ReadonlyMap<string, string>,
): LineaCotizada {
  const variantId = linea.variant_id ?? linea.id;
  const compra = comprasPorVariante.get(variantId);
  if (!compra) {
    throw new PythonPlanMappingError(`La línea de cotización ${linea.id} no tiene una compra consolidada asociada.`);
  }
  const estructuras = linea.structures ?? [];
  return {
    id: linea.id,
    productId: linea.product_id,
    tamano: linea.size,
    tamanoCodigo: linea.size_code,
    diamPulg: linea.diameter_inches,
    estructuras,
    elementosOrigen: linea.origins,
    referenciaElementIds: [...new Set(
      estructuras
        .map((estructuraId) => referenciaPorEstructura.get(estructuraId))
        .filter((id): id is string => Boolean(id)),
    )],
    color: linea.color,
    cantidadNecesaria: compra.unidades_necesarias,
    designQuantity: linea.design_quantity,
    wasteReserve: linea.waste_reserve,
    requiredQuantity: linea.required_quantity,
    purchaseQuantity: linea.purchase_quantity,
    used: linea.used,
    leftoverInventory: linea.leftover_inventory,
    consumptionCost: linea.consumption_cost_cop,
    purchaseCost: linea.purchase_cost_cop,
    additionalPackageForWaste: compra.additional_package_for_waste,
    disponible: linea.available,
    varianteId: linea.variant_id,
    nombre: linea.title,
    precioPaquete: linea.package_price_cop,
    unidadesPaquete: linea.units_per_package,
    paquetes: linea.packages,
    subtotal: linea.subtotal_cop,
    sobrante: linea.surplus,
    ...(linea.without_reference === undefined ? {} : { sinReferencia: linea.without_reference }),
  };
}

/**
 * The `Cotizacion` the UI renders, built from the Python quote. Mirrors
 * `cotizarPlan` field by field so both backends feed the same component; it
 * never re-runs the commercial engine.
 */
export function cotizacionDesdePython(resultado: PlanResolutionResultV1): Cotizacion {
  const { plan_resuelto: planResuelto, quote } = resultado;
  const comprasPorVariante = new Map(planResuelto.compras.map((compra) => [compra.variant_id, compra]));
  const referenciaPorEstructura = new Map(
    planResuelto.plan.estructuras
      .map((entrada) => [entrada.estructura_id, entrada.referencia_element_id] as const)
      .filter((entrada): entrada is readonly [string, string] => Boolean(entrada[1])),
  );
  return {
    lineas: quote.lines.map((linea) => lineaCotizada(linea, comprasPorVariante, referenciaPorEstructura)),
    total: quote.total_cop,
    mermaPorcentaje: quote.waste_percentage,
    purchaseCost: quote.purchase_cost_cop,
    consumptionCost: quote.consumption_cost_cop,
    targetWasteReserve: quote.target_waste_reserve,
    coveredWasteReserve: quote.covered_waste_reserve,
    leftoverInventory: quote.leftover_inventory,
    incluyeIva: quote.includes_vat,
    complementosSoportados: false,
    plan_hash: quote.plan_hash,
  };
}
