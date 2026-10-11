/**
 * D-038, la consulta de presentaciones (`leerPresentacionesDeVariantes`) contra el catálogo REAL, de solo lectura: lo que la prueba con
 * doble (`test-cotizar-curada`) no puede ver, porque ahí la base es una copia. Para los 8 globos impresos de las ideas de ejemplo
 * (`scripts/test/fixtures/presentaciones-impresos/filas.json`, copia de las filas del snapshot del cruce):
 * - la consulta (que trae las variantes del producto) y la regla de «el mismo globo» de Python aplicada en TypeScript (`crosswalk-mismo-globo`)
 *   dejan, de cada variante pedida, SOLO los paquetes de su mismo globo (el producto del fútbol vende además R-5, R-24 y R-36)
 *   y ella misma entre ellos, todos del mismo producto;
 * - con el mismo snapshot que la copia, son exactamente las mismas filas, al peso; con otro, se avisa de la deriva (los precios cambian).
 * Sin `DATABASE_URL` (CI, una máquina sin la base) se omite, con el motivo. No escribe nada ni llama a ningún servicio de pago.
 *
 *   NODE_OPTIONS=--use-system-ca npx tsx --env-file=.env.local --conditions=react-server scripts/test/test-presentaciones-catalogo-vivo.ts
 */
import assert from "node:assert/strict";
import { leerPresentacionesDeVariantes } from "../../src/lib/globos3d/motor/crosswalk-consulta";
import { getRagPool } from "../../src/lib/rag/db";
import { FILAS_IMPRESOS } from "../lib/presentaciones-impresos";

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.log("SKIPPED test-presentaciones-catalogo-vivo: sin DATABASE_URL no hay catálogo que consultar");
    return;
  }
  const pedidas = [...new Set(FILAS_IMPRESOS.map((fila) => fila.pedida))];
  const reales = await leerPresentacionesDeVariantes(getRagPool(), pedidas);
  for (const pedida of pedidas) {
    const copia = FILAS_IMPRESOS.filter((fila) => fila.pedida === pedida);
    const vivas = reales.filter((fila) => fila.pedida === pedida);
    assert.ok(vivas.length > 0, `${pedida}: el catálogo vende presentaciones de ese globo`);
    assert.ok(vivas.some((fila) => fila.variantId === pedida), `${pedida}: la variante pedida está entre sus presentaciones`);
    assert.deepEqual([...new Set(vivas.map((fila) => fila.productId))], [copia[0]!.productId], `${pedida}: todas del mismo producto`);
    assert.deepEqual([...new Set(vivas.map((fila) => fila.codigoTamano))], ["R-12"], `${pedida}: solo los paquetes de su talla (R-12), no los de las otras tallas del producto`);
    const mismoSnapshot = vivas.every((fila) => fila.snapshot === copia[0]!.snapshot);
    const resumen = (filas: ReadonlyArray<{ variantId: string; unidadesPaq: number; precio: number }>) => filas.map((fila) => [fila.variantId, fila.unidadesPaq, Math.round(fila.precio)]).sort();
    if (mismoSnapshot) assert.deepEqual(resumen(vivas), resumen(copia), `${pedida}: con el mismo snapshot, las mismas filas que la copia`);
    else console.log(`  [INFO] ${pedida}: el catálogo publicó otro snapshot que la copia (${vivas[0]!.snapshot.slice(0, 28)}…): ${JSON.stringify(resumen(vivas))} contra ${JSON.stringify(resumen(copia))}`);
  }
  console.log(`[PASS] ${pedidas.length} globos impresos: la consulta trae los paquetes de su talla del catálogo real`);
  console.log("\ntest-presentaciones-catalogo-vivo: ok");
}

main().then(() => process.exit(0), (error: unknown) => { console.error(error); process.exit(1); });
