import type { FilaDePresentaciones } from "./crosswalk-consulta";
import { claveCruce, type Crosswalk, type EntradaCrosswalk } from "./crosswalk-variantes";

/**
 * **Productos que el cruce no conoce, comprados con la misma regla** (D-038): un globo impreso o una cortina de la lista curada de una
 * idea no es un (formato, color) de la tabla de Sempertex, pero la tienda lo vende por paquetes. Con las presentaciones del mismo globo
 * (`leerPresentacionesDeVariantes`: mismo producto, talla, diámetro, forma y colores) entra al cruce bajo una clave propia (su talla y
 * `p<producto>-<la menor de sus variantes>`, nunca un código de color de 3 cifras) y `planearCompra` lo trata como a cualquier globo:
 * reserva por globo y la combinación de paquetes más barata (`comprarGlobo`), cotizada después por `lista-materiales` de Python.
 * Puro: sin red ni base.
 */
export type ProductoDePresentaciones = {
  /** Las variantes que pidió quien llama y que este globo sirve. */
  pedidas: string[];
  formatoId: string;
  codigo: string;
  entrada: EntradaCrosswalk;
};

/** Lo que dice `tamano` en la línea de un globo sin código de talla: lo mismo que decía la tarjeta de la lista curada. */
const TALLA_SIN_DATO = "sin tamaño aplicable";

/**
 * Un globo por cada conjunto de presentaciones: las variantes pedidas que se compran entre los mismos paquetes (dos paquetes pedidos del
 * mismo globo suman sus globos) son un solo producto; colores o diseños distintos del mismo producto, productos distintos.
 */
export function productosDePresentaciones(filas: readonly FilaDePresentaciones[]): ProductoDePresentaciones[] {
  const porPedida = new Map<string, Map<string, FilaDePresentaciones>>();
  for (const fila of filas) {
    const suyas = porPedida.get(fila.pedida) ?? new Map<string, FilaDePresentaciones>();
    suyas.set(fila.variantId, fila);
    porPedida.set(fila.pedida, suyas);
  }
  const globos = new Map<string, { pedidas: string[]; presentaciones: FilaDePresentaciones[] }>();
  for (const [pedida, suyas] of porPedida) {
    const presentaciones = [...suyas.values()].sort((a, b) => a.unidadesPaq - b.unidadesPaq || (a.variantId < b.variantId ? -1 : 1));
    const firma = presentaciones.map((fila) => fila.variantId).sort().join("|");
    const globo = globos.get(firma) ?? { pedidas: [], presentaciones };
    globo.pedidas.push(pedida);
    globos.set(firma, globo);
  }
  return [...globos.values()].map(({ pedidas, presentaciones }) => {
    const primera = presentaciones[0]!;
    const menor = presentaciones.map((fila) => fila.variantId).sort()[0]!;
    return {
      pedidas: pedidas.sort(), formatoId: primera.codigoTamano || TALLA_SIN_DATO, codigo: `p${primera.productId}-${menor}`,
      entrada: {
        productId: primera.productId, titulo: primera.tituloProducto, color: null,
        variantes: presentaciones.map((fila) => ({ variantId: fila.variantId, titulo: fila.tituloVariante ?? primera.codigoTamano ?? TALLA_SIN_DATO, unidadesPaq: fila.unidadesPaq, precio: Math.round(fila.precio) })),
      },
    };
  });
}

/** El cruce con esos productos añadidos (el original no se toca). */
export function extenderCruce(cruce: Crosswalk, productos: readonly ProductoDePresentaciones[]): Crosswalk {
  return { ...cruce, entradas: { ...cruce.entradas, ...Object.fromEntries(productos.map((producto) => [claveCruce(producto.formatoId, producto.codigo), producto.entrada])) } };
}
