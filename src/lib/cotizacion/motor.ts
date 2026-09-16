import "server-only";
import type { OrigenLineaPlan, PlanResuelto } from "@/lib/plan/resuelto";

export type LineaCotizada = {
  /**
   * Clave estable para React y para el borrador de edición del cliente:
   * `varianteId` cuando existe, o un id sintético para líneas sin candidata
   * en catálogo (nunca vacío, nunca se repite dentro de una misma
   * cotización).
   */
  id: string;
  productId?: string;
  tamano: string;
  tamanoCodigo?: string;
  diamPulg?: number;
  estructuras?: string[];
  elementosOrigen?: OrigenLineaPlan[];
  referenciaElementIds?: string[];
  color?: string;
  cantidadNecesaria: number;
  designQuantity?: number;
  wasteReserve?: number;
  requiredQuantity?: number;
  purchaseQuantity?: number;
  used?: number;
  leftoverInventory?: number;
  consumptionCost?: number;
  purchaseCost?: number;
  additionalPackageForWaste?: boolean;
  disponible: boolean;
  varianteId?: string;
  nombre?: string;
  /** Categoría real del catálogo (ej. "Globos látex") — precarga el modal de reemplazo por tipo. */
  categoria?: string;
  /** Colores de la variante — para el filtro de color del modal de reemplazo. */
  colores?: string[];
  /** Foto real del producto (cdn.shopify.com), si el catálogo la tiene. */
  foto?: string;
  /**
   * Descripción visual (la que se le manda al modelo de imagen). Se
   * conserva aquí sobre todo por las piezas manuales: son las únicas sin
   * una ficha de catálogo a la que volver si la línea se reconstruye tras
   * una edición (ver `aplicarCotizacionEditada` en page.tsx).
   */
  descripcion?: string;
  precioPaquete?: number;
  unidadesPaquete?: number;
  paquetes?: number;
  subtotal?: number;
  /** Unidades de más que el cliente paga por venir en paquetes cerrados — nunca se oculta. */
  sobrante?: number;
  sinReferencia?: boolean;
};

export type Cotizacion = {
  lineas: LineaCotizada[];
  total: number;
  mermaPorcentaje: number;
  incluyeIva: boolean;
  complementosSoportados: false;
  purchaseCost?: number;
  consumptionCost?: number;
  targetWasteReserve?: number;
  coveredWasteReserve?: number;
  leftoverInventory?: number;
  plan_hash?: string;
};

export function cotizarPlan(plan: PlanResuelto): Cotizacion {
  const estructurasPlanPorId = new Map(plan.plan.estructuras.map((estructura) => [estructura.estructura_id, estructura]));
  const lineas: LineaCotizada[] = plan.compras.map((compra) => ({
    id: compra.variant_id,
    productId: compra.product_id,
    tamano: compra.tamano_codigo ?? "sin tamaño aplicable",
    tamanoCodigo: compra.tamano_codigo ?? undefined,
    diamPulg: compra.diam_pulg ?? undefined,
    estructuras: compra.estructuras,
    elementosOrigen: compra.elementos_origen,
    referenciaElementIds: [...new Set(compra.estructuras
      .map((estructuraId) => estructurasPlanPorId.get(estructuraId)?.referencia_element_id)
      .filter((id): id is string => Boolean(id)))],
    color: compra.color ?? undefined,
    cantidadNecesaria: compra.unidades_necesarias,
    designQuantity: compra.design_quantity,
    wasteReserve: compra.waste_reserve,
    requiredQuantity: compra.required_quantity,
    purchaseQuantity: compra.purchase_quantity,
    used: compra.used,
    leftoverInventory: compra.leftover_inventory,
    consumptionCost: compra.consumption_cost,
    purchaseCost: compra.purchase_cost,
    additionalPackageForWaste: compra.additional_package_for_waste,
    disponible: true,
    varianteId: compra.variant_id,
    nombre: compra.titulo,
    precioPaquete: compra.precio_paquete,
    unidadesPaquete: compra.unidades_paquete,
    paquetes: compra.paquetes,
    subtotal: compra.subtotal,
    sobrante: compra.sobrante,
  }));
  return {
    lineas,
    total: plan.totales.total_cop,
    mermaPorcentaje: plan.totales.merma_porcentaje,
    purchaseCost: plan.totales.purchase_cost,
    consumptionCost: plan.totales.consumption_cost,
    targetWasteReserve: plan.totales.target_waste_reserve,
    coveredWasteReserve: plan.totales.covered_waste_reserve,
    leftoverInventory: plan.compras.reduce((sum, compra) => sum + compra.leftover_inventory, 0),
    incluyeIva: plan.totales.incluye_iva,
    complementosSoportados: false,
    plan_hash: plan.plan_hash,
  };
}
