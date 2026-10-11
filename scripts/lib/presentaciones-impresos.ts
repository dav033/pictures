import { readFileSync } from "node:fs";
import path from "node:path";
import type { FilaDePresentaciones } from "../../src/lib/globos3d/motor/v1";

/**
 * Lo que el catálogo de la tienda vende de los 8 globos impresos de las ideas de ejemplo con un impreso (`ej-futbol-deportes`,
 * `ej-baby-nino`, `ej-baby-nina`, `ej-boda-elegante`, `ej-xv-rosa-dorado`, `ej-bautizo-comunion`, `ej-cumple-adulto-negro-dorado`,
 * `ej-fiesta-tropical`): una copia de las filas reales del snapshot del cruce (productos que el cruce con la tabla de Sempertex no conoce),
 * solo sus paquetes de 12 y de 50 de 12″. Es lo que lee `leerPresentacionesDeVariantes`; así las pruebas cotizan sin base ni red.
 */
export const FILAS_IMPRESOS: readonly FilaDePresentaciones[] = JSON.parse(readFileSync(path.join(__dirname, "..", "test", "fixtures", "presentaciones-impresos", "filas.json"), "utf8")) as FilaDePresentaciones[];

/** Lo mismo que `presentacionesDeVariantes` pero de la copia: por cada variante pedida de uno de esos productos, los paquetes de su talla (ella incluida). */
export const presentacionesDeImpresos = async (variantIds: readonly string[]): Promise<FilaDePresentaciones[]> => variantIds.flatMap((pedida) => {
  const duena = FILAS_IMPRESOS.find((fila) => fila.variantId === pedida);
  return duena ? FILAS_IMPRESOS.filter((fila) => fila.pedida === duena.pedida).map((fila) => ({ ...fila, pedida })) : [];
});

/** Las variantes de esas filas, para que el doble de Python también las cotice. */
export const variantesDeImpresos = (): Array<{ variantId: string; titulo: string; unidadesPaq: number; precio: number }> => {
  const porId = new Map(FILAS_IMPRESOS.map((fila) => [fila.variantId, { variantId: fila.variantId, titulo: fila.tituloVariante ?? "", unidadesPaq: fila.unidadesPaq, precio: fila.precio }] as const));
  return [...porId.values()];
};
