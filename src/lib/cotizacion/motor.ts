import "server-only";
import { mejorVarianteParaTamano } from "@/lib/shopify/consultas";
import type { Producto } from "@/lib/types";
import type { OrigenLineaPlan, PlanResuelto } from "@/lib/plan/resuelto";
import { purchaseForProduct, type DesignMaterialEstimate } from "@/lib/materiales/estimacion";
import { distribuirReservaProyecto } from "@/lib/plan/optimizar-materiales";
import { MERMA } from "./constantes";
export { MERMA } from "./constantes";

/**
 * Confirmado con el negocio: los precios de www.sempertex.com ya incluyen
 * IVA (§8.3 del plan, ya resuelta). El flag queda por si algún día cambia,
 * pero el default correcto es `true`.
 */
const PRECIO_INCLUYE_IVA = process.env.PRECIO_INCLUYE_IVA !== "false";

export type ItemCotizacion = { tamano: string; color?: string; cantidad: number };

export type LineaCotizada = {
  /**
   * Clave estable para React y para el borrador de edición del cliente:
   * `varianteId` cuando existe, o un id sintético `sin-ref-N` para líneas
   * sin candidata en catálogo (nunca vacío, nunca se repite dentro de una
   * misma cotización).
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

function cotizarLinea(item: ItemCotizacion, indice: number): LineaCotizada {
  const candidata = mejorVarianteParaTamano(item.tamano, item.color);
  if (!candidata) {
    return {
      id: `sin-ref-${indice}`,
      tamano: item.tamano,
      color: item.color,
      cantidadNecesaria: item.cantidad,
      disponible: false,
      sinReferencia: true,
    };
  }

  const unidadesNecesarias = item.cantidad;
  const paquetes = Math.max(1, Math.ceil(unidadesNecesarias / candidata.unidadesPaquete));
  const subtotal = paquetes * candidata.precio;
  const purchaseQuantity = paquetes * candidata.unidadesPaquete;
  const sobrante = purchaseQuantity - item.cantidad;

  return {
    id: candidata.varianteId,
    tamano: item.tamano,
    tamanoCodigo: candidata.tamano ?? undefined,
    diamPulg: candidata.diamPulg ?? undefined,
    color: item.color,
    cantidadNecesaria: item.cantidad,
    designQuantity: item.cantidad,
    wasteReserve: 0,
    requiredQuantity: item.cantidad,
    purchaseQuantity,
    used: item.cantidad,
    leftoverInventory: sobrante,
    consumptionCost: purchaseQuantity > 0 ? Math.round(subtotal * item.cantidad / purchaseQuantity) : 0,
    purchaseCost: subtotal,
    additionalPackageForWaste: false,
    disponible: candidata.disponible,
    varianteId: candidata.varianteId,
    nombre: candidata.nombre,
    categoria: candidata.categoriaNombre,
    colores: candidata.colores,
    foto: candidata.imagen ?? undefined,
    descripcion: candidata.descripcion ?? candidata.nombre,
    precioPaquete: candidata.precio,
    unidadesPaquete: candidata.unidadesPaquete,
    paquetes,
    subtotal,
    sobrante,
  };
}

/**
 * Traduce un despiece (tamaño + color + cantidad) a referencias reales del
 * catálogo, con paquetes redondeados hacia arriba — nunca prorratea el
 * precio del paquete: si el cliente necesita 108 R-12 y vienen de a 50, paga
 * 3 paquetes (150), con los 42 sobrantes explícitos (§3.5 del plan).
 *
 * Complementos (tira, cinta, inflador) quedan fuera a propósito: el
 * catálogo real de "complementos" son tiaras, disfraces e infladores, no
 * insumos de guirnalda por metro — automatizarlo habría sido adivinar.
 */
export function cotizar(items: ItemCotizacion[]): Cotizacion {
  const lineasBase = items.map((item, indice) => cotizarLinea(item, indice));
  const reserva = distribuirReservaProyecto(
    lineasBase.map((linea, index) => ({
      id: `${linea.id}#${index}`,
      designQuantity: linea.designQuantity ?? linea.cantidadNecesaria,
      purchaseQuantity: linea.purchaseQuantity ?? 0,
      compatibilityKey: `size:${linea.diamPulg ?? linea.tamano}|color:${linea.color ?? ""}`,
      eligible: linea.diamPulg != null,
    })),
    MERMA,
  );
  const lineas = lineasBase.map((linea, index) => {
    const designQuantity = linea.designQuantity ?? linea.cantidadNecesaria;
    const wasteReserve = reserva.allocations.get(`${linea.id}#${index}`) ?? 0;
    const requiredQuantity = designQuantity + wasteReserve;
    const purchaseQuantity = linea.purchaseQuantity ?? 0;
    return {
      ...linea,
      wasteReserve,
      requiredQuantity,
      purchaseQuantity,
      leftoverInventory: Math.max(0, purchaseQuantity - requiredQuantity),
      consumptionCost: purchaseQuantity > 0 ? Math.round((linea.purchaseCost ?? 0) * requiredQuantity / purchaseQuantity) : 0,
    };
  });
  const total = lineas.reduce((suma, l) => suma + (l.subtotal ?? 0), 0);

  return {
    lineas,
    total,
    mermaPorcentaje: MERMA * 100,
    purchaseCost: total,
    consumptionCost: lineas.reduce((sum, linea) => sum + (linea.consumptionCost ?? 0), 0),
    targetWasteReserve: reserva.targetWasteReserve,
    coveredWasteReserve: reserva.coveredWasteReserve,
    leftoverInventory: lineas.reduce((sum, linea) => sum + (linea.leftoverInventory ?? 0), 0),
    incluyeIva: PRECIO_INCLUYE_IVA,
    complementosSoportados: false,
  };
}

/**
 * Cotización final de una propuesta visual ya generada.
 * Cada Producto representa una variante/paquete real elegido por la IA;
 * aquí no se vuelve a buscar una variante parecida ni se altera la selección.
 */
export function cotizarProductos(productos: Producto[], estimate?: DesignMaterialEstimate): Cotizacion {
  const productosCotizables = estimate ? productos.filter((producto) => (purchaseForProduct(estimate, producto.id)?.purchase_quantity ?? 0) > 0) : productos;
  const lineas: LineaCotizada[] = productosCotizables.map((producto) => {
    const unidadesPaquete = Math.max(1, producto.unidadesPaquete ?? 1);
    const compra = estimate?.purchases.find((item) => item.variant_id === producto.id || item.product_id === producto.id);
    const cantidadInstalada = estimate ? (compra?.design_quantity ?? estimate.balloons.concat(estimate.special_elements)
      .filter((item) => item.variant_id === producto.id || item.product_id === producto.id)
      .reduce((sum, item) => sum + item.design_quantity, 0)) : unidadesPaquete * Math.max(1, Math.round(producto.paquetes ?? 1));
    const paquetes = Math.max(1, Math.round(compra?.package_count ?? producto.paquetes ?? 1));
    const purchaseQuantity = unidadesPaquete * paquetes;
    const wasteReserve = compra ? Math.max(0, compra.waste_adjusted_quantity - cantidadInstalada) : 0;
    const requiredQuantity = cantidadInstalada + wasteReserve;
    const purchaseCost = producto.precio * paquetes;
    return {
      id: producto.id,
      tamano: producto.tamanoCodigo ?? "sin tamaño aplicable",
      tamanoCodigo: producto.tamanoCodigo,
      diamPulg: producto.diamPulg,
      cantidadNecesaria: cantidadInstalada,
      disponible: true,
      varianteId: producto.id,
      designQuantity: cantidadInstalada,
      wasteReserve,
      requiredQuantity,
      purchaseQuantity,
      used: cantidadInstalada,
      leftoverInventory: Math.max(0, purchaseQuantity - requiredQuantity),
      consumptionCost: purchaseQuantity > 0 ? Math.round(purchaseCost * requiredQuantity / purchaseQuantity) : 0,
      purchaseCost,
      additionalPackageForWaste: false,
      nombre: producto.nombre,
      categoria: producto.categoria,
      colores: producto.colores,
      foto: producto.foto,
      descripcion: producto.descripcion,
      precioPaquete: producto.precio,
      unidadesPaquete,
      paquetes,
      subtotal: producto.precio * paquetes,
      sobrante: Math.max(0, unidadesPaquete * paquetes - cantidadInstalada),
    };
  });

  return {
    lineas,
    total: lineas.reduce((suma, linea) => suma + (linea.subtotal ?? 0), 0),
    mermaPorcentaje: estimate ? estimate.totals.design_quantity > 0 ? MERMA * 100 : 0 : 0,
    purchaseCost: estimate?.totals.purchase_cost ?? lineas.reduce((sum, linea) => sum + (linea.subtotal ?? 0), 0),
    consumptionCost: estimate?.totals.consumption_cost ?? lineas.reduce((sum, linea) => sum + (linea.consumptionCost ?? 0), 0),
    targetWasteReserve: estimate?.totals.target_waste_reserve,
    coveredWasteReserve: estimate?.totals.covered_waste_reserve,
    leftoverInventory: estimate?.purchases.reduce((sum, purchase) => sum + purchase.leftover_inventory, 0),
    incluyeIva: PRECIO_INCLUYE_IVA,
    complementosSoportados: false,
  };
}

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
