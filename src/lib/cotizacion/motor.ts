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

