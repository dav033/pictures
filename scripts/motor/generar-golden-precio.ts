import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { armarDesdeEspec } from "../../src/lib/globos3d/motor/v1";
import { crosswalkIncluido } from "../../src/lib/globos3d/motor/crosswalk-vigente";
import { elegirPedido } from "../../src/lib/globos3d/motor/cotizar-bom";
import { DIRECTORIO_DORADO_PRECIO, todosLosCasos, type RegistroDoradoPrecio } from "../lib/casos-motor-guiada";

/**
 * Regenera las fixtures doradas con PRECIO del motor 3D (`contracts/domain/v1/golden/motor-guiada/precio/`): por cada
 * una de las 28 ideas y las 18 estructuras oficiales, la lista de compra (formato, color, cantidad, cantidad con merma,
 * producto y variante de la tienda). Solo cantidades e ids de variante: los precios no son estables entre snapshots.
 * Córrelo cuando cambie el motor (y suba `VERSION_MOTOR`) o cuando se regenere el cruce:
 *
 *   npx tsx --conditions=react-server scripts/motor/generar-golden-precio.ts
 */
export function registroPrecio(caso: ReturnType<typeof todosLosCasos>[number]): RegistroDoradoPrecio {
  const resultado = armarDesdeEspec(caso.espec);
  const cruce = crosswalkIncluido();
  const todas = elegirPedido(resultado.bom.total, cruce);
  const faltantes = todas.ok ? [] : todas.faltantes;
  // Las líneas que sí se cruzan se listan aunque otras falten: así se ve qué se compra y qué no tiene tienda.
  const cubiertas = resultado.bom.total.filter((l) => !faltantes.some((f) => f.formatoId === l.formatoId && f.codigo === l.codigo));
  const pedido = elegirPedido(cubiertas, cruce);
  return {
    caso: caso.id,
    motor: resultado.motor,
    especHash: resultado.especHash,
    crosswalk: cruce.snapshot,
    faltantes,
    pedido: pedido.ok ? pedido.pedidas.map((p) => ({ formatoId: p.linea.formatoId, codigo: p.linea.codigo, cantidad: p.cantidad, cantidadConMerma: p.conMerma, productId: p.variante.productId, variantId: p.variante.variantId })) : [],
  };
}

if (require.main === module) {
  mkdirSync(DIRECTORIO_DORADO_PRECIO, { recursive: true });
  for (const archivo of readdirSync(DIRECTORIO_DORADO_PRECIO)) if (archivo.endsWith(".json")) rmSync(path.join(DIRECTORIO_DORADO_PRECIO, archivo));
  for (const caso of todosLosCasos()) {
    writeFileSync(path.join(DIRECTORIO_DORADO_PRECIO, `${caso.id}.json`), `${JSON.stringify(registroPrecio(caso), null, 1)}\n`, "utf8");
    console.log(`escrito ${caso.id}`);
  }
}
