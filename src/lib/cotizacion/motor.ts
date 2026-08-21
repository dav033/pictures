import "server-only";
import { mejorVarianteParaTamano } from "@/lib/shopify/consultas";
import type { Producto } from "@/lib/types";

/**
 * 8% por defecto (revientes al inflar y al montar) — [POR CALIBRAR con
 * Sempertex, §8.2 del plan]. Con paquetes de 50 casi nunca cambia el número
 * de paquetes, pero se muestra igual porque justifica el sobrante.
 */
export const MERMA = 0.08;

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
  tamano: string;
  color?: string;
  cantidadNecesaria: number;
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

  const unidadesNecesarias = Math.ceil(item.cantidad * (1 + MERMA));
  const paquetes = Math.ceil(unidadesNecesarias / candidata.unidadesPaquete);
  const subtotal = paquetes * candidata.precio;
  const sobrante = paquetes * candidata.unidadesPaquete - item.cantidad;

  return {
    id: candidata.varianteId,
    tamano: item.tamano,
    color: item.color,
    cantidadNecesaria: item.cantidad,
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
  const lineas = items.map((item, indice) => cotizarLinea(item, indice));
  const total = lineas.reduce((suma, l) => suma + (l.subtotal ?? 0), 0);

  return {
    lineas,
    total,
    mermaPorcentaje: MERMA * 100,
    incluyeIva: PRECIO_INCLUYE_IVA,
    complementosSoportados: false,
  };
}

/**
 * Cotización final de una propuesta visual ya generada.
 * Cada Producto representa una variante/paquete real elegido por la IA;
 * aquí no se vuelve a buscar una variante parecida ni se altera la selección.
 */
export function cotizarProductos(productos: Producto[]): Cotizacion {
  const lineas: LineaCotizada[] = productos.map((producto) => {
    const unidadesPaquete = Math.max(1, producto.unidadesPaquete ?? 1);
    const paquetes = Math.max(1, Math.round(producto.paquetes ?? 1));
    return {
      id: producto.id,
      tamano: producto.nombre,
      cantidadNecesaria: unidadesPaquete * paquetes,
      disponible: true,
      varianteId: producto.id,
      nombre: producto.nombre,
      categoria: producto.categoria,
      colores: producto.colores,
      foto: producto.foto,
      descripcion: producto.descripcion,
      precioPaquete: producto.precio,
      unidadesPaquete,
      paquetes,
      subtotal: producto.precio * paquetes,
      sobrante: 0,
    };
  });

  return {
    lineas,
    total: lineas.reduce((suma, linea) => suma + (linea.subtotal ?? 0), 0),
    mermaPorcentaje: 0,
    incluyeIva: PRECIO_INCLUYE_IVA,
    complementosSoportados: false,
  };
}
